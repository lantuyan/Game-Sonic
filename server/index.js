"use strict";

var dotenv = require("dotenv");
var createApp = require("./app").createApp;

dotenv.config();

var runtime = createApp();
var app = runtime.app;
var config = runtime.config;

var server = app.listen(config.port, function () {
	console.log("Server listening on http://localhost:" + config.port);
});

function shutdownAndExit(exitCode) {
	server.close(function () {
		runtime.close();
		process.exit(exitCode);
	});
}

process.on("SIGINT", function () {
	shutdownAndExit(0);
});

process.on("SIGTERM", function () {
	shutdownAndExit(0);
});
