const fs = require("fs").promises;
const { performance } = require("perf_hooks");
const fetch = require("node-fetch");
const chokidar = require("chokidar");
const { Server } = require("socket.io");
const sharp = require("sharp");
const open = require("open");
const cron = require("node-cron");
const { rand, randChoice, doFetch, timeSince, getResizedDim } = require("./utils");
const { createLoggerWithID, globalLog, getCurrentLogFile } = require("./logger");
const favorites = require("./favorites");

const API_URL_SEARCH = "https://wallhaven.cc/api/v1/search";
const API_URL_WALLPAPER_INFO_BASE = "https://wallhaven.cc/api/v1/w/";
const TARGET_SIZE = [1920, 1080];
const { WALLHAVEN_API_KEY, CONFIG_PATH, FAVORITES_DIR } = process.env;

const config = { server: {} };
/** @type {import("socket.io").Server} */
let server;
/** @type {import("node-cron").ScheduledTask} */
let cronTask;

/**
 * @typedef {object} WallpaperInfo
 * @property {string} site
 * @property {string} id
 * @property {string} url
 * @property {string} uploader
 * @property {number} viewCount
 * @property {number} favoriteCount
 * @property {string} sourceURL
 * @property {string} category
 * @property {Array<{ id: string, name: string }>} tags
 * @property {boolean} isFav
 */

function setupCron() {
	const pattern = config.server.cron;
	if (!cron.validate(pattern)) {
		globalLog.error(`Invalid cron pattern: "${pattern}". Not starting cron task. If cron was already running it won't be stopped.`);
		return;
	}

	if (cronTask) {
		cronTask.stop();
	}

	cronTask = cron.schedule(pattern, () => {
		if (!server) {
			globalLog.warn("Cron task triggered but server not running. Skipping.");
			return;
		}

		globalLog.info("Cron triggered, cycling all wallpapers...")
		const sockets = server.sockets.sockets.values();
		for (const socket of sockets) {
			sendNewWallpaper(socket, false).catch(socket.log.error);
		}
	});
	globalLog.info(`Cron task started with pattern "${pattern}"`);
}

async function sendNewWallpaper(socket, skipLoadingBuffer) {
	const changeWallpaperAt = performance.now() + config.server.loadingBuffer * 1000;

	const { searchQueries, options: baseQuery } = config.server.wallhaven;
	const randQuery = randChoice(searchQueries);
	const query = {
		...baseQuery,
		q: randQuery,
		apikey: WALLHAVEN_API_KEY,
		page: 1,
	};

	let startLoadTime = performance.now();
	socket.log.info(`Fetching with query "${randQuery}"...`);
	const searchResult = await doFetch(API_URL_SEARCH, query);
	const { data: wallpapers } = await searchResult.json();

	if (wallpapers.length === 0)
		throw new Error("Invalid request: no wallpapers found");

	socket.log.info(`Fetching complete in ${timeSince(startLoadTime)}ms`);

	const { id: wallpaperID } = randChoice(wallpapers);

	startLoadTime = performance.now();
	socket.log.info(`Fetching info on wallpaper "${wallpaperID}"`);
	const infoResults = await doFetch(API_URL_WALLPAPER_INFO_BASE + wallpaperID, { apikey: WALLHAVEN_API_KEY })
	const { data: infoData } = await infoResults.json();
	socket.log.info(`Fetching complete in ${timeSince(startLoadTime)}ms`);

	const { path: imgURL } = infoData;
	/** @type {WallpaperInfo} */
	const wallpaperInfo = {
		site: "wallhaven",
		id: wallpaperID,
		url: infoData.short_url,
		uploader: infoData.uploader.username,
		uploadDate: infoData.created_at,
		viewCount: infoData.views,
		favoriteCount: infoData.favorites,
		sourceURL: infoData.source,
		category: infoData.category,
		tags: infoData.tags.map(({ id, name, category }) => ({ id, name, category })),
	};
	wallpaperInfo.isFav = await favorites.is(wallpaperInfo);

	/** @type {import("node-fetch").Response} */
	const imgResult = await fetch(imgURL);
	let imgBuffer = await imgResult.arrayBuffer();
	imgBuffer = Buffer.from(imgBuffer);

	startLoadTime = performance.now();
	let sharpImg = sharp(imgBuffer);
	const { width, height } = await sharpImg.metadata();
	if (width !== TARGET_SIZE[0] || height !== TARGET_SIZE[1]) {
		// resize image to 1920x1080 but keep original AR
		const newSize = getResizedDim(TARGET_SIZE[0], TARGET_SIZE[1], width, height);
		sharpImg = sharpImg.resize(newSize[0], newSize[1], {});

		socket.log.info(`Resized image from ${[width, height].map(Math.round).join("x")} to ${newSize.map(Math.round).join("x")}`);
	}
	else {
		socket.log.info(`Image already at target size (${TARGET_SIZE.map(Math.round).join("x")})`)
	}

	imgBuffer = await sharpImg.jpeg({ quality: 80 }).toBuffer();
	socket.log.info(`Finished image processing in ${timeSince(startLoadTime)}ms`);

	const waitForChange = changeWallpaperAt - performance.now();
	if (!skipLoadingBuffer && waitForChange > 0) {
		socket.log.info(`Waiting ${Math.round(waitForChange)}ms to display new wallpaper`);
		await new Promise(resolve => setTimeout(resolve, waitForChange));
	}

	socket.currentImageBuffer = imgBuffer;
	socket.currentWallpaper = wallpaperInfo;
	socket.emit("update wallpaper", imgBuffer);
	await sendWallpaperMeta(socket, false);
}

async function sendWallpaperMeta(socket, doUpdate) {
	/** @type {WallpaperInfo} */
	const info = socket.currentWallpaper || {};

	if (doUpdate) {
		info.isFav = await favorites.is(info);

		socket.currentWallpaper = info;
	}

	if (info)
		socket.emit("update meta", info);
}

async function setWallpaperFavorite(socket, isFavorite) {
	if (!socket.currentWallpaper)
		return;
	await favorites.set(socket.currentWallpaper, isFavorite, isFavorite ? socket.currentImageBuffer : null);
	await sendWallpaperMeta(socket, true);
}

async function setup() {
	const confJson = await fs.readFile(CONFIG_PATH, "utf-8");
	Object.assign(config, JSON.parse(confJson));
	setupCron();

	const watcher = chokidar.watch(CONFIG_PATH, {
		ignoreInitial: true,
	});

	watcher.on("change", (path) => {
		globalLog.info("Config file changed, updating...");
		fs.readFile(path, "utf-8").then(confJson => {
			if (confJson.length === 0)
				return;
			const newConf = JSON.parse(confJson);
			const cronChanged = newConf.server.cron !== config.server.cron;
			Object.assign(config, newConf);
			if (cronChanged)
				setupCron();
		}).catch(globalLog.error);
	});

	server = new Server({
		cors: {
			origin: "*",
		},
	});

	server.on("connection", socket => {
		socket.log = createLoggerWithID(socket.id);
		socket.log.info("Connected");

		sendNewWallpaper(socket, true).catch(socket.log.error);

		socket.on("set label", (label) => {
			if (label.length === 0) return;
			socket.log.info(`Got new label for socket: "${label}"`);
			socket.log = createLoggerWithID(socket.id + ":" + label);
		});

		socket.on("cycle", () => {
			socket.log.info("Received request to cycle wallpaper, running...");
			sendNewWallpaper(socket, true).catch(socket.log.error);
		});

		socket.on("set favorite", (newIsFav) => {
			socket.log.info(`Received request to set wallpaper favorite to ${Boolean(newIsFav)}, running...`);
			setWallpaperFavorite(socket, newIsFav).catch(socket.log.error);
		});

		socket.on("open wallpaper", () => {
			const { url } = socket.currentWallpaper || {};
			if (!url)
				return;
			socket.log.info(`Received request to open wallpaper, opening "${url}"`);
			open(url).catch(socket.log.error);
		});

		socket.on("open config", () => {
			socket.log.info(`Received request to open config, opening file "${CONFIG_PATH}"`);
			open(CONFIG_PATH).catch(socket.log.error);
		});

		socket.on("open logs", () => {
			const logFilePath = getCurrentLogFile();
			socket.log.info(`Received request to open logs, opening file "${logFilePath}"`);
			open(logFilePath).catch(socket.log.error);
		});

		socket.on("open favorites", () => {
			socket.log.info(`Received request to open favorites, opening folder "${FAVORITES_DIR}"`);
			open(FAVORITES_DIR).catch(socket.log.error);
		})

		socket.on("log", ({ level, msg }) => {
			socket.log[level](`[CLIENT] ${msg}`);
		})

		socket.on("disconnect", (reason) => {
			socket.log.info(`Disconnected. Reason: ${reason}`);
		});
	});

	server.listen(config.port);

	globalLog.info("Socket.io server started on port", config.port);
}

function startServer() {
	setup().catch(globalLog.error);
}

module.exports = startServer;
