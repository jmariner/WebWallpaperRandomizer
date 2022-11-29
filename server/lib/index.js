const { config: configDotenv } = require("dotenv");
const fs = require("fs").promises;
const path = require("path");
const { performance } = require("perf_hooks");
const fetch = require("node-fetch");
const chokidar = require('chokidar');
const { Server } = require("socket.io");
const sharp = require("sharp");
const open = require("open");
const { rand, randChoice, doFetch, timeSince, getResizedDim } = require("./utils");
const logger = require("./logger");

const ROOT_DIR = path.resolve(__dirname, "../..");
const CONFIG_PATH = path.resolve(ROOT_DIR, "config.json");
const API_URL_BASE = "https://wallhaven.cc/api/v1/search";
const TARGET_SIZE = [1920, 1080];

configDotenv({ path: path.resolve(ROOT_DIR, ".env") });

const config = { server: {} };

function setupCron() {
	// TODO
}

async function sendNewWallpaper(socket, skipLoadingBuffer) {
	const changeWallpaperAt = Date.now() + config.server.loadingBuffer * 1000;

	const { searchQueries, options: baseQuery } = config.server.wallhaven;
	const randQuery = randChoice(searchQueries);
	const query = {
		...baseQuery,
		q: randQuery,
		apikey: process.env.WALLHAVEN_API_KEY,
		page: 1,
	};

	let startLoadTime = performance.now();
	logger.info(`Fetching with query "${randQuery}"...`);
	const result = await doFetch(API_URL_BASE, query);

	const { data, meta } = await result.json();
	if (data.length === 0)
		throw new Error("Invalid request: no wallpapers found");

	logger.info(`Fetching complete in ${timeSince(startLoadTime)}ms`);

	const pageCount = meta.last_page;
	const randPage = rand(1, pageCount + 1);
	let wallpapers = data;
	if (randPage !== 1) {
		query.page = randPage;
		if (meta.seed)
			query.seed = meta.seed;

		startLoadTime = performance.now();
		logger.info(`Fetching again for page ${randPage}...`);
		const result2 = await doFetch(API_URL_BASE, query);
		const json2 = await result2.json();
		logger.info(`Fetching complete in ${timeSince(startLoadTime)}ms`);
		wallpapers = json2.data;
	}

	const { path: imgURL, short_url: wallpaperURL } = randChoice(wallpapers);

	logger.info(`Chose wallpaper ${wallpaperURL}`);

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

		logger.info(`Resized image from ${[width, height].map(Math.round).join("x")} to ${newSize.map(Math.round).join("x")}`);
	}
	else {
		logger.info(`Image already at target size (${TARGET_SIZE.map(Math.round).join("x")})`)
	}

	imgBuffer = await sharpImg.jpeg({ quality: 80 }).toBuffer();
	logger.info(`Finished image processing in ${timeSince(startLoadTime)}ms`);

	const waitForChange = changeWallpaperAt - Date.now();
	if (!skipLoadingBuffer && waitForChange > 0) {
		logger.info(`Waiting ${waitForChange}ms to display new wallpaper`);
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
		logger.info("Config file changed, updating...");
		fs.readFile(path, "utf-8").then(confJson => {
			if (confJson.length === 0)
				return;
			const newConf = JSON.parse(confJson);
			const cronChanged = newConf.server.cron !== config.server.cron;
			Object.assign(config, newConf);
			if (cronChanged)
				setupCron();
		}).catch(logger.error);
	});

	const io = new Server({
		cors: {
			origin: "*",
		},
	});

	io.on("connection", socket => {
		sendNewWallpaper(socket).catch(logger.error);

		socket.on("cycle", () => {
			sendNewWallpaper(socket).catch(logger.error);
		});

		socket.on("open wallpaper", () => {
			const url = socket.currentWallpaperURL;
			if (!url)
				return;
			logger.info(`Received request to open wallpaper, opening "${url}"`);
			open(socket.currentWallpaperURL);
		});

		socket.on("open config", () => {
			logger.info(`Received request to open config, opening file "${CONFIG_PATH}"`);
			open(CONFIG_PATH);
		});
	});

	io.listen(config.port);

	logger.info("Socket.io server started on port", config.port);
}

setup().catch(logger.error);
