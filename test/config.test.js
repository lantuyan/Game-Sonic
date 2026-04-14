"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
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
