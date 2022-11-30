const path = require("path");
const { config: configDotenv } = require("dotenv");

configDotenv(path.resolve(__dirname, "../../.env"));
