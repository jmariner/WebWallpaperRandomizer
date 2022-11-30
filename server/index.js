const path = require("path");
const { config } = require("dotenv");
const startServer = require("./lib/server");

config({ path: path.resolve(__dirname, ".env") });

startServer();
