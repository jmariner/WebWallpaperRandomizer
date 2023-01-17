const crypto = require("crypto");
const fetch = require("node-fetch");
const { performance } = require("perf_hooks");

/** [min, max) */
function rand(min, max) {
	return crypto.randomInt(min, max);
	// return min + Math.floor(Math.random() * (max - min));
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

async function doFetch(url, query = {}, ops = {}) {
	const fullURL = makeURL(url, query);
	/** @type {import("node-fetch").Response} */
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

/**
 * @param {[number, number]} maxRes
 * @param {[number, number]} origRes
 * @returns {[number, number]}
 */
function getResizedDim(maxRes, origRes) {
	const ar = origRes[0] / origRes[1];
	let targetDim = [...origRes];
	if (origRes[0] > origRes[1] && origRes[0] > maxRes[0])
		targetDim = [maxRes[0], Math.round(maxRes[0] / ar)];
	else if (origRes[1] > maxRes[1])
		targetDim = [Math.round(maxRes[1] * ar), maxRes[1]];

	return targetDim;
}

/**
 * @param {[number, number]} res
 * @returns {string}
 */
function formatResolution(res) {
	return res.map(Math.round).join("x");
}

module.exports = {
	rand,
	randChoice,
	makeURL,
	doFetch,
	timeSince,
	getResizedDim,
	formatResolution,
};
