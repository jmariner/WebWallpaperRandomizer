const API_URL_BASE = "https://wallhaven.cc/api/v1/search";
const MAX_DIM = [1920, 1080];
const BG_SIZING = {
	"black-bars": "contain",
	"zoom-crop": "cover",
};

const FETCH_QUERY_BASE = {
	categories: "010",
	purity: "100",
	sorting: "random",
	atleast: "1600x900",
	ratios: "landscape",
};

const CYCLE_BTN = document.getElementById("cycle-button");
const COPY_LINK_BTN = document.getElementById("copy-link-button");

const setupCronDebounced = debounce(setupCron, 1000);
let cronJob = null;
let skipLoadingBuffer = true;
const blobURLCache = [];

const options = {};
window.wallpaperPropertyListener = {
	applyUserProperties: (props) => {
		Object.assign(
			options,
			Object.entries(props).reduce((obj, [key, val]) => ({ ...obj, [key]: val.value }), {})
		);

		if (props.image_sizing) {
			setCssProp("--wallpaper-sizing", BG_SIZING[props.image_sizing.value])
		}
		if (props.image_blur_sides) {
			setCssProp("--wallpaper-blur-behind-display", props.image_blur_sides.value ? "block" : "none");
		}
		if (props.image_position) {
			const [posY, posX] = props.image_position.value.split("-");
			setCssProp("--wallpaper-position", `${posX} ${posY}`);
		}
		if (props.bottom_padding) {
			setCssProp("--bottom-padding", `${props.bottom_padding.value}px`);
		}

		if (props.search_queries) {
			options.search_queries = options.search_queries.split(",").map(s => s.trim());
		}

		if (props.cron_pattern) {
			setupCronDebounced();
		}
	}
};

CYCLE_BTN.addEventListener("click", handleCycleClicked);
COPY_LINK_BTN.addEventListener("click", handleCopyLinkClicked);

function handleCycleClicked(e) {
	e?.preventDefault();
	skipLoadingBuffer = true;
	cycleBackground().catch(console.error);
	return false;
}

function handleCopyLinkClicked() {
	// page url can't be opened by normal means in CEF (abnormal means require C++ access)
	// copy to clipboard instead for now.
	const url = COPY_LINK_BTN.getAttribute("data-href");
	if (url) {
		copyToClipboard(url);
		COPY_LINK_BTN.classList.add("copied");
		setTimeout(() => {
			COPY_LINK_BTN.classList.remove("copied");
		}, 3000);
	}
}

function setupCron() {
	if (cronJob) {
		if (cronJob.status !== "running") {
			cronJob.start();
		}
		else if (cronJob.pattern === options.cron_pattern) {
			return;
		}
		else {
			cronJob.stop();
			cronJob.clear();
		}
	}

	console.info(`Creating cron job with pattern "${options.cron_pattern}"`);

	cronJob = new Cronr(
		options.cron_pattern,
		() => cycleBackground().catch(console.error),
		{ immediate: true }
	);

	if (options.search_queries) {
		console.info("Started cron job");
		cronJob.start();
	}
}

function setLoading(isLoading) {
	document.body.classList.toggle("loading", isLoading);
	CYCLE_BTN.disabled = isLoading;
}

async function cycleBackground() {

	if (document.body.classList.contains("loading"))
		return;

	try {

		if (blobURLCache.length >= 3) {
			for (const url of blobURLCache)
				URL.revokeObjectURL(url);

			// clear array, the JS way
			blobURLCache.length = 0;
		}

		const changeWallpaperAt = Date.now() + options.loading_buffer_sec * 1000;
		setLoading(true);

		const randQuery = randChoice(options.search_queries);
		const query = {
			...FETCH_QUERY_BASE,
			q: randQuery,
			apikey: options.api_key,
			page: 1,
		};

		let startLoadTime = performance.now();
		console.info(`Fetching with query "${randQuery}"...`);
		const result = await doFetch(API_URL_BASE, query);

		const { data, meta } = await result.json();
		if (data.length === 0)
			throw new Error("Invalid request: no wallpapers found");

		console.info(`Fetching complete in ${timeSince(startLoadTime)}ms`);

		const pageCount = meta.last_page;
		const randPage = rand(1, pageCount + 1);
		let wallpapers = data;
		if (randPage !== 1) {
			query.page = randPage;
			if (meta.seed)
				query.seed = meta.seed;

			startLoadTime = performance.now();
			console.info(`Fetching again for page ${randPage}...`);
			const result2 = await doFetch(API_URL_BASE, query);
			const json2 = await result2.json();
			console.info(`Fetching complete in ${timeSince(startLoadTime)}ms`);
			wallpapers = json2.data;
		}

		const randWallpaper = randChoice(wallpapers);

		console.info(`Chose wallpaper ${randWallpaper.short_url}`);

		// preload wallpaper
		startLoadTime = performance.now();
		const imagePath = await new Promise(resolve => {
			var loadingImg = new Image();
			loadingImg.src = randWallpaper.path;
			loadingImg.onload = () => {

				console.info(`Loading wallpaper took ${timeSince(startLoadTime)}ms`);

				const dim = [loadingImg.naturalWidth, loadingImg.naturalHeight];
				const ar = dim[0] / dim[1];
				let targetDim = [...dim];
				if (dim[0] > dim[1] && dim[0] > MAX_DIM[0])
					targetDim = [MAX_DIM[0], MAX_DIM[0] / ar];
				else if (dim[1] > MAX_DIM[1])
					targetDim = [MAX_DIM[1] * ar, MAX_DIM[1]];

				startLoadTime = performance.now();

				const imgData = ResizeImage.resize(loadingImg, targetDim[0], targetDim[1], ResizeImage.JPEG);
				// base64 to blob trick via https://stackoverflow.com/a/36183085
				fetch(imgData).then(res => res.blob()).then(blob => {

					const objURL = URL.createObjectURL(blob);
					blobURLCache.push(objURL);
					console.info(`Created data URL for image at size ${targetDim.map(Math.round).join("x")} in ${timeSince(startLoadTime)}ms`);

					loadingImg.src = "";
					loadingImg.onload = null;
					resolve(objURL);
				});
			};
		});

		const waitForChange = changeWallpaperAt - Date.now();
		if (!skipLoadingBuffer && waitForChange > 0) {
			console.info(`Waiting ${waitForChange}ms to display new wallpaper`);
			await new Promise(resolve => setTimeout(resolve, waitForChange));
		}

		setWallpaper(imagePath, randWallpaper.short_url);
		skipLoadingBuffer = false;
	}
	finally {
		setLoading(false);
	}
}

function setWallpaper(imgURL, pageURL) {
	const oldActive = document.querySelector(".bg-wrap.active");
	const newActive = document.querySelector(".bg-wrap:not(.active)");
	newActive.style.setProperty("--wallpaper", `url(${imgURL})`);
	oldActive.classList.remove("active");
	newActive.classList.add("active");

	COPY_LINK_BTN.setAttribute("data-href", pageURL);
}

window.addEventListener("DOMContentLoaded", () => { });
