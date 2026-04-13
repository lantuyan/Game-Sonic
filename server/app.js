"use strict";

var express = require("express");
var cookieParser = require("cookie-parser");
var path = require("path");
var QuestionModel = require("../shared/questionModel");
var auth = require("./auth");
var configModule = require("./config");
var dbModule = require("./db");

function createError(statusCode, message) {
	var error = new Error(message);
	error.statusCode = statusCode;
	return error;
}

function createApp(overrides) {
	var config = configModule.resolveConfig(overrides);
	configModule.validateConfig(config);

	var dataStore = dbModule.createDatabase(config);
	var app = express();

	app.disable("x-powered-by");
	app.use(express.json({ limit: "1mb" }));
	app.use(cookieParser());

	app.get("/api/health", function (request, response) {
		response.json({
			status: "ok",
			database: "ready"
		});
	});

	app.post("/api/admin/login", async function (request, response, next) {
		try {
			var password = request.body && typeof request.body.password === "string" ? request.body.password : "";

			if (password.trim() === "") {
				throw createError(400, "Password is required.");
			}

			var isValidPassword = await auth.verifyAdminPassword(password, config);

			if (isValidPassword !== true) {
				throw createError(401, "Mật khẩu admin chưa đúng.");
			}

			auth.setAdminCookie(response, auth.createAdminToken(config), config);
			response.json({
				authenticated: true
			});
		} catch (error) {
			next(error);
		}
	});

	app.post("/api/admin/logout", function (request, response) {
		auth.clearAdminCookie(response, config);
		response.json({
			authenticated: false
		});
	});

	app.get("/api/admin/session", function (request, response) {
		response.json({
			authenticated: auth.isAuthenticated(request, config) === true
		});
	});

	app.get("/api/levels/:level/question-bank", function (request, response, next) {
		try {
			QuestionModel.assertLevel(request.params.level);
			response.json(dataStore.getLevelBundle(request.params.level));
		} catch (error) {
			next(createError(400, error.message));
		}
	});

	app.put("/api/levels/:level/questions", auth.requireAdminAuth(config), function (request, response, next) {
		try {
			QuestionModel.assertLevel(request.params.level);
			response.json(dataStore.replaceQuestionsForLevel(request.params.level, request.body ? request.body.questions : null));
		} catch (error) {
			next(createError(400, error.message));
		}
	});

	app.put("/api/levels/:level/settings/point", auth.requireAdminAuth(config), function (request, response, next) {
		try {
			QuestionModel.assertLevel(request.params.level);
			response.json(dataStore.updatePointSettingsForLevel(request.params.level, request.body ? request.body.settings : null));
		} catch (error) {
			next(createError(400, error.message));
		}
	});

	app.put("/api/levels/:level/settings/time", auth.requireAdminAuth(config), function (request, response, next) {
		try {
			QuestionModel.assertLevel(request.params.level);
			response.json(dataStore.updateTimeSettingsForLevel(request.params.level, request.body ? request.body.settings : null));
		} catch (error) {
			next(createError(400, error.message));
		}
	});

	app.use(function (request, response, next) {
		var blockedRootItems = {
			"server": true,
			"test": true,
			"questions": true,
			"node_modules": true
		};
		var firstSegment = request.path.split("/").filter(Boolean)[0] || "";
		var fileName = path.basename(request.path || "");

		if (
			firstSegment.charAt(0) === "." ||
			blockedRootItems[firstSegment] === true ||
			fileName === ".env" ||
			fileName === ".env.example" ||
			fileName === ".gitignore" ||
			fileName === "package.json" ||
			fileName === "package-lock.json"
		) {
			response.status(404).end();
			return;
		}

		next();
	});

	app.use(express.static(config.staticDir, {
		index: "index.html",
		dotfiles: "ignore"
	}));

	app.use(function (request, response) {
		if (request.path.indexOf("/api/") === 0) {
			response.status(404).json({
				error: "Not found."
			});
			return;
		}

		if (
			request.method === "GET" &&
			path.extname(request.path || "") === "" &&
			String(request.headers.accept || "").indexOf("text/html") !== -1
		) {
			response.status(404).sendFile(path.join(config.staticDir, "index.html"));
			return;
		}

		response.status(404).send("Not found.");
	});

	app.use(function (error, request, response, next) {
		var statusCode = error && typeof error.statusCode === "number" ? error.statusCode : 500;
		var message = error && error.message ? error.message : "Internal server error.";

		if (statusCode >= 500) {
			console.error(error);
		}

		if (request.path.indexOf("/api/") === 0) {
			response.status(statusCode).json({
				error: message
			});
			return;
		}

		response.status(statusCode).send(message);
	});

	return {
		app: app,
		close: function () {
			dataStore.close();
		},
		config: config
	};
}

module.exports = {
	createApp: createApp
};
