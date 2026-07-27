"use strict";

var express = require("express");
var rateLimit = require("express-rate-limit");
var cookieParser = require("cookie-parser");
var path = require("path");
var QuestionModel = require("../shared/questionModel");
var auth = require("./auth");
var configModule = require("./config");
var dbModule = require("./db");
var playerStoreModule = require("./playerStore");
var createSqlClient = require("./sql").createSqlClient;
var runToken = require("./runToken");
var scoreCheck = require("./scoreCheck");

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
	// (features degrade gracefully). The question bank stays on an in-memory JSON store.
	var playerSql = createSqlClient(config);
	var playerStore = playerStoreModule.createPlayerStore({ sql: playerSql });
	var app = express();

	app.disable("x-powered-by");
	app.use(express.json({ limit: "1mb" }));
	app.use(cookieParser());

	// P1-4 · giới hạn tần suất. Hai con số khác nhau vì hai mối lo khác nhau:
	//   · 10 submit/phút — một ván ngắn nhất cũng 45s, nên 10/phút là rộng rãi cho
	//     người chơi thật nhưng chặn được vòng lặp bơm điểm;
	//   · 5 login admin/phút — chặn dò mật khẩu.
	// `validate: false`: sau proxy của Vercel, express-rate-limit cảnh báo về
	// X-Forwarded-For; ta chấp nhận đếm theo IP mà proxy báo.
	var scoreLimiter = rateLimit({
		windowMs: 60 * 1000,
		max: 10,
		standardHeaders: true,
		legacyHeaders: false,
		validate: false,
		message: { error: "Em nộp điểm hơi nhanh, đợi một chút nhé." }
	});

	var loginLimiter = rateLimit({
		windowMs: 60 * 1000,
		max: 5,
		standardHeaders: true,
		legacyHeaders: false,
		validate: false,
		message: { error: "Sai quá nhiều lần. Thử lại sau một phút." }
	});

	/** Điểm cao nhất một câu của lớp — trần kiểm chéo cần con số thật, không đoán. */
	async function maxPointForLevel(level) {
		try {
			QuestionModel.assertLevel(level);
			var bundle = await dataStore.getLevelBundle(level);
			var points = Object.values(bundle.pointSettings || {}).map(Number).filter(Number.isFinite);
			return points.length > 0 ? Math.max.apply(null, points) : 100;
		} catch (error) {
			// Lớp lạ / store lỗi: dùng trần rộng rãi thay vì tố oan người chơi.
			return 100;
		}
	}

	// Hợp đồng V1 (plan §7.3.2): shape {status, database} GIỮ NGUYÊN từng ký tự.
	// P0-14 chỉ THÊM field mới dbKind/dbOk — client cũ bỏ qua field lạ.
	app.get("/api/health", async function (request, response) {
		var dbKind = playerSql != null && typeof playerSql.kind === "string" ? playerSql.kind : "none";
		var dbOk = false;

		if (playerSql != null) {
			try {
				await playerSql.query("SELECT 1", []);
				dbOk = true;
			} catch (error) {
				dbOk = false;
			}
		}

		response.json({
			status: "ok",
			database: "ready",
			dbKind: dbKind,
			dbOk: dbOk
		});
	});

	app.post("/api/admin/login", loginLimiter, async function (request, response, next) {
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

	app.put("/api/levels/:level/settings/quiz-mode", auth.requireAdminAuth(config), async function (request, response, next) {
		try {
			QuestionModel.assertLevel(request.params.level);
			response.json(await dataStore.updateQuizModeForLevel(request.params.level, request.body ? request.body.value : null));
		} catch (error) {
			next(createError(400, error.message));
		}
	});

	// --- Player routes (public): leaderboard + adaptive skill profiles ---

	// P1-4 · vé một-ván. Client xin vé lúc bắt đầu, nộp lại kèm điểm.
	app.post("/api/runs/start", scoreLimiter, function (request, response) {
		response.json(runToken.issueRunToken(config.jwtSecret));
	});

	app.post("/api/scores", scoreLimiter, async function (request, response, next) {
		try {
			var body = request.body || {};
			var ticket = runToken.verifyRunToken(body.token, body.runId, config.jwtSecret);

			// Vé SAI (chữ ký hỏng / hết hạn / dùng lại) → 4xx. Đây là trường hợp duy
			// nhất bị từ chối thẳng: nó chỉ xảy ra khi có ai đó cố tình nghịch.
			if (ticket.ok === false && ticket.reason !== "missing") {
				throw createError(400, "Vé ván chơi không hợp lệ (" + ticket.reason + ").");
			}

			// KHÔNG có vé: client V1 cũ vẫn nộp kiểu này, không được làm gãy nó.
			// Chỉ khi bật ANTICHEAT_ENFORCE=1 (Checklist release P1) mới từ chối.
			if (ticket.ok === false && config.anticheatEnforce === true) {
				throw createError(400, "Thiếu vé ván chơi.");
			}

			// Kiểm chéo tính hợp lý — vi phạm thì VẪN NHẬN, chỉ hạ verified.
			var plausibility = scoreCheck.checkPlausibility(body, await maxPointForLevel(body.level));

			if (plausibility.plausible === false) {
				console.warn(
					"[anticheat] điểm bất thường (" + plausibility.reason + "): level=" + body.level +
					" score=" + body.score + " correct=" + body.correctCount + " duration=" + body.durationMs +
					" trần=" + Math.round(plausibility.ceiling)
				);
			}

			var allowed = await playerStore.isNicknameAllowed(body.nickname);
			var payload = Object.assign({}, body, {
				verified: ticket.ok === true && plausibility.plausible === true,
				nickname: allowed.allowed === true ? body.nickname : "Người chơi ẩn danh"
			});

			response.json(await playerStore.submitScore(payload));
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
			var nickname = request.body ? request.body.nickname : null;
			var allowed = await playerStore.isNicknameAllowed(nickname);

			// P1-4: từ chối NGAY và nói rõ lý do, thay vì âm thầm đổi tên — học sinh
			// phải biết vì sao biệt danh không được nhận để tự sửa.
			if (allowed.allowed === false) {
				throw createError(
					400,
					allowed.reason === "badword"
						? "Biệt danh có từ không phù hợp, em chọn tên khác nhé."
						: "Biệt danh này đã bị khoá, em chọn tên khác nhé."
				);
			}

			response.json(await playerStore.updateNickname(request.params.deviceId, nickname));
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

	// --- Kiểm duyệt (admin, P1-4) ---------------------------------------------

	app.get("/api/admin/scores", auth.requireAdminAuth(config), async function (request, response, next) {
		try {
			response.json(await playerStore.listScores(request.query.level, request.query.limit));
		} catch (error) {
			next(error);
		}
	});

	app.delete("/api/admin/scores/:id", auth.requireAdminAuth(config), async function (request, response, next) {
		try {
			response.json(await playerStore.deleteScore(request.params.id));
		} catch (error) {
			next(error);
		}
	});

	app.get("/api/admin/blocked-nicknames", auth.requireAdminAuth(config), async function (request, response, next) {
		try {
			response.json(await playerStore.listBlockedNicknames());
		} catch (error) {
			next(error);
		}
	});

	app.post("/api/admin/blocked-nicknames", auth.requireAdminAuth(config), async function (request, response, next) {
		try {
			var body = request.body || {};
			response.json(await playerStore.blockNickname(body.nickname, body.reason, body.replacement));
		} catch (error) {
			next(error);
		}
	});

	app.delete("/api/admin/blocked-nicknames/:nickname", auth.requireAdminAuth(config), async function (request, response, next) {
		try {
			response.json(await playerStore.unblockNickname(request.params.nickname));
		} catch (error) {
			next(error);
		}
	});

	// P0-15: bookmark cũ `EndlessRunner.htm` → 301 về "/" (V2 đã chiếm route gốc).
	// Đặt TRƯỚC express.static: ở máy dev, staticDir là gốc repo và file cũ vẫn nằm
	// đó, không chặn trước thì static sẽ phục vụ V1 thay vì chuyển hướng.
	app.get(["/EndlessRunner.htm", "/EndlessRunner.html"], function (request, response) {
		response.redirect(301, "/");
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
