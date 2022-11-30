const fs = require("fs").promises;
const { performance } = require("perf_hooks");
const fetch = require("node-fetch");
const chokidar = require("chokidar");
const { Server } = require("socket.io");
const sharp = require("sharp");
const open = require("open");
const cron = require("node-cron");
const { rand, randChoice, doFetch, timeSince, getResizedDim } = require("./utils");
const { createLoggerWithID, globalLog } = require("./logger");

const API_URL_BASE = "https://wallhaven.cc/api/v1/search";
const TARGET_SIZE = [1920, 1080];
const { CONFIG_PATH } = process.env;

const config = { server: {} };
/** @type {import("socket.io").Server} */
let server;
/** @type {import("node-cron").ScheduledTask} */
let cronTask;

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
	const log = socket.log;
	const changeWallpaperAt = performance.now() + config.server.loadingBuffer * 1000;

	const { searchQueries, options: baseQuery } = config.server.wallhaven;
	const randQuery = randChoice(searchQueries);
	const query = {
		...baseQuery,
		q: randQuery,
		apikey: process.env.WALLHAVEN_API_KEY,
		page: 1,
	};

	let startLoadTime = performance.now();
	log.info(`Fetching with query "${randQuery}"...`);
	const result = await doFetch(API_URL_BASE, query);

	const { data, meta } = await result.json();
	if (data.length === 0)
		throw new Error("Invalid request: no wallpapers found");

	log.info(`Fetching complete in ${timeSince(startLoadTime)}ms`);

	const pageCount = meta.last_page;
	const randPage = rand(1, pageCount + 1);
	let wallpapers = data;
	if (randPage !== 1) {
		query.page = randPage;
		if (meta.seed)
			query.seed = meta.seed;

		startLoadTime = performance.now();
		log.info(`Fetching again for page ${randPage}...`);
		const result2 = await doFetch(API_URL_BASE, query);
		const json2 = await result2.json();
		log.info(`Fetching complete in ${timeSince(startLoadTime)}ms`);
		wallpapers = json2.data;
	}

	const { path: imgURL, short_url: wallpaperURL } = randChoice(wallpapers);

	log.info(`Chose wallpaper ${wallpaperURL}`);

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

		log.info(`Resized image from ${[width, height].map(Math.round).join("x")} to ${newSize.map(Math.round).join("x")}`);
	}
	else {
		log.info(`Image already at target size (${TARGET_SIZE.map(Math.round).join("x")})`)
	}

	imgBuffer = await sharpImg.jpeg({ quality: 80 }).toBuffer();
	log.info(`Finished image processing in ${timeSince(startLoadTime)}ms`);

	const waitForChange = changeWallpaperAt - performance.now();
	if (!skipLoadingBuffer && waitForChange > 0) {
		log.info(`Waiting ${Math.round(waitForChange)}ms to display new wallpaper`);
		await new Promise(resolve => setTimeout(resolve, waitForChange));
	}

	socket.currentWallpaperURL = wallpaperURL;
	socket.emit("update wallpaper", {
		img: imgBuffer,
		fav: false,
	})
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

		socket.on("cycle", () => {
			socket.log.info("Received request to cycle wallpaper, running...");
			sendNewWallpaper(socket, true).catch(socket.log.error);
		});

		socket.on("open wallpaper", () => {
			const url = socket.currentWallpaperURL;
			if (!url)
				return;
			socket.log.info(`Received request to open wallpaper, opening "${url}"`);
			open(socket.currentWallpaperURL);
		});

		socket.on("open config", () => {
			socket.log.info(`Received request to open config, opening file "${CONFIG_PATH}"`);
			open(CONFIG_PATH);
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
