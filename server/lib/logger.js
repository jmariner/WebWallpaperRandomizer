const winston = require("winston");
require("winston-daily-rotate-file");

const levels = {
	error: 0,
	warn: 1,
	info: 2,
	debug: 3,
};

const formatLevel = (level) => level.replace(/[A-Z]/g, " $&").toUpperCase();

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
		new winston.transports.DailyRotateFile({
			filename: "%DATE%.log",
			datePattern: "YYYY-MM-DD",
			dirname: process.env.LOGS_DIR,
			zippedArchive: true,
			createSymlink: true,
			symlinkName: "current.log",
			maxSize: "10m",
		}),
		process.env.NODE_ENV !== 'production' ? new winston.transports.Console() : null,
	].filter(Boolean),
});

/**
 * @param {string} id
 * @returns {Record<keyof typeof levels, import("winston").LeveledLogMethod>}
 */
function createLoggerWithID(id) {
	return Object.keys(levels).reduce((obj, level) => ({
		...obj,
		[level]: (...args) => logger.log(level, args.join(" "), { id }),
	}), {});
}

module.exports = {
	createLoggerWithID,
	globalLog: createLoggerWithID("GLOBAL"),
};
