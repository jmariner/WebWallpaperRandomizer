module.exports = {
	apps: [{
		name: "WebWallpaperRandomizer-server",
		script: "./server/index.js",
		autorestart: true,
		max_restarts: 10,
		restart_delay: 5 * 1000,
		shutdown_with_message: true,
		env_production: {
			NODE_ENV: "production"
		},
	}]
}
