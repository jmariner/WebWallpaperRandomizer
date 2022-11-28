// [min, max)
function rand(min, max) {
	return min + Math.floor(Math.random() * (max - min));
}

function randChoice(arr) {
	return arr[rand(0, arr.length)];
}

function setCssProp(prop, value) {
	document.body.style.setProperty(prop, value);
}

function makeURL(baseURL, query) {
	var url = new URL(baseURL);
	for (const [key, val] of Object.entries(query))
		url.searchParams.set(key, val);
	return url.toString();
}

function copyToClipboard(text) {
	const input = document.createElement("input");
	input.style.marginLeft = "-10000px";
	document.body.appendChild(input);
	input.value = text;
	input.select();
	document.execCommand("copy");
	input.remove();
}

async function doFetch(url, query, ops = {}) {
	const fullURL = makeURL(url, query);
	const result = await fetch(fullURL, {
		method: "GET",
		mode: "cors",
		...ops,
	});

	if (result.status !== 200)
		throw new Error(`Fetch failed - Status ${result.status}`);
	if (!result.ok)
		throw new Error("Fetch failed");

	return result;
}

// https://codeburst.io/throttling-and-debouncing-in-javascript-b01cad5c8edf
function debounce(func, delay) {
	let inDebounce;
	return function () {
		const context = this;
		const args = arguments;
		clearTimeout(inDebounce);
		inDebounce = setTimeout(() => func.apply(context, args), delay);
	};
}

function timeSince(t) {
	return Math.round(performance.now() - t);
}
