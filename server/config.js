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
	var runtimeDir = values.runtimeDir || (process.env.VERCEL === "1" ? path.join("/tmp", "game-sonic-running") : path.join(rootDir, ".runtime"));
	var databasePath = values.databasePath || process.env.DATABASE_PATH || path.join(runtimeDir, "game-sonic-running.sqlite");

	return {
		rootDir: rootDir,
		staticDir: values.staticDir || rootDir,
		runtimeDir: runtimeDir,
		databasePath: databasePath,
		// Postgres connection string (Neon) for production. When empty, the SQL
		// layer falls back to embedded PGlite stored under pgDataDir.
		databaseUrl: values.databaseUrl != null ? values.databaseUrl : String(process.env.DATABASE_URL || ""),
		pgDataDir: values.pgDataDir || path.join(runtimeDir, "pgdata"),
		// Optional shared SQL client (lets question store + player store reuse one connection).
		sqlClient: values.sqlClient != null ? values.sqlClient : null,
		port: resolveNumber(values.port != null ? values.port : process.env.PORT, 3000),
		jwtSecret: values.jwtSecret != null ? values.jwtSecret : String(process.env.JWT_SECRET || ""),
		adminPasswordHash: values.adminPasswordHash != null ? values.adminPasswordHash : String(process.env.ADMIN_PASSWORD_HASH || ""),
		nodeEnv: values.nodeEnv || process.env.NODE_ENV || "development",
		cookieName: "admin_token",
		jwtExpiresIn: "8h"
	};
}

function isPlaceholderSecret(value) {
	var normalizedValue = String(value || "").trim().toLowerCase();

	return normalizedValue === "" || normalizedValue.indexOf("replace-with-") === 0;
}

function validateConfig(config) {
	if (isPlaceholderSecret(config.jwtSecret)) {
		throw new Error("Missing JWT_SECRET. Add it to .env before starting the server.");
	}

	if (isPlaceholderSecret(config.adminPasswordHash)) {
		throw new Error("Missing ADMIN_PASSWORD_HASH. Generate one with \"npm run hash-password -- <password>\" and add it to .env.");
	}
}

module.exports = {
	resolveConfig: resolveConfig,
	validateConfig: validateConfig
};
