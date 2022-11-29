const BG_SIZING = {
	"black-bars": "contain",
	"zoom-crop": "cover",
};

const CYCLE_BTN = document.getElementById("cycle-button");
const OPEN_LINK_BTN = document.getElementById("open-link-button");
const OPEN_CONFIG_BTN = document.getElementById("open-config-button");
const CONN_ERROR_PORT = document.getElementById("conn-error-port");
const CONN_ERROR_DETAILS = document.getElementById("conn-error-details");

const blobURLCache = [];
let socket;

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

function handleCycleClicked() {
	if (socket && socket.connected)
		socket.emit("cycle");
}

function handleOpenLinkClicked() {
	if (socket && socket.connected)
		socket.emit("open wallpaper");
}

function handleOpenConfigClicked() {
	if (socket && socket.connected)
		socket.emit("open config");
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
	});

	socket.on("connect_error", (err) => {
		setConnectionError(true, { port, details: err.toString() });
	});

	socket.on("disconnect", (reason, details) => {
		setConnectionError(true, { port, details: `${reason}: ${details}` });
	});

	socket.on("update wallpaper", (info) => {
		const { img: imgBuffer, url: imgURL } = info;
		console.log("Got wallpaper", imgURL);

		if (blobURLCache.length >= 3) {
			for (const url of blobURLCache)
				URL.revokeObjectURL(url);

			// clear array, the JS way
			blobURLCache.length = 0;
		}

		const url = URL.createObjectURL(new Blob([imgBuffer], { type: "image/jpg" }));
		blobURLCache.push(url);
		setWallpaper(url);

	});
}

function setWallpaper(imgURL) {
	const oldActive = document.querySelector(".bg-wrap.active");
	const newActive = document.querySelector(".bg-wrap:not(.active)");
	newActive.style.setProperty("--wallpaper", `url(${imgURL})`);
	oldActive.classList.remove("active");
	newActive.classList.add("active");
}
