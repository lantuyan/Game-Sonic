"use strict";

var express = require("express");
var cookieParser = require("cookie-parser");
var path = require("path");
var QuestionModel = require("../shared/questionModel");
var auth = require("./auth");
var configModule = require("./config");
var dbModule = require("./db");
var playerStoreModule = require("./playerStore");
var createSqlClient = require("./sql").createSqlClient;

function createError(statusCode, message) {
	var error = new Error(message);
	error.statusCode = statusCode;
	return error;
}

function createApp(overrides) {
	var config = configModule.resolveConfig(overrides);
	configModule.validateConfig(config);

	var dataStore = dbModule.createDatabase(config);
	// Player data (leaderboard/skill) uses a separate Postgres client: Neon when
	// DATABASE_URL is set, embedded PGlite locally, or null on Vercel without Neon
	// (features degrade gracefully). The question bank stays on better-sqlite3.
	var playerSql = createSqlClient(config);
	var playerStore = playerStoreModule.createPlayerStore({ sql: playerSql });
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

	app.get("/api/levels/:level/question-bank", async function (request, response, next) {
		try {
			QuestionModel.assertLevel(request.params.level);
			response.json(await dataStore.getLevelBundle(request.params.level));
		} catch (error) {
			next(createError(400, error.message));
		}
	});

	app.put("/api/levels/:level/questions", auth.requireAdminAuth(config), async function (request, response, next) {
		try {
			QuestionModel.assertLevel(request.params.level);
			response.json(await dataStore.replaceQuestionsForLevel(request.params.level, request.body ? request.body.questions : null));
		} catch (error) {
			next(createError(400, error.message));
		}
	});

	app.put("/api/levels/:level/settings/point", auth.requireAdminAuth(config), async function (request, response, next) {
		try {
			QuestionModel.assertLevel(request.params.level);
			response.json(await dataStore.updatePointSettingsForLevel(request.params.level, request.body ? request.body.settings : null));
		} catch (error) {
			next(createError(400, error.message));
		}
	});

	app.put("/api/levels/:level/settings/time", auth.requireAdminAuth(config), async function (request, response, next) {
		try {
			QuestionModel.assertLevel(request.params.level);
			response.json(await dataStore.updateTimeSettingsForLevel(request.params.level, request.body ? request.body.settings : null));
		} catch (error) {
			next(createError(400, error.message));
		}
	});

	app.put("/api/levels/:level/settings/speed", auth.requireAdminAuth(config), async function (request, response, next) {
		try {
			QuestionModel.assertLevel(request.params.level);
			response.json(await dataStore.updateGameSpeedForLevel(request.params.level, request.body ? request.body.value : null));
		} catch (error) {
			next(createError(400, error.message));
		}
	});

	// --- Player routes (public): leaderboard + adaptive skill profiles ---

	app.post("/api/scores", async function (request, response, next) {
		try {
			response.json(await playerStore.submitScore(request.body || {}));
		} catch (error) {
			next(error);
		}
	});

	app.get("/api/levels/:level/leaderboard", async function (request, response, next) {
		try {
			var deviceId = request.query ? request.query.deviceId : null;
			response.json(await playerStore.getLeaderboard(request.params.level, deviceId));
		} catch (error) {
			next(error);
		}
	});

	app.put("/api/players/:deviceId/nickname", async function (request, response, next) {
		try {
			response.json(await playerStore.updateNickname(request.params.deviceId, request.body ? request.body.nickname : null));
		} catch (error) {
			next(error);
		}
	});

	app.put("/api/players/:deviceId/skill", async function (request, response, next) {
		try {
			response.json(await playerStore.saveSkill(request.params.deviceId, request.body || {}));
		} catch (error) {
			next(error);
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
			if (playerSql != null && typeof playerSql.close === "function") {
				playerSql.close();
			}
		},
		config: config
	};
}

module.exports = {
	createApp: createApp
};
