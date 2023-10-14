const fs = require("fs").promises;
const { performance } = require("perf_hooks");
const fetch = require("node-fetch");
const chokidar = require("chokidar");
const { Server } = require("socket.io");
const sharp = require("sharp");
const open = require("open");
const cron = require("node-cron");
const CommentJSON = require("comment-json");
const jsonDiff = require("json-diff");
const { rand, doFetch, timeSince, getResizedDim, formatResolution } = require("./utils");
const { createLoggerWithID, globalLog, getCurrentLogFile } = require("./logger");
const favorites = require("./favorites");

const SITE_ID = "wallhaven";
const API_URL_SEARCH = "https://wallhaven.cc/api/v1/search";
const API_URL_WALLPAPER_INFO_BASE = "https://wallhaven.cc/api/v1/w/";
const TARGET_SIZE = [1920, 1080];
const VALID_ORIENTATIONS = ["landscape", "portrait"];
const { WALLHAVEN_API_KEY, CONFIG_PATH, FAVORITES_DIR } = process.env;

/** @type {typeof import("../../config.template.json")} */
const config = { server: {} };
/** @type {SearchQueryInfo[]} */
const queryInfoList = [];
/** @type {string[]} */
const availableQueryStrings = [];

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
 * @property {string} origResolution
 * @property {string} resolution
 * @property {Array<{ id: string, name: string }>} tags
 * @property {boolean} isFav
 *
 * @typedef {object} SearchQueryInfo
 * @property {string} siteID
 * @property {string} queryIdentifier
 * @property {string} queryDesc
 * @property {number} resultCount
 * @property {number} pageCount
 * @property {number} perPage
 * @property {string[]} idCacheList
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

	const { searchQueries, options: baseQuery } = config.server[SITE_ID];
	if (availableQueryStrings.length === 0) {
		availableQueryStrings.push(...searchQueries);
		availableQueryStrings.sort(() => Math.random() - 0.5);
	}

	const res = socket.options?.resolution;
	/** @type "landscape" | "portrait" */
	const orientationOption = res ? (res[0] > res[1] ? "landscape" : "portrait") : VALID_ORIENTATIONS[0];
	const queryString = availableQueryStrings.pop();
	const query = {
		...baseQuery,
		ratios: orientationOption,
		sorting: "date_added", // static sort order
		order: "asc", // so newly-added wallpapers appear at end
		q: queryString,
		apikey: WALLHAVEN_API_KEY,
		page: 1,
	};
	const queryIdentifier = [queryString, orientationOption].join(";");

	let startLoadTime = performance.now();

	let queryInfoIdx = queryInfoList.findIndex(info => (
		info.siteID === SITE_ID &&
		info.queryIdentifier === queryIdentifier
	));
	if (queryInfoIdx === -1) {
		socket.log.info(`Fetching info on query "${queryIdentifier}"...`);
		const searchResult = await doFetch(API_URL_SEARCH, query);
		const { meta } = await searchResult.json();
		/** @type {SearchQueryInfo} */
		const queryInfo = {
			siteID: SITE_ID,
			queryIdentifier,
			queryDesc: typeof meta.query === "string" ? meta.query : meta.query.tag || null,
			pageCount: parseInt(meta.last_page, 10),
			perPage: parseInt(meta.per_page, 10),
			resultCount: parseInt(meta.total, 10),
		};
		queryInfo.idCacheList = [];
		queryInfoList.push(queryInfo);
		queryInfoIdx = queryInfoList.length - 1;

		socket.log.info(`Fetching complete in ${timeSince(startLoadTime)}ms`);
	}
	else {
		socket.log.info(`Got info on query "${queryIdentifier}" from cache`);
	}

	const queryInfo = queryInfoList[queryInfoIdx];
	if (queryInfo.resultCount === 0)
		throw new Error("Invalid request: no wallpapers found");

	const randIdx = rand(0, queryInfo.resultCount);
	let wallpaperID = queryInfo.idCacheList[randIdx];
	if (!wallpaperID) {
		startLoadTime = performance.now();
		query.page = Math.floor(randIdx / queryInfo.perPage) + 1;
		socket.log.info(`Fetching page ${query.page} for wallpaper at index ${randIdx}`);

		const searchResult = await doFetch(API_URL_SEARCH, query);
		const { data } = await searchResult.json();

		const pageStartIdx = (query.page - 1) * queryInfo.perPage;
		for (let i = 0; i < data.length; i++) {
			queryInfo.idCacheList[pageStartIdx + i] = data[i].id;
		}

		wallpaperID = queryInfo.idCacheList[randIdx];
		queryInfoList[queryInfoIdx] = queryInfo;

		socket.log.info(`Fetching complete in ${timeSince(startLoadTime)}ms`);
	}
	else {
		socket.log.info(`Got random wallpaper ID "${wallpaperID}" from cache`)
	}

	startLoadTime = performance.now();
	socket.log.info(`Fetching info on wallpaper "${wallpaperID}"`);
	const infoResults = await doFetch(API_URL_WALLPAPER_INFO_BASE + wallpaperID, { apikey: WALLHAVEN_API_KEY })
	const { data: infoData } = await infoResults.json();
	socket.log.info(`Fetching complete in ${timeSince(startLoadTime)}ms`);

	const { path: imgURL } = infoData;
	/** @type {WallpaperInfo} */
	const wallpaperInfo = {
		site: SITE_ID,
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
	const origRes = [width, height];
	const targetSize = socket.options?.resolution || TARGET_SIZE;
	let finalRes = origRes;
	if (width !== targetSize[0] || height !== targetSize[1]) {
		// resize image to target resolution of monitor, but keep original AR
		const newSize = getResizedDim(targetSize, origRes);
		sharpImg = sharpImg.resize(newSize[0], newSize[1], {});

		socket.log.info(`Resized image from ${formatResolution(origRes)} to ${formatResolution(newSize)}`);
		finalRes = newSize;
	}
	else {
		socket.log.info(`Image already at target size (${formatResolution(targetSize)})`)
	}

	wallpaperInfo.origResolution = formatResolution(origRes);
	wallpaperInfo.resolution = formatResolution(finalRes);

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
	Object.assign(config, CommentJSON.parse(confJson));
	setupCron();

	const watcher = chokidar.watch(CONFIG_PATH, {
		ignoreInitial: true,
	});

	watcher.on("change", (path) => {
		globalLog.info("Config file changed, updating...");
		fs.readFile(path, "utf-8").then(confJson => {
			if (confJson.length === 0)
				return;
			const newConf = CommentJSON.parse(confJson);
			const changed = jsonDiff.diff(config.server, newConf.server) || {};
			Object.assign(config, newConf);
			if (changed.cron)
				setupCron();
			if (changed[SITE_ID] && changed[SITE_ID].searchQueries) {
				availableQueryStrings.length = 0;
				availableQueryStrings.push(...config.server[SITE_ID].searchQueries);
				globalLog.info("Updated search query list: " + JSON.stringify(availableQueryStrings));
			}
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

		// sendNewWallpaper(socket, true).catch(socket.log.error);

		socket.on("set options", (ops) => {
			socket.log.info(`Got options for socket: ${JSON.stringify(ops)}`);
			const { label, resolution } = ops;
			if (label.length > 0)
				socket.log = createLoggerWithID(socket.id + ":" + label);

			const changed = JSON.stringify(socket.options?.resolution) !== JSON.stringify(resolution);
			socket.options = { resolution };
			if (changed)
				sendNewWallpaper(socket, true).catch(socket.log.error);
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

		socket.on("set only favorites", (newOnlyFavorites) => {
			// TODO
		});

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
