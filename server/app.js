"use strict";

var express = require("express");
var rateLimit = require("express-rate-limit");
var cookieParser = require("cookie-parser");
var fs = require("fs");
var path = require("path");
var QuestionModel = require("../shared/questionModel");
var auth = require("./auth");
var configModule = require("./config");
var dbModule = require("./db");
var playerStoreModule = require("./playerStore");
var createSqlClient = require("./sql").createSqlClient;
var runToken = require("./runToken");
var scoreCheck = require("./scoreCheck");
var seasonModule = require("./season");
var statsStoreModule = require("./statsStore");
var economyStoreModule = require("./economyStore");
var shopCatalog = require("./shopCatalog");
var questionImport = require("./questionImport");
var classStoreModule = require("./classStore");
var adminUserStoreModule = require("./adminUserStore");
var adminUser = require("./adminUser");

function createError(statusCode, message) {
	var error = new Error(message);
	error.statusCode = statusCode;
	return error;
}

function createApp(overrides) {
	var config = configModule.resolveConfig(overrides);
	configModule.validateConfig(config);

	// Một SQL client dùng chung cho MỌI kho: leaderboard/skill, thống kê, và (từ
	// P1-7) cả ngân hàng câu hỏi khi có Neon. Neon khi có DATABASE_URL, PGlite nhúng
	// ở máy dev, hoặc null trên Vercel chưa cấu hình Neon (tính năng tắt êm).
	var playerSql = createSqlClient(config);
	// P1-7: kho câu hỏi chạy Postgres khi có DATABASE_URL, ngược lại giữ kho JSON.
	var dataStore = dbModule.createDatabase(config, playerSql);
	// P2-8 · mốc "Mùa 2" của bảng xếp hạng. `validateConfig` đã kiểm chuỗi đọc được,
	// nên ở đây parse lại là an toàn. `null` = chưa chốt ngày ⇒ một bảng duy nhất.
	var seasonStartAt = seasonModule.parseSeasonStart(config.leaderboardSeason2Start);
	var playerStore = playerStoreModule.createPlayerStore({ sql: playerSql, seasonStartAt: seasonStartAt });
	// P1-6 · dashboard giáo viên. Dùng chung SQL client; schema do playerStore áp
	// (applySchema là idempotent nên không cần điều phối gì thêm).
	var statsStore = statsStoreModule.createStatsStore({ sql: playerSql });
	// P2-3 · ví / sổ cái xu / quyền sở hữu. Dùng chung SQL client; schema idempotent.
	var economyStore = economyStoreModule.createEconomyStore({ sql: playerSql });
	// P2-5 · mã lớp học + thành viên lớp. Dùng chung SQL client; schema idempotent.
	var classStore = classStoreModule.createClassStore({ sql: playerSql });
	// P2-7 · tài khoản quản trị. Dùng chung SQL client; schema idempotent. Không có
	// CSDL thì kho trả `disabled: true` và đăng nhập rơi về `ADMIN_PASSWORD_HASH` —
	// đúng trạng thái production hôm nay, không phải chế độ suy giảm.
	var adminUserStore = adminUserStoreModule.createAdminUserStore({ sql: playerSql });
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
	// ⚠ ĐẾM THEO `deviceId`, KHÔNG theo IP.
	//
	// Cả một phòng máy của trường đi qua MỘT địa chỉ IP sau NAT. Đếm theo IP nghĩa
	// là 30 em cùng lớp chia nhau 10 lượt nộp mỗi phút — hết tiết học thì quá nửa
	// lớp bị chặn oan, mà không em nào làm gì sai. Mỗi máy có `deviceId` riêng
	// (khoá `endlessrunner-device-id-v1`), nên "10 lượt/phút/máy" mới đúng ý định:
	// chặn vòng lặp bơm điểm, không chặn cả lớp.
	//
	// deviceId sửa được ở client — nhưng ai đã sửa deviceId để lách rate-limit thì
	// vẫn vướng vé ván chơi và kiểm chéo điểm ở `verified`. Rate-limit không phải
	// tuyến phòng thủ chính, nó chỉ để không ai vô tình (hay cố ý) làm nghẽn server.
	var scoreLimiter = rateLimit({
		windowMs: 60 * 1000,
		max: 10,
		standardHeaders: true,
		legacyHeaders: false,
		validate: false,
		keyGenerator: function (request) {
			var deviceId = request.body != null ? request.body.deviceId : null;

			return typeof deviceId === "string" && deviceId.trim() !== ""
				? "device:" + deviceId.trim().slice(0, 64)
				: "ip:" + (request.ip || "unknown");
		},
		message: { error: "Em nộp điểm hơi nhanh, đợi một chút nhé." }
	});

	// P2-3 · giới hạn tần suất cho các route kinh tế.
	//
	// ĐẾM THEO `deviceId` LẤY TỪ ĐƯỜNG DẪN, không theo IP — cùng một lý do đã ghi
	// dài ở `scoreLimiter`: cả phòng máy trường đi qua một IP sau NAT, đếm theo IP
	// là 30 em chia nhau một hạn mức. Ở đây `deviceId` nằm trong `req.params` (route
	// dạng `/api/players/:deviceId/...`), nên keyGenerator đọc params trước, ngã về
	// body rồi mới tới IP. Có test khoá cả ba nhánh — nếu express đổi thời điểm gán
	// `req.params` thì phải biết ngay, chứ không phải phát hiện lúc cả lớp bị chặn.
	//
	// 60/phút/máy: rộng hơn `scoreLimiter` vì một lần đẩy outbox có thể theo sau
	// một lần mua và một lần đọc hồ sơ, mà vẫn đủ chặt để chặn vòng lặp bơm xu.
	var economyLimiter = rateLimit({
		windowMs: 60 * 1000,
		max: 60,
		standardHeaders: true,
		legacyHeaders: false,
		validate: false,
		keyGenerator: function (request) {
			var fromParams = request.params != null ? request.params.deviceId : null;
			var fromBody = request.body != null ? request.body.deviceId : null;
			var deviceId = typeof fromParams === "string" && fromParams.trim() !== ""
				? fromParams
				: (typeof fromBody === "string" ? fromBody : "");

			return deviceId.trim() !== ""
				? "device:" + deviceId.trim().slice(0, 64)
				: "ip:" + (request.ip || "unknown");
		},
		message: { error: "Thao tác hơi nhanh, em đợi một chút nhé." }
	});

	// P2-5 · giới hạn tần suất cho các route lớp học của HỌC SINH.
	//
	// ĐẾM THEO `deviceId` — cùng lý do NAT phòng máy đã ghi ở `scoreLimiter`. Ở đây
	// `deviceId` nằm trong body (nhập mã) hoặc trong đường dẫn (xem/rời lớp).
	//
	// 12 lượt/phút/máy: một em gõ nhầm mã vài lần là chuyện thường (mã có 8 ký tự và
	// được chép từ trên bảng), nhưng 12 lượt/phút không giúp được gì cho việc dò mã.
	// ⚠ Rate-limit KHÔNG phải tuyến phòng thủ chính chống dò mã — kẻ tấn công đổi
	// deviceId là có hạn mức mới. Tuyến phòng thủ thật là 2^40 tổ hợp của
	// `server/classCode.js`; cái này chỉ để không ai làm nghẽn server.
	var classJoinLimiter = rateLimit({
		windowMs: 60 * 1000,
		max: 12,
		standardHeaders: true,
		legacyHeaders: false,
		validate: false,
		keyGenerator: function (request) {
			var fromParams = request.params != null ? request.params.deviceId : null;
			var fromBody = request.body != null ? request.body.deviceId : null;
			var deviceId = typeof fromParams === "string" && fromParams.trim() !== ""
				? fromParams
				: (typeof fromBody === "string" ? fromBody : "");

			return deviceId.trim() !== ""
				? "device:" + deviceId.trim().slice(0, 64)
				: "ip:" + (request.ip || "unknown");
		},
		message: { error: "Em thử mã hơi nhanh, đợi một chút nhé." }
	});

	// P2-5 · route quản lý lớp của GIÁO VIÊN — đếm theo IP là ĐÚNG ở đây, cùng lý do
	// đã ghi ở `importLimiter`: sau `requireAdminAuth` chỉ còn một hai giáo viên.
	var classAdminLimiter = rateLimit({
		windowMs: 60 * 1000,
		max: 60,
		standardHeaders: true,
		legacyHeaders: false,
		validate: false,
		message: { error: "Thao tác hơi nhanh, thầy cô đợi một chút nhé." }
	});

	// P2-7 · route quản lý TÀI KHOẢN quản trị — đếm theo IP, cùng lý do đã ghi ở
	// `importLimiter`: sau `requireAdminAuth` chỉ còn một hai giáo viên.
	var adminUserLimiter = rateLimit({
		windowMs: 60 * 1000,
		max: 30,
		standardHeaders: true,
		legacyHeaders: false,
		validate: false,
		message: { error: "Thao tác hơi nhanh, thầy cô đợi một chút nhé." }
	});

	var loginLimiter = rateLimit({
		windowMs: 60 * 1000,
		// Mặc định 5 (server/config.js). Chỉ test mới nới được — không có biến môi
		// trường nào chạm tới con số này.
		max: config.loginRateLimitMax,
		standardHeaders: true,
		legacyHeaders: false,
		validate: false,
		message: { error: "Sai quá nhiều lần. Thử lại sau một phút." }
	});

	// P2-6 · giới hạn tần suất cho nhập/xuất ngân hàng câu hỏi.
	//
	// ĐẾM THEO IP — và ở đây IP là ĐÚNG, ngược hẳn với `scoreLimiter`/`economyLimiter`.
	// Lý do khác nhau chứ không phải tuỳ hứng: hai cái kia phục vụ CẢ MỘT PHÒNG MÁY
	// đi qua một IP sau NAT, còn route này chỉ dành cho admin đã đăng nhập — một hai
	// giáo viên, và mỗi lượt nhập đọc/ghi cả 1.200 câu. 20 lượt/phút là rộng rãi cho
	// người thật (xem trước vài lần rồi xác nhận) mà vẫn chặn được vòng lặp.
	var importLimiter = rateLimit({
		windowMs: 60 * 1000,
		max: 20,
		standardHeaders: true,
		legacyHeaders: false,
		validate: false,
		message: { error: "Thao tác nhập/xuất hơi nhanh, thầy cô đợi một chút nhé." }
	});

	// Thân request của route nhập là CSV thô, không phải JSON.
	//
	// Vì sao không nhét chuỗi CSV vào một field JSON: file 1.200 câu ~300 KB, mà
	// `express.json` toàn cục giới hạn 1 MB và JSON còn phải escape từng dấu nháy —
	// một file hơi lớn sẽ chết ở tầng parse với thông báo khó hiểu. Nhận thẳng
	// `text/csv` cho phép nới hạn mức RIÊNG cho route này mà không đụng hạn mức
	// chung của 13 route cũ.
	//
	// Chỉ nhận đúng `text/csv`: `text/plain` là content-type "đơn giản" theo CORS
	// nên gửi được cross-site không cần preflight; `text/csv` thì phải preflight.
	// Cộng với cookie admin `SameSite=lax`, đó là hai lớp chắn CSRF.
	var csvBody = express.text({ type: "text/csv", limit: "8mb" });

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

	// --- Đăng nhập quản trị (V1 + nhiều tài khoản của P2-7) --------------------
	//
	// ⚠ HAI CHÌA KHOÁ, CÓ CHỦ Ý. Đọc hết đoạn này trước khi "dọn dẹp" nó.
	//
	// Trước P2-7 chỉ có MỘT mật khẩu, nằm trong biến môi trường `ADMIN_PASSWORD_HASH`
	// trên Vercel. Nếu P2-7 chuyển hẳn sang bảng `admin_users` và bỏ đường cũ, thì
	// ngay giây deploy đầu tiên giáo viên không vào được trang quản trị của chính
	// mình — đúng loại tai nạn mà plan §10 đã cảnh báo với `ANTICHEAT_ENFORCE`.
	//
	// Nên đường vào có hai chìa, thử theo thứ tự:
	//   1. **bảng `admin_users`** (sau khi đã gieo hạt giống di trú từ hash cũ);
	//   2. **`ADMIN_PASSWORD_HASH`**, CHỈ cho tài khoản `admin`.
	//
	// Chìa thứ hai vẫn sống kể cả khi bảng đã có hàng. Có lý do: chủ dự án đổi biến
	// môi trường trên Vercel là chuyện sẽ xảy ra, và lúc đó hash trong bảng đã cũ —
	// bỏ chìa thứ hai nghĩa là đổi biến môi trường xong thì… không vào được nữa.
	// Cái giá: mật khẩu cũ trong biến môi trường vẫn dùng được cho `admin` cho tới
	// khi chủ dự án XOÁ biến đó. Trang quản trị nói rõ điều này ở panel "Tài khoản
	// quản trị", và Checklist release P2-7 ghi việc phải làm.
	var legacySeedPromise = null;

	function ensureLegacyAccountSeeded() {
		if (adminUserStore.disabled === true) {
			return Promise.resolve();
		}

		if (legacySeedPromise === null) {
			legacySeedPromise = adminUserStore.seedLegacyAccount(config.adminPasswordHash).catch(function (error) {
				// CSDL trục trặc KHÔNG được biến thành "không ai đăng nhập được":
				// chìa thứ hai vẫn còn đó. Ghi log rồi đi tiếp.
				console.warn("[admin-users] chưa gieo được tài khoản di trú: " + error.message);
				legacySeedPromise = null;
			});
		}

		return legacySeedPromise;
	}

	async function authenticateAdmin(rawUsername, password) {
		var username = adminUser.normalizeUsername(rawUsername);

		// Bỏ trống tên đăng nhập = tài khoản cũ. Trang admin V1 (và mọi script cũ)
		// chỉ gửi `{ password }`, và chúng phải tiếp tục chạy.
		if (username === "") {
			username = adminUser.LEGACY_USERNAME;
		}

		if (adminUserStore.disabled !== true) {
			await ensureLegacyAccountSeeded();

			var byTable = await adminUserStore.verifyLogin(username, password);

			if (byTable.ok === true) {
				return byTable.user;
			}
		}

		if (username === adminUser.LEGACY_USERNAME) {
			var byEnv = await auth.verifyAdminPassword(password, config);

			if (byEnv === true) {
				return {
					username: adminUser.LEGACY_USERNAME,
					displayName: "Quản trị viên",
					role: auth.ADMIN_ROLE_OWNER,
					fromEnv: true
				};
			}
		}

		return null;
	}

	app.post("/api/admin/login", loginLimiter, async function (request, response, next) {
		try {
			var body = request.body || {};
			var password = typeof body.password === "string" ? body.password : "";

			if (password.trim() === "") {
				throw createError(400, "Password is required.");
			}

			var user = await authenticateAdmin(body.username, password);

			// Sai tên VÀ sai mật khẩu trả về CÙNG một câu: nói "không có tài khoản
			// này" là xác nhận miễn phí cho người dò rằng những tên khác thì có.
			if (user == null) {
				throw createError(401, "Mật khẩu admin chưa đúng.");
			}

			if (adminUserStore.disabled !== true) {
				await adminUserStore.touchLogin(user.username).catch(function () {
					// Ghi dấu lần đăng nhập cuối là tiện ích, không phải điều kiện vào cửa.
				});
			}

			auth.setAdminCookie(response, auth.createAdminToken(config, user.username, user.role), config);
			// Hợp đồng V1: shape `{ authenticated: true }` GIỮ NGUYÊN; các field dưới
			// là BỔ SUNG (client cũ bỏ qua field lạ).
			response.json({
				authenticated: true,
				username: user.username,
				displayName: user.displayName,
				role: user.role
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
		var identity = auth.resolveAdminIdentity(request, config);

		// `authenticated` GIỮ NGUYÊN vị trí và kiểu (hợp đồng V1). `username`/`role`
		// là bổ sung của P2-7 để trang admin biết nên hiện panel tài khoản hay không.
		response.json({
			authenticated: identity != null,
			username: identity != null ? identity.username : null,
			role: identity != null ? identity.role : null,
			multiAccount: adminUserStore.disabled !== true
		});
	});

	// --- Tài khoản quản trị (P2-7) ---------------------------------------------
	//
	// 4 route MỚI, không đụng một ký tự nào của 13 route cũ (hợp đồng §7.3.2).
	//
	// Quy tắc quyền nằm TRỌN trong `server/adminUser.js#canManage` (hàm thuần, có
	// test liệt kê cả bảng quyền). Ở đây chỉ có xác thực, tham số và mã HTTP.

	function requireIdentity(request) {
		var identity = auth.resolveAdminIdentity(request, config);

		if (identity == null) {
			throw createError(401, "Admin authentication required.");
		}

		return identity;
	}

	/** Danh sách tài khoản — chỉ `owner` xem được (danh sách tài khoản là bản đồ tấn công). */
	app.get("/api/admin/users", auth.requireAdminAuth(config), adminUserLimiter, async function (request, response, next) {
		try {
			var identity = requireIdentity(request);

			if (identity.role !== auth.ADMIN_ROLE_OWNER) {
				throw createError(403, "Chỉ tài khoản quản trị chính mới xem được danh sách tài khoản.");
			}

			await ensureLegacyAccountSeeded();
			response.json(await adminUserStore.listUsers());
		} catch (error) {
			next(createError(error.statusCode || 400, error.message));
		}
	});

	app.post("/api/admin/users", auth.requireAdminAuth(config), adminUserLimiter, async function (request, response, next) {
		try {
			await ensureLegacyAccountSeeded();
			response.json(await adminUserStore.createUser(requireIdentity(request), request.body || {}));
		} catch (error) {
			next(createError(error.statusCode || 400, error.message));
		}
	});

	app.delete("/api/admin/users/:username", auth.requireAdminAuth(config), adminUserLimiter, async function (request, response, next) {
		try {
			await ensureLegacyAccountSeeded();
			response.json(await adminUserStore.deleteUser(requireIdentity(request), request.params.username));
		} catch (error) {
			next(createError(error.statusCode || 400, error.message));
		}
	});

	/** Đổi mật khẩu. `teacher` chỉ đổi được của CHÍNH MÌNH (`canManage`). */
	app.post(
		"/api/admin/users/:username/password",
		auth.requireAdminAuth(config),
		adminUserLimiter,
		async function (request, response, next) {
			try {
				var body = request.body || {};
				await ensureLegacyAccountSeeded();
				response.json(await adminUserStore.setPassword(requireIdentity(request), request.params.username, body.password));
			} catch (error) {
				next(createError(error.statusCode || 400, error.message));
			}
		}
	);

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

	// Endpoint #3 của hợp đồng §7.3.2 — shape {level, entries, me} GIỮ NGUYÊN.
	// P2-8 chỉ THÊM tham số tuỳ chọn `?season=` và hai field `season`/`seasons`.
	// Không truyền `season` ⇒ mùa đang chạy, đúng thứ client V1 cũ mong đợi.
	app.get("/api/levels/:level/leaderboard", async function (request, response, next) {
		try {
			var query = request.query || {};
			response.json(
				await playerStore.getLeaderboard(request.params.level, query.deviceId, { season: query.season })
			);
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

	// P1-6 · tổng kết cả ván trong MỘT request. 30 em × 10 câu = 300 request đồng
	// thời chỉ để ghi log là cách nhanh nhất để tự làm sập phòng máy của trường.
	app.post("/api/runs/summary", scoreLimiter, async function (request, response, next) {
		try {
			response.json(await statsStore.recordRunSummary(request.body || {}));
		} catch (error) {
			next(error);
		}
	});

	// --- Nền kinh tế server-side (P2-3) ---------------------------------------
	//
	// 5 route MỚI, không đụng một ký tự nào của 13 route cũ (hợp đồng §7.3.2).
	//
	// Không route nào yêu cầu vé ván chơi: `ANTICHEAT_ENFORCE` còn tắt ở production
	// và chỉ bật sau khi đa số máy lên V2 (Checklist release P1). Bắt vé ở đây là
	// khoá cửa với đúng những em đang có xu cần di trú.

	/**
	 * Bảng giá cửa hàng — NGUỒN SỰ THẬT của giá.
	 *
	 * Công khai và không rate-limit: nó là dữ liệu tĩnh, không đụng CSDL, và client
	 * gọi đúng một lần mỗi phiên. Client vẫn giữ bảng giá riêng làm bản dự phòng
	 * offline (PWA), nhưng số tiền THỰC SỰ bị trừ luôn là con số ở đây.
	 */
	app.get("/api/shop/catalog", function (request, response) {
		response.json({ items: shopCatalog.listCatalog() });
	});

	app.get("/api/players/:deviceId/profile", economyLimiter, async function (request, response, next) {
		try {
			response.json(await economyStore.getProfile(request.params.deviceId));
		} catch (error) {
			next(error);
		}
	});

	/**
	 * Di trú ví local → server. An toàn khi gọi lại: khoá tự nhiên cố định trong
	 * `economyStore.MIGRATION_REF` + `ON CONFLICT DO NOTHING`.
	 */
	app.post("/api/players/:deviceId/wallet/migrate", economyLimiter, async function (request, response, next) {
		try {
			response.json(await economyStore.migrateLocalWallet(request.params.deviceId, request.body || {}));
		} catch (error) {
			next(error);
		}
	});

	/** Một mẻ bút toán (một lần đẩy outbox). Mỗi dòng có kết quả riêng. */
	app.post("/api/players/:deviceId/wallet/entries", economyLimiter, async function (request, response, next) {
		try {
			response.json(await economyStore.recordEntries(request.params.deviceId, request.body || {}));
		} catch (error) {
			next(error);
		}
	});

	/**
	 * Mua một món. Giá lấy từ `server/shopCatalog.js`, KHÔNG từ body — gửi
	 * `price: 1` lên đây không có tác dụng gì.
	 *
	 * Không đủ xu → 200 với `{ ok: false, reason: "not-enough-coins" }` chứ không
	 * phải 4xx: đây là câu trả lời bình thường của cửa hàng, không phải lỗi giao
	 * thức, và client cần đọc được số dư kèm theo để hiển thị.
	 */
	app.post("/api/players/:deviceId/purchases", economyLimiter, async function (request, response, next) {
		try {
			response.json(await economyStore.purchase(request.params.deviceId, request.body || {}));
		} catch (error) {
			next(error);
		}
	});

	// --- Lớp học (P2-5) --------------------------------------------------------
	//
	// 8 route MỚI, không đụng một ký tự nào của 13 route cũ (hợp đồng §7.3.2).
	//
	// Ranh giới quan trọng nhất của cả nhóm route này: **mã lớp chỉ mở cửa GHI**.
	// Biết mã thì gắn được MÁY CỦA MÌNH vào lớp, hết. Mọi đường đọc số liệu lớp đều
	// nằm sau `requireAdminAuth` và đều kèm chủ sở hữu. Không có route công khai nào
	// nhận `classId`.

	/**
	 * Đọc `?classId=` và ĐỔI nó lấy một lớp mà chính giáo viên đang đăng nhập sở
	 * hữu. Đây là chỗ DUY NHẤT kiểm quyền sở hữu cho dashboard — `statsStore` chỉ
	 * nhận một con số đã được kiểm.
	 *
	 * Lớp của người khác → **404, không phải 403**: 403 là câu xác nhận "lớp đó có
	 * thật, chỉ là không phải của bạn".
	 */
	async function resolveOwnedClassId(request) {
		var requested = request.query != null && request.query.classId != null ? String(request.query.classId).trim() : "";

		if (requested === "") {
			return null;
		}

		var owned = await classStore.getOwnedClass(auth.resolveOwnerId(request, config), requested);

		if (owned == null) {
			throw createError(404, "Không tìm thấy lớp này.");
		}

		return owned.id;
	}

	app.get("/api/admin/classes", auth.requireAdminAuth(config), classAdminLimiter, async function (request, response, next) {
		try {
			response.json(await classStore.listClasses(auth.resolveOwnerId(request, config)));
		} catch (error) {
			next(createError(error.statusCode || 400, error.message));
		}
	});

	app.post("/api/admin/classes", auth.requireAdminAuth(config), classAdminLimiter, async function (request, response, next) {
		try {
			response.json(await classStore.createClass(auth.resolveOwnerId(request, config), request.body || {}));
		} catch (error) {
			next(createError(error.statusCode || 400, error.message));
		}
	});

	/** Thu hồi mã: đóng cửa VÀO lớp ngay lập tức, giữ nguyên thành viên và số liệu. */
	app.post("/api/admin/classes/:id/revoke", auth.requireAdminAuth(config), classAdminLimiter, async function (request, response, next) {
		try {
			var result = await classStore.revokeClass(auth.resolveOwnerId(request, config), request.params.id);

			if (result.ok !== true) {
				throw createError(404, "Không tìm thấy lớp này.");
			}

			response.json(result);
		} catch (error) {
			next(createError(error.statusCode || 400, error.message));
		}
	});

	/** Xoá lớp: dữ liệu học tập TRỞ LẠI ẨN DANH (`class_id` về NULL), không bị xoá. */
	app.delete("/api/admin/classes/:id", auth.requireAdminAuth(config), classAdminLimiter, async function (request, response, next) {
		try {
			var result = await classStore.deleteClass(auth.resolveOwnerId(request, config), request.params.id);

			if (result.ok !== true) {
				throw createError(404, "Không tìm thấy lớp này.");
			}

			response.json(result);
		} catch (error) {
			next(createError(error.statusCode || 400, error.message));
		}
	});

	app.get("/api/admin/classes/:id/members", auth.requireAdminAuth(config), classAdminLimiter, async function (request, response, next) {
		try {
			var ownerId = auth.resolveOwnerId(request, config);
			var owned = await classStore.getOwnedClass(ownerId, request.params.id);

			if (owned == null) {
				throw createError(404, "Không tìm thấy lớp này.");
			}

			response.json(await classStore.listMembers(ownerId, request.params.id));
		} catch (error) {
			next(createError(error.statusCode || 400, error.message));
		}
	});

	/** Gỡ một máy khỏi lớp — và gỡ luôn liên kết của dữ liệu máy đó đã ghi cho lớp. */
	app.delete(
		"/api/admin/classes/:id/members/:deviceId",
		auth.requireAdminAuth(config),
		classAdminLimiter,
		async function (request, response, next) {
			try {
				var result = await classStore.removeMember(
					auth.resolveOwnerId(request, config),
					request.params.id,
					request.params.deviceId
				);

				if (result.ok !== true) {
					throw createError(404, "Không tìm thấy máy này trong lớp.");
				}

				response.json(result);
			} catch (error) {
				next(createError(error.statusCode || 400, error.message));
			}
		}
	);

	/**
	 * Học sinh nhập mã lớp. Mã sai/hết hạn/bị thu hồi → 200 kèm `ok:false` + `reason`
	 * (client dịch sang câu tiếng Việt), không phải 4xx.
	 */
	app.post("/api/classes/join", classJoinLimiter, async function (request, response, next) {
		try {
			var body = request.body || {};
			response.json(await classStore.joinByCode(body.deviceId, body));
		} catch (error) {
			next(createError(error.statusCode || 400, error.message));
		}
	});

	app.get("/api/players/:deviceId/class", classJoinLimiter, async function (request, response, next) {
		try {
			response.json(await classStore.getMembership(request.params.deviceId));
		} catch (error) {
			next(createError(error.statusCode || 400, error.message));
		}
	});

	app.delete("/api/players/:deviceId/class", classJoinLimiter, async function (request, response, next) {
		try {
			response.json(await classStore.leaveClass(request.params.deviceId));
		} catch (error) {
			next(createError(error.statusCode || 400, error.message));
		}
	});

	// --- Dashboard giáo viên (admin, P1-6 + lọc theo lớp P2-5) -----------------

	app.get("/api/admin/stats", auth.requireAdminAuth(config), async function (request, response, next) {
		try {
			var classId = await resolveOwnedClassId(request);

			response.json(await statsStore.getStats({
				level: request.query.level,
				from: request.query.from,
				to: request.query.to,
				classId: classId
			}));
		} catch (error) {
			next(createError(error.statusCode || 400, error.message));
		}
	});

	app.get("/api/admin/stats.csv", auth.requireAdminAuth(config), async function (request, response, next) {
		try {
			var csvClassId = await resolveOwnedClassId(request);
			var stats = await statsStore.getStats({
				level: request.query.level,
				from: request.query.from,
				to: request.query.to,
				classId: csvClassId
			});

			// charset=utf-8 + BOM trong nội dung: thiếu một trong hai là Excel bản
			// Windows đọc thành CP-1252 và dấu tiếng Việt vỡ hết (DoD P1-6).
			response.setHeader("Content-Type", "text/csv; charset=utf-8");
			response.setHeader("Content-Disposition", 'attachment; filename="toan-runner-stats.csv"');
			response.send(statsStoreModule.statsToCsv(stats));
		} catch (error) {
			next(createError(error.statusCode || 400, error.message));
		}
	});

	// --- Nhập / xuất ngân hàng câu hỏi (admin, P2-6) ---------------------------
	//
	// 3 route MỚI, không đụng một ký tự nào của 13 route cũ (hợp đồng §7.3.2).
	// Toàn bộ luật đọc/ghép/kiểm tra nằm ở `server/questionImport.js`; ở đây chỉ có
	// xác thực, tham số và mã HTTP.

	/**
	 * Xuất toàn bộ ngân hàng (hoặc một lớp) ra CSV mở được bằng Excel.
	 *
	 * `charset=utf-8` ở header + BOM trong nội dung: thiếu MỘT trong hai là Excel
	 * bản Windows đọc thành CP-1252 và dấu tiếng Việt vỡ hết — đúng bài học đã ghi
	 * ở `/api/admin/stats.csv` (P1-6).
	 */
	app.get("/api/admin/questions.csv", auth.requireAdminAuth(config), importLimiter, async function (request, response, next) {
		try {
			var requested = request.query != null && request.query.level != null ? String(request.query.level).trim() : "";
			var levels = QuestionModel.LEVELS;

			if (requested !== "") {
				QuestionModel.assertLevel(requested);
				levels = [requested];
			}

			var entries = [];

			// Tuần tự chứ không `Promise.all`: kho Postgres dùng CHUNG một kết nối với
			// mọi store khác, và bắn 3 truy vấn cùng lúc chỉ để tiết kiệm vài chục ms
			// là đánh đổi sai chỗ.
			for (var index = 0; index < levels.length; index += 1) {
				var bundle = await dataStore.getLevelBundle(levels[index]);
				entries.push({ level: levels[index], questions: bundle.questions || [] });
			}

			response.setHeader("Content-Type", "text/csv; charset=utf-8");
			response.setHeader("Content-Disposition", 'attachment; filename="toan-runner-ngan-hang-cau-hoi.csv"');
			response.send(questionImport.questionsToCsv(entries));
		} catch (error) {
			next(createError(400, error.message));
		}
	});

	function readCsvBody(request) {
		var body = request.body;

		if (typeof body !== "string" || body.trim() === "") {
			throw createError(400, "Chưa có nội dung file CSV (gửi kèm header Content-Type: text/csv).");
		}

		return body;
	}

	/**
	 * XEM TRƯỚC — tuyệt đối KHÔNG ghi gì.
	 *
	 * File sai định dạng trả về **200 kèm `ok: false`** chứ không phải 4xx: đây là
	 * câu trả lời bình thường của một công cụ kiểm tra file, và client cần đọc được
	 * danh sách lỗi kèm số dòng để hiển thị. Cùng khuôn với `POST /api/players/:id/purchases`
	 * của P2-3 ("không đủ xu" là câu trả lời, không phải lỗi giao thức).
	 */
	app.post("/api/admin/questions/import/preview", auth.requireAdminAuth(config), importLimiter, csvBody, async function (request, response, next) {
		try {
			response.json(await questionImport.previewImport(dataStore, readCsvBody(request), {
				mode: request.query != null ? request.query.mode : null
			}));
		} catch (error) {
			next(createError(error.statusCode || 400, error.message));
		}
	});

	/**
	 * XÁC NHẬN — chỗ duy nhất trong P2-6 ghi vào ngân hàng.
	 *
	 * Bắt buộc kèm `digest` lấy từ lần xem trước: không có, hoặc lệch (ai đó vừa sửa
	 * đề ở tab khác), là từ chối. "Xem trước rồi mới xác nhận" chỉ có nghĩa khi thứ
	 * được ghi đúng bằng thứ đã xem.
	 */
	app.post("/api/admin/questions/import/apply", auth.requireAdminAuth(config), importLimiter, csvBody, async function (request, response, next) {
		try {
			response.json(await questionImport.applyImport(dataStore, readCsvBody(request), {
				mode: request.query != null ? request.query.mode : null,
				digest: request.query != null ? request.query.digest : null
			}));
		} catch (error) {
			next(createError(error.statusCode || 400, error.message));
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

	// P2-7: trang quản trị nay là ENTRY POINT của Vite (`client/admin.html`), không
	// còn file `admin.html` ở gốc repo.
	//
	// **URL `/admin.html` GIỮ NGUYÊN** — đó là hợp đồng §7.3.5 và cũng là bookmark
	// giáo viên đang dùng. Trên Vercel, `public/admin.html` do Vite sinh ra được CDN
	// phục vụ nên không cần gì thêm. Ở máy dev thì `staticDir` là gốc repo, nên file
	// chỉ tồn tại sau `npm run build:client`; thiếu rào này thì `npm start` rồi mở
	// /admin.html chỉ ra một trang 404 trắng và không nói vì sao.
	app.get("/admin.html", function (request, response, next) {
		if (fs.existsSync(path.join(config.staticDir, "admin.html")) === true) {
			next();
			return;
		}

		var builtAdminPage = path.join(config.rootDir, "public", "admin.html");

		if (fs.existsSync(builtAdminPage) === true) {
			response.sendFile(builtAdminPage);
			return;
		}

		response
			.status(503)
			.type("html")
			.send(
				"<!doctype html><html lang=\"vi\"><meta charset=\"utf-8\">" +
				"<body style=\"font:16px system-ui;padding:32px;line-height:1.6\">" +
				"<h1>Chưa dựng trang quản trị</h1>" +
				"<p>Trang quản trị nay nằm trong Vite. Chạy <code>npm run build:client</code> rồi tải lại, " +
				"hoặc chạy <code>npm run dev:client</code> và mở <code>http://localhost:5173/admin.html</code>.</p>" +
				"</body></html>"
			);
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
