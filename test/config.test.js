"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("path");
var configModule = require("../server/config");

test("validateConfig rejects placeholder secrets", function () {
	assert.throws(function () {
		configModule.validateConfig({
			jwtSecret: "replace-with-a-long-random-secret",
			adminPasswordHash: "$2b$10$validlookinghashvaluebutunusedunusedunusedunusedunused"
		});
	}, /Missing JWT_SECRET/);

	assert.throws(function () {
		configModule.validateConfig({
			jwtSecret: "real-secret",
			adminPasswordHash: "replace-with-output-from-npm-run-hash-password"
		});
	}, /Missing ADMIN_PASSWORD_HASH/);
});

test("resolveConfig uses Vercel writable temp directory for SQLite", function () {
	var originalVercel = process.env.VERCEL;
	var originalDatabasePath = process.env.DATABASE_PATH;

	try {
		process.env.VERCEL = "1";
		delete process.env.DATABASE_PATH;

		var config = configModule.resolveConfig({
			jwtSecret: "real-secret",
			adminPasswordHash: "$2b$10$validlookinghashvaluebutunusedunusedunusedunusedunused"
		});

		assert.equal(config.runtimeDir, path.join("/tmp", "game-sonic-running"));
		assert.equal(config.databasePath, path.join("/tmp", "game-sonic-running", "game-sonic-running.sqlite"));

		process.env.DATABASE_PATH = "/tmp/custom-sonic.sqlite";
		assert.equal(configModule.resolveConfig().databasePath, "/tmp/custom-sonic.sqlite");
	} finally {
		if (originalVercel == null) {
			delete process.env.VERCEL;
		} else {
			process.env.VERCEL = originalVercel;
		}

		if (originalDatabasePath == null) {
			delete process.env.DATABASE_PATH;
		} else {
			process.env.DATABASE_PATH = originalDatabasePath;
		}
	}
});
