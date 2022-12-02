const path = require("path");
const winston = require("winston");
require("winston-daily-rotate-file");

const CURRENT_LOG_FILENAME = "current.log";
let currentLogPath;

const levels = {
	error: 0,
	warn: 1,
	info: 2,
	debug: 3,
};

const formatLevel = (level) => level.replace(/[A-Z]/g, " $&").toUpperCase();

const dailyRotate = new winston.transports.DailyRotateFile({
	filename: "%DATE%.log",
	datePattern: "YYYY-MM-DD",
	dirname: process.env.LOGS_DIR,
	zippedArchive: true,
	createSymlink: true,
	symlinkName: CURRENT_LOG_FILENAME,
	maxSize: "10m",
});

dailyRotate.on("new", (newFile) => {
	currentLogPath = newFile;
});

dailyRotate.on("rotate", (old, newFile) => {
	currentLogPath = newFile;
});

const logger = winston.createLogger({
	level: "debug",
	levels,
	defaultMeta: { id: "GLOBAL" },
	format: winston.format.combine(
		winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS ZZ" }),
		winston.format.metadata({ key: "meta", fillWith: ["id"] }),
		winston.format.printf(({ timestamp, level, message, meta }) => `[${timestamp}] [${formatLevel(level)}] [${meta.id}] ${message}`)
	),
	transports: [
		dailyRotate,
		process.env.NODE_ENV !== 'production' ? new winston.transports.Console() : null,
	].filter(Boolean),
});

/** @param {any[]} args */
function formatLogMessage(args) {
	return args.map(a => a instanceof Error ? [a.message, a.stack].filter(Boolean).join("\n") : a.toString()).join(" ");
}

/**
 * @param {string} id
 * @returns {Record<keyof typeof levels, import("winston").LeveledLogMethod>}
 */
function createLoggerWithID(id) {
	return Object.keys(levels).reduce((obj, level) => ({
		...obj,
		[level]: (...args) => logger.log(level, formatLogMessage(args), { id }),
	}), {});
}

function getCurrentLogFile() {
	const dfr = dailyRotate;
	return currentLogPath;
}

module.exports = {
	createLoggerWithID,
	globalLog: createLoggerWithID("GLOBAL"),
	// LOG_FILE_PATH: path.resolve(process.env.LOGS_DIR, CURRENT_LOG_FILENAME),
	getCurrentLogFile,
};
