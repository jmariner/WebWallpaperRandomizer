const BG_SIZING = {
	"black-bars": "contain",
	"zoom-crop": "cover",
};
const META_DISPLAY_LEVELS = 2;

const CYCLE_BTN = document.getElementById("cycle-button");
const FAVORITE_BTN = document.getElementById("favorite-button");
const OPEN_LINK_BTN = document.getElementById("open-link-button");
const OPEN_CONFIG_BTN = document.getElementById("open-config-button");
const OPEN_LOGS_BTN = document.getElementById("open-logs-button");
const OPEN_FAVORITES_BTN = document.getElementById("open-favorites-button");
const CONN_ERROR_PORT = document.getElementById("conn-error-port");
const CONN_ERROR_DETAILS = document.getElementById("conn-error-details");
const CONTROLS_MORE_TOGGLE = document.getElementById("controls-more-toggle");
const VIEWS_COUNT_TEXT = document.getElementById("views-count");
const FAVORITES_COUNT_TEXT = document.getElementById("favorites-count");
/** @type {HTMLElement} */
const TAG_TEMPLATE = document.getElementById("tag-template").content;
const TAGS_WRAP = document.getElementById("tags-wrap");

const options = {};
const meta = {
	isFav: false,
	/** @type {Array<{ id: string, name: string }>} */
	tags: [],
	category: "",
	uploader: "",
};
const blobURLCache = [];
let socket;

const log = ["info", "warn", "error", "debug"].reduce((obj, level) => ({
	...obj,
	[level]: msg => {
		if (socket && socket.connected)
			socket.emit("log", { level, msg });
		else
			console[level](msg);
	},
}), {});

window.wallpaperPropertyListener = {
	applyUserProperties: (props) => {
		if (props.monitor_label) {
			options.monitorLabel = props.monitor_label.value.trim();
			if (socket && socket.connected)
				socket.emit("set label", options.monitorLabel);
		}
		if (props.socket_port) {
			const port = props.socket_port.value;
			console.info("Got port", port);
			if (/^\d{2,5}$/.test(port)) {
				setup(port);
			}
		}

		if (props.image_sizing) {
			document.body.style.setProperty("--wallpaper-sizing", BG_SIZING[props.image_sizing.value])
		}
		if (props.image_blur_sides) {
			document.body.style.setProperty("--wallpaper-blur-behind-display", props.image_blur_sides.value ? "block" : "none");
		}
		if (props.image_position) {
			const [posY, posX] = props.image_position.value.split("-");
			document.body.style.setProperty("--wallpaper-position", `${posX} ${posY}`);
		}
		if (props.bottom_padding) {
			document.body.style.setProperty("--bottom-padding", `${props.bottom_padding.value}px`);
		}

		if (props.meta_display_level) {
			const level = props.meta_display_level.value;
			for (let i = 1; i <= META_DISPLAY_LEVELS; i++)
				document.body.classList.toggle(`show-meta-${i}`, level >= i);
		}

		log.debug("Got updates to the following properties: " + Object.keys(props).join(", "));
	}
};

CYCLE_BTN.addEventListener("click", handleCycleClicked);
FAVORITE_BTN.addEventListener("click", handleFavoriteClicked);
OPEN_LINK_BTN.addEventListener("click", handleOpenLinkClicked);
OPEN_CONFIG_BTN.addEventListener("click", handleOpenConfigClicked);
OPEN_LOGS_BTN.addEventListener("click", handleOpenLogsClicked);
OPEN_FAVORITES_BTN.addEventListener("click", handleOpenFavoritesClicked);

function handleCycleClicked() {
	log.info("Sending request to cycle wallpaper...");
	if (socket && socket.connected)
		socket.emit("cycle");
}

function handleFavoriteClicked() {
	log.info("Sending request to toggle favorite...");
	if (socket && socket.connected)
		socket.emit("set favorite", !meta.isFav);
}

function handleOpenLinkClicked() {
	log.info("Sending request to open wallpaper page...");
	if (socket && socket.connected)
		socket.emit("open wallpaper");
}

function handleOpenConfigClicked() {
	log.info("Sending request to open config file...");
	if (socket && socket.connected)
		socket.emit("open config");
	CONTROLS_MORE_TOGGLE.checked = false;
}

function handleOpenLogsClicked() {
	log.info("Sending request to open logs file...");
	if (socket && socket.connected)
		socket.emit("open logs");
	CONTROLS_MORE_TOGGLE.checked = false;
}

function handleOpenFavoritesClicked() {
	log.info("Sending request to open favorites folder...");
	if (socket && socket.connected)
		socket.emit("open favorites");
	CONTROLS_MORE_TOGGLE.checked = false;
}

function setLoading(isLoading) {
	document.body.classList.toggle("loading", isLoading);
	CYCLE_BTN.disabled = isLoading;
}

function setConnectionError(isError, { port, details } = {}) {
	if (isError) {
		CONN_ERROR_PORT.innerText = port;
		CONN_ERROR_DETAILS.innerText = details;
	}

	document.body.classList.toggle("conn-error", isError);
}

function setup(port) {
	console.info("Connecting to socket on port", port);

	if (socket) {
		socket.off();
	}

	socket = io(`ws://localhost:${port}`);

	socket.on("connect", () => {
		setConnectionError(false);

		if (options.monitorLabel)
			socket.emit("set label", options.monitorLabel);
	});

	socket.on("connect_error", (err) => {
		setConnectionError(true, { port, details: err.toString() });
		console.error("Connection Error:", err);
	});

	socket.on("disconnect", (reason, details) => {
		setConnectionError(true, { port, details: `${reason} (${details.description})` });
		console.error("Disconnected. Reason:", reason, "Details:", details);
	});

	socket.on("update wallpaper", (imgBuffer) => {
		if (blobURLCache.length >= 3) {
			for (const url of blobURLCache)
				URL.revokeObjectURL(url);

			// clear array, the JS way
			blobURLCache.length = 0;
		}

		const url = URL.createObjectURL(new Blob([imgBuffer], { type: "image/jpg" }));
		blobURLCache.push(url);
		setWallpaper(url);
		log.info("Updated wallpaper");
	});

	socket.on("update meta", (newMeta) => {
		log.info("Got new meta: " + JSON.stringify(newMeta));
		Object.assign(meta, newMeta);

		const { isFav, tags, category, uploader, viewCount, favoriteCount } = meta;

		// handle fav
		document.body.classList.toggle("is-favorite", isFav);

		// handle tags
		while (TAGS_WRAP.firstChild)
			TAGS_WRAP.removeChild(TAGS_WRAP.firstChild);

		const createTag = (text) => {
			const tagEl = TAG_TEMPLATE.cloneNode(true);
			tagEl.querySelector(".tag").innerText = text;
			return tagEl;
		}

		for (const tag of tags) {
			if (tag.name === category)
				continue;
			TAGS_WRAP.append(createTag(tag.name));
		}

		// handle uploader/category as special tags
		for (const specialTagText of ["@" + uploader, category].reverse()) {
			const specialTag = createTag(specialTagText);
			specialTag.querySelector(".tag").classList.add("special-tag");
			TAGS_WRAP.prepend(specialTag);
		}

		// handle view/fav count
		VIEWS_COUNT_TEXT.innerText = viewCount;
		FAVORITES_COUNT_TEXT.innerHTML = favoriteCount;

		document.body.classList.add("has-meta");
	});
}

function setWallpaper(imgURL) {
	const oldActive = document.querySelector(".bg-wrap.active");
	const newActive = document.querySelector(".bg-wrap:not(.active)");
	newActive.style.setProperty("--wallpaper", `url(${imgURL})`);
	oldActive.classList.remove("active");
	newActive.classList.add("active");
}
