"use strict";

var path = require("path");

function resolveNumber(value, fallbackValue) {
	var numericValue = Number(value);

	if (isFinite(numericValue) === false || numericValue <= 0) {
		return fallbackValue;
	}

	return numericValue;
}

function resolveConfig(overrides) {
	var values = overrides || {};
	var rootDir = values.rootDir || path.resolve(__dirname, "..");
	var runtimeDir = values.runtimeDir || path.join(rootDir, ".runtime");

	return {
		rootDir: rootDir,
		staticDir: values.staticDir || rootDir,
		runtimeDir: runtimeDir,
		databasePath: values.databasePath || path.join(runtimeDir, "game-sonic-running.sqlite"),
		port: resolveNumber(values.port != null ? values.port : process.env.PORT, 3000),
		jwtSecret: values.jwtSecret != null ? values.jwtSecret : String(process.env.JWT_SECRET || ""),
		adminPasswordHash: values.adminPasswordHash != null ? values.adminPasswordHash : String(process.env.ADMIN_PASSWORD_HASH || ""),
		nodeEnv: values.nodeEnv || process.env.NODE_ENV || "development",
		cookieName: "admin_token",
		jwtExpiresIn: "8h"
	};
}

function validateConfig(config) {
	if (config.jwtSecret.trim() === "") {
		throw new Error("Missing JWT_SECRET. Add it to .env before starting the server.");
	}

	if (config.adminPasswordHash.trim() === "") {
		throw new Error("Missing ADMIN_PASSWORD_HASH. Generate one with \"npm run hash-password -- <password>\" and add it to .env.");
	}
}

module.exports = {
	resolveConfig: resolveConfig,
	validateConfig: validateConfig
};
