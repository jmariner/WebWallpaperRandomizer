const BG_SIZING = {
	"black-bars": "contain",
	"zoom-crop": "cover",
};

const CYCLE_BTN = document.getElementById("cycle-button");
const OPEN_LINK_BTN = document.getElementById("open-link-button");
const OPEN_CONFIG_BTN = document.getElementById("open-config-button");
const OPEN_LOGS_BTN = document.getElementById("open-logs-button");
const OPEN_FAVORITES_BTN = document.getElementById("open-favorites-button");
const CONN_ERROR_PORT = document.getElementById("conn-error-port");
const CONN_ERROR_DETAILS = document.getElementById("conn-error-details");
const CONTROLS_MORE_TOGGLE = document.getElementById("controls-more-toggle");

const options = {};
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
	}
};

CYCLE_BTN.addEventListener("click", handleCycleClicked);
OPEN_LINK_BTN.addEventListener("click", handleOpenLinkClicked);
OPEN_CONFIG_BTN.addEventListener("click", handleOpenConfigClicked);
OPEN_LOGS_BTN.addEventListener("click", handleOpenLogsClicked);
OPEN_FAVORITES_BTN.addEventListener("click", handleOpenFavoritesClicked);

function handleCycleClicked() {
	log.info("Sending request to cycle wallpaper...");
	if (socket && socket.connected)
		socket.emit("cycle");
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

	socket.on("update wallpaper", (info) => {
		const { img: imgBuffer } = info;
		// TODO handle other info (is favorite, category/purity/tags?)

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
}

function setWallpaper(imgURL) {
	const oldActive = document.querySelector(".bg-wrap.active");
	const newActive = document.querySelector(".bg-wrap:not(.active)");
	newActive.style.setProperty("--wallpaper", `url(${imgURL})`);
	oldActive.classList.remove("active");
	newActive.classList.add("active");
}
