const path = require("path");
const { promises: fs, constants } = require("fs");
const { globalLog } = require("./logger");

const { FAVORITES_DIR } = process.env;

/** @typedef {import("./server").WallpaperInfo} WallpaperInfo */

/** @param {WallpaperInfo} info */
function makeFavoriteImagePath(info) {
	return path.resolve(FAVORITES_DIR, `${info.site}-${info.id}.jpg`);
}

const favorites = {
	/**
	 * @param {WallpaperInfo} info
	 * @returns {Promise<boolean>}
	 */
	async is(info) {
		const file = makeFavoriteImagePath(info);
		try {
			await fs.access(file, constants.F_OK);
			return true;
		}
		catch (e) {
			if (e.code === "ENOENT")
				return false;
			else
				throw e;
		}
	},

	/**
	 * @param {WallpaperInfo} info
	 * @param {boolean} isFav
	 */
	async set(info, isFav, imgBuffer) {
		if (isFav && !imgBuffer)
			throw new Error("Missing image buffer when trying to save favorite.");

		const currentFav = await this.is(info);
		if (currentFav === isFav) {
			if (!isFav)
				globalLog.warn("Tried to remove wallpaper from favorites but image file does not exist");
			else
				globalLog.warn("Tried to add wallpaper to favorites but file already exists");
			return;
		}

		const file = makeFavoriteImagePath(info);
		if (isFav) {
			await fs.writeFile(file, imgBuffer);
		}
		else {
			await fs.unlink(file);
		}
	},
};

module.exports = favorites;
