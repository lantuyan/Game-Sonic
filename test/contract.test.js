"use strict";

// CONTRACT-TEST (tasks-version2.md P0-1) — bảo vệ hợp đồng tích hợp V1 (plan §7.3):
//   A. Shape 13 endpoint HTTP (docs/v2/A2 §2) — chỉ assert field BẮT BUỘC,
//      field mới THÊM (additive) không làm test đỏ.
//   B. Khóa localStorage: 5 khóa "-v1" khớp CHÍNH XÁC danh sách vàng bất biến;
//      mọi khóa mới chỉ cần đúng hậu tố "-v2".
//   C. Chữ ký window.QuestionBank: 16 member trong danh sách vàng.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var vm = require("node:vm");
var bcrypt = require("bcrypt");
var request = require("supertest");
var createApp = require("../server/app").createApp;

// ⚠ MỘT thư mục dữ liệu dùng chung cho cả file.
//
// Mỗi `mkdtempSync` riêng nghĩa là một CSDL PGlite mới, mà PGlite là Postgres biên
// dịch WASM: mỗi instance là một cluster đầy đủ vài chục MB nằm lại trong thư mục
// tạm. Chạy `npm test` nhiều lần trong một buổi là đầy ổ đĩa thật — đã xảy ra.
// `server/sql.js` cache client theo `pgDataDir` nên dùng chung đường dẫn là dùng
// chung đúng một instance.
var sharedTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "game-sonic-running-contract-"));

var rootDir = path.resolve(__dirname, "..");

// PGlite (embedded Postgres dùng khi DATABASE_URL trống) xả noise teardown muộn
// sau khi test xong — như test/server.test.js, nuốt đúng loại lỗi đó, còn lại ném tiếp.
process.on("unhandledRejection", function (error) {
	var name = error && error.constructor ? error.constructor.name : "";
	var message = error ? String(error.message || "") : "";

	if (name === "ErrnoError" || message.indexOf("PGlite is closed") !== -1) {
		return;
	}

	throw error;
});

function createTestContext() {
	var tempDir = sharedTempDir;
	var config = {
		rootDir: rootDir,
		staticDir: rootDir,
		runtimeDir: tempDir,
		databasePath: path.join(tempDir, "test.sqlite"),
		jwtSecret: "test-secret-key",
		adminPasswordHash: bcrypt.hashSync("admin123", 10),
		nodeEnv: "test"
	};
	var runtime = createApp(config);

	return {
		config: config,
		runtime: runtime,
		cleanup: function () {
			return Promise.resolve(runtime.close());
		}
	};
}

function assertQuestionShape(question, label) {
	assert.equal(typeof question.id, "string", label + ": question.id là string");
	assert.equal(typeof question.question, "string", label + ": question.question là string");
	assert.equal(typeof question.answers, "object", label + ": question.answers là object");
	assert.ok(Array.isArray(question.availableAnswers), label + ": availableAnswers là mảng");
	assert.ok(question.availableAnswers.length >= 2, label + ": có ≥2 đáp án");
	assert.equal(typeof question.correctAnswer, "string", label + ": correctAnswer là string");
	assert.equal(typeof question.point, "number", label + ": point là number");
	assert.equal(typeof question.time, "number", label + ": time là number");
	assert.equal(typeof question.difficulty, "string", label + ": difficulty là string");
}

// Shape "level bundle" — response của endpoint #1 và #10–#13.
function assertBundleShape(body, label) {
	assert.ok(Array.isArray(body.questions), label + ": questions là mảng");
	assert.ok(body.questions.length > 0, label + ": questions không rỗng");
	assertQuestionShape(body.questions[0], label);
	assert.equal(typeof body.pointSettings, "object", label + ": pointSettings là object");
	assert.equal(typeof body.timeSettings, "object", label + ": timeSettings là object");
	["easy", "medium", "hard", "expert"].forEach(function (difficulty) {
		assert.equal(typeof body.pointSettings[difficulty], "number", label + ": pointSettings." + difficulty);
		assert.equal(typeof body.timeSettings[difficulty], "number", label + ": timeSettings." + difficulty);
	});
	assert.equal(typeof body.gameSpeed, "number", label + ": gameSpeed là number");
}

test("contract A: 13 endpoint HTTP giữ nguyên shape response", async function () {
	var context = createTestContext();
	var agent = request.agent(context.runtime.app);
	var deviceId = "contract-test-device-1";

	try {
		// #6 GET /api/health — additive: giữ {status, database}; field mới được phép.
		var health = await agent.get("/api/health").expect(200);
		assert.equal(health.body.status, "ok");
		assert.equal(health.body.database, "ready");

		// #1 GET /api/levels/:level/question-bank
		var bundle = await agent.get("/api/levels/lop6/question-bank").expect(200);
		assertBundleShape(bundle.body, "#1 question-bank");

		// #2 POST /api/scores
		var score = await agent
			.post("/api/scores")
			.send({
				deviceId: deviceId,
				nickname: "Contract Tester",
				level: "lop6",
				score: 1234,
				correctCount: 5,
				wrongCount: 2,
				timeoutCount: 1,
				durationMs: 90000
			})
			.expect(200);
		assert.ok(typeof score.body.rank === "number" || score.body.rank === null, "#2: rank là number|null");
		assert.equal(typeof score.body.best, "number", "#2: best là number");
		assert.equal(typeof score.body.score, "number", "#2: score là number");

		// #3 GET /api/levels/:level/leaderboard?deviceId=…
		var leaderboard = await agent
			.get("/api/levels/lop6/leaderboard")
			.query({ deviceId: deviceId })
			.expect(200);
		assert.equal(leaderboard.body.level, "lop6", "#3: level đúng");
		assert.ok(Array.isArray(leaderboard.body.entries), "#3: entries là mảng");
		assert.ok(leaderboard.body.entries.length >= 1, "#3: có entry vừa submit");
		var entry = leaderboard.body.entries[0];
		assert.equal(typeof entry.rank, "number", "#3: entry.rank");
		assert.equal(typeof entry.nickname, "string", "#3: entry.nickname");
		assert.equal(typeof entry.score, "number", "#3: entry.score");
		assert.equal(typeof entry.isMe, "boolean", "#3: entry.isMe");
		assert.ok(typeof leaderboard.body.me === "object", "#3: me là object|null");

		// #4 PUT /api/players/:deviceId/nickname (≤24 ký tự)
		var nickname = await agent
			.put("/api/players/" + deviceId + "/nickname")
			.send({ nickname: "Tester V2" })
			.expect(200);
		assert.equal(nickname.body.deviceId, deviceId, "#4: deviceId");
		assert.equal(nickname.body.nickname, "Tester V2", "#4: nickname");

		// #5 PUT /api/players/:deviceId/skill
		var skill = await agent
			.put("/api/players/" + deviceId + "/skill")
			.send({
				level: "lop6",
				skill: 0.6,
				accuracy: 0.7,
				avgAnswerMs: 4200,
				recommendedSpeed: 1.1,
				difficultyWeights: { easy: 0.2, medium: 0.4, hard: 0.3, expert: 0.1 },
				gamesPlayed: 3
			})
			.expect(200);
		assert.equal(skill.body.deviceId, deviceId, "#5: deviceId");
		assert.equal(skill.body.level, "lop6", "#5: level");
		assert.equal(typeof skill.body.skill, "number", "#5: skill là number");

		// #7 POST /api/admin/login — sai mật khẩu → 401 {error}, đúng → {authenticated:true}
		var badLogin = await agent.post("/api/admin/login").send({ password: "sai-mat-khau" }).expect(401);
		assert.equal(typeof badLogin.body.error, "string", "#7: 401 có error string");
		var login = await agent.post("/api/admin/login").send({ password: "admin123" }).expect(200);
		assert.equal(login.body.authenticated, true, "#7: authenticated true");

		// #8 GET /api/admin/session
		var session = await agent.get("/api/admin/session").expect(200);
		assert.equal(session.body.authenticated, true, "#8: authenticated true khi có cookie");

		// #10 PUT /api/levels/:level/questions → trả level bundle đầy đủ
		var savedQuestions = await agent
			.put("/api/levels/lop6/questions")
			.send({ questions: bundle.body.questions })
			.expect(200);
		assertBundleShape(savedQuestions.body, "#10 PUT questions");

		// #11 PUT /api/levels/:level/settings/point → level bundle
		var savedPoints = await agent
			.put("/api/levels/lop6/settings/point")
			.send({ settings: bundle.body.pointSettings })
			.expect(200);
		assertBundleShape(savedPoints.body, "#11 PUT settings/point");

		// #12 PUT /api/levels/:level/settings/time → level bundle
		var savedTimes = await agent
			.put("/api/levels/lop6/settings/time")
			.send({ settings: bundle.body.timeSettings })
			.expect(200);
		assertBundleShape(savedTimes.body, "#12 PUT settings/time");

		// #13 PUT /api/levels/:level/settings/speed → level bundle với gameSpeed mới
		var savedSpeed = await agent
			.put("/api/levels/lop6/settings/speed")
			.send({ value: 1.2 })
			.expect(200);
		assertBundleShape(savedSpeed.body, "#13 PUT settings/speed");
		assert.equal(savedSpeed.body.gameSpeed, 1.2, "#13: gameSpeed cập nhật");

		// #9 POST /api/admin/logout
		var logout = await agent.post("/api/admin/logout").expect(200);
		assert.equal(logout.body.authenticated, false, "#9: authenticated false");
		var sessionAfterLogout = await agent.get("/api/admin/session").expect(200);
		assert.equal(sessionAfterLogout.body.authenticated, false, "#9: session tắt sau logout");
	} finally {
		await context.cleanup();
	}
});

// Danh sách vàng BẤT BIẾN — 5 khóa localStorage V1 (plan §7.3 mục 3).
var GOLDEN_V1_KEYS = [
	"endlessrunner-question-progress-v1",
	"endlessrunner-device-id-v1",
	"endlessrunner-nickname-v1",
	"endlessrunner-skill-profile-v1",
	"endlessrunner-character-v1"
];

// Khóa V2 phải có sẵn từ P0-1 (tasks-version2.md P0-1).
var REQUIRED_V2_KEYS = [
	"endlessrunner-settings-v2",
	"endlessrunner-ftue-v2",
	"endlessrunner-wallet-v2",
	"endlessrunner-review-queue-v2"
];

test("contract B: khóa localStorage — 5 khóa -v1 bất biến, khóa mới đúng hậu tố -v2", async function () {
	// storageKeys.ts được viết bằng cú pháp JS thuần (xem chú thích trong file)
	// nên import thẳng source qua data: URL — không cần trình biên dịch TS.
	var source = fs.readFileSync(path.join(rootDir, "client", "src", "core", "storageKeys.ts"), "utf8");
	var moduleUrl = "data:text/javascript;base64," + Buffer.from(source, "utf8").toString("base64");
	var storageKeys = await import(moduleUrl);

	var v1Values = Object.values(storageKeys.V1_STORAGE_KEYS);
	assert.deepEqual(
		v1Values.slice().sort(),
		GOLDEN_V1_KEYS.slice().sort(),
		"5 khóa -v1 phải khớp CHÍNH XÁC danh sách vàng (không thêm, không bớt, không đổi tên)"
	);

	var v2Values = Object.values(storageKeys.V2_STORAGE_KEYS);
	v2Values.forEach(function (key) {
		assert.ok(key.endsWith("-v2"), "khóa mới \"" + key + "\" phải kết thúc bằng -v2");
	});

	REQUIRED_V2_KEYS.forEach(function (key) {
		assert.ok(v2Values.indexOf(key) !== -1, "thiếu khóa V2 bắt buộc: " + key);
	});

	v2Values.forEach(function (key) {
		assert.ok(GOLDEN_V1_KEYS.indexOf(key) === -1, "khóa V2 không được trùng khóa V1: " + key);
	});
});

// Danh sách vàng — 16 member window.QuestionBank mà game V2 dùng qua questionBridge.ts
// (tasks-version2.md P0-1; plan §7.3 mục 1).
var QUESTION_BANK_FUNCTIONS = [
	"getLevelBundle",
	"getAdaptiveSpeedFactor",
	"filterAvailableQuestions",
	"orderQuestionsBySkill",
	"getAnsweredIdMap",
	"markQuestionShown",
	"markQuestionResult",
	"updateSkillProfileAfterGame",
	"submitScore",
	"getLeaderboard",
	"getNickname",
	"setNickname"
];

test("contract C: chữ ký window.QuestionBank — 16 member danh sách vàng", function () {
	// Nạp đúng thứ tự production: questionModel.js → questionBank.js (plan §7.3).
	// Sandbox không có localStorage/fetch: questionBank tự fallback in-memory —
	// đủ cho kiểm tra chữ ký (không gọi hàm có side effect mạng).
	var sandbox = { console: console };
	sandbox.window = sandbox;
	sandbox.QuestionModel = require("../shared/questionModel.js");
	vm.createContext(sandbox);
	vm.runInContext(fs.readFileSync(path.join(rootDir, "questionBank.js"), "utf8"), sandbox, {
		filename: "questionBank.js"
	});

	var questionBank = sandbox.QuestionBank;
	assert.ok(questionBank, "window.QuestionBank phải tồn tại sau khi nạp script");

	QUESTION_BANK_FUNCTIONS.forEach(function (name) {
		assert.equal(typeof questionBank[name], "function", "QuestionBank." + name + " là function");
	});

	assert.equal(typeof questionBank.LEVEL_LABELS, "object", "LEVEL_LABELS là object");
	["lop6", "lop7", "lop8"].forEach(function (level) {
		assert.equal(typeof questionBank.LEVEL_LABELS[level], "string", "LEVEL_LABELS." + level);
	});

	// Ngữ nghĩa tốc độ admin (plan §7.3 mục 4): clamp 0.5–2.0, mặc định 1.0.
	assert.equal(questionBank.GAME_SPEED_MIN, 0.5, "GAME_SPEED_MIN = 0.5");
	assert.equal(questionBank.GAME_SPEED_MAX, 2.0, "GAME_SPEED_MAX = 2.0");
	assert.equal(questionBank.GAME_SPEED_DEFAULT, 1.0, "GAME_SPEED_DEFAULT = 1.0");
});

test("contract C: questionBank.js từ chối nạp khi thiếu QuestionModel (thứ tự script)", function () {
	var sandbox = { console: console };
	sandbox.window = sandbox;
	vm.createContext(sandbox);

	assert.throws(function () {
		vm.runInContext(fs.readFileSync(path.join(rootDir, "questionBank.js"), "utf8"), sandbox, {
			filename: "questionBank.js"
		});
	}, /QuestionModel is required/);
});
