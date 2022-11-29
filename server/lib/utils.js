// const URL = require("url");
const fetch = require("node-fetch");
const { performance } = require("perf_hooks");

/** [min, max) */
function rand(min, max) {
	return min + Math.floor(Math.random() * (max - min));
}

function randChoice(arr) {
	return arr[rand(0, arr.length)];
}

function makeURL(baseURL, query) {
	const url = new URL(baseURL);
	for (const [key, val] of Object.entries(query))
		url.searchParams.set(key, val);
	return url.toString();
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

function timeSince(t) {
	return Math.round(performance.now() - t);
}

function getResizedDim(maxX, maxY, x, y) {
	const max = [maxX, maxY];
	const dim = [x, y];
	const ar = dim[0] / dim[1];
	let targetDim = [...dim];
	if (dim[0] > dim[1] && dim[0] > max[0])
		targetDim = [max[0], Math.round(max[0] / ar)];
	else if (dim[1] > max[1])
		targetDim = [Math.round(max[1] * ar), max[1]];

	return targetDim;
}

module.exports = {
	rand,
	randChoice,
	makeURL,
	doFetch,
	timeSince,
	getResizedDim,
};
