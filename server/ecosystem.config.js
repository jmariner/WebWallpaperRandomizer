const path = require("path");

module.exports = {
	apps: [{
		name: "WebWallpaperRandomizer-server",
		script: "./server/index.js",
		cwd: path.resolve(__dirname, ".."),
		autorestart: true,
		max_restarts: 10,
		restart_delay: 5 * 1000,
		env_production: {
			NODE_ENV: "production"
		},
	}]
}
