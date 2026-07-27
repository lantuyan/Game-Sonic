"use strict";

// P0-14 — backend V2: explanation tùy chọn, quizMode per-level THẬT SỰ, health additive.
// Nguyên tắc: mọi thứ chỉ THÊM; shape cũ của bundle/health không đổi một byte.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
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
var sharedTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "game-sonic-running-p0-"));
var QuestionModel = require("../shared/questionModel");

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
		rootDir: path.resolve(__dirname, ".."),
		staticDir: path.resolve(__dirname, ".."),
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

async function loginAgent(context) {
	var agent = request.agent(context.runtime.app);

	await agent
		.post("/api/admin/login")
		.send({ password: "admin123" })
		.expect(200);

	return agent;
}

// --- shared/questionModel.js: explanation ---

test("normalize: explanation là tùy chọn và chỉ xuất hiện khi có nội dung", function () {
	var baseQuestion = {
		id: "q1",
		difficulty: "easy",
		question: "1 + 1 = ?",
		answers: { A: "2", B: "3" },
		correctAnswer: "A",
		point: 10,
		time: 20
	};

	var withoutExplanation = QuestionModel.validateQuestion(baseQuestion, "test", 0);
	assert.equal(
		Object.prototype.hasOwnProperty.call(withoutExplanation, "explanation"),
		false,
		"câu không có lời giải phải giữ nguyên shape cũ (không sinh field rỗng)"
	);

	var withBlank = QuestionModel.validateQuestion(
		Object.assign({}, baseQuestion, { explanation: "   " }),
		"test",
		0
	);
	assert.equal(Object.prototype.hasOwnProperty.call(withBlank, "explanation"), false);

	var withExplanation = QuestionModel.validateQuestion(
		Object.assign({}, baseQuestion, { explanation: "  Cộng hai số tự nhiên.  " }),
		"test",
		0
	);
	assert.equal(withExplanation.explanation, "Cộng hai số tự nhiên.");
});

test("normalize: explanation dài quá 500 ký tự bị từ chối", function () {
	var tooLong = "x".repeat(QuestionModel.EXPLANATION_MAX_LENGTH + 1);

	assert.throws(function () {
		QuestionModel.validateQuestion(
			{
				id: "q1",
				question: "1 + 1 = ?",
				answers: { A: "2", B: "3" },
				correctAnswer: "A",
				point: 10,
				time: 20,
				explanation: tooLong
			},
			"test",
			0
		);
	}, /explanation/);

	assert.equal(
		QuestionModel.validateQuestion(
			{
				id: "q1",
				question: "1 + 1 = ?",
				answers: { A: "2", B: "3" },
				correctAnswer: "A",
				point: 10,
				time: 20,
				explanation: "y".repeat(QuestionModel.EXPLANATION_MAX_LENGTH)
			},
			"test",
			0
		).explanation.length,
		QuestionModel.EXPLANATION_MAX_LENGTH,
		"đúng 500 ký tự vẫn hợp lệ"
	);
});

test("normalize: quizMode mặc định gate, chỉ nhận gate|modal", function () {
	assert.equal(QuestionModel.normalizeQuizMode(null), "gate");
	assert.equal(QuestionModel.normalizeQuizMode(""), "gate");
	assert.equal(QuestionModel.normalizeQuizMode("MODAL"), "modal");
	assert.throws(function () {
		QuestionModel.normalizeQuizMode("boss");
	}, /Quiz mode/);
});

// --- server: round-trip explanation ---

test("explanation đi trọn vòng PUT admin → GET bundle và sống sót restart", async function () {
	var context = createTestContext();

	try {
		var agent = await loginAgent(context);
		var bundleResponse = await agent.get("/api/levels/lop6/question-bank").expect(200);
		var questions = bundleResponse.body.questions.slice();

		assert.equal(
			Object.prototype.hasOwnProperty.call(questions[0], "explanation"),
			false,
			"bank gốc chưa có lời giải — shape cũ giữ nguyên"
		);

		questions[0] = Object.assign({}, questions[0], {
			explanation: "Quy đồng mẫu số rồi cộng tử số."
		});

		var saveResponse = await agent
			.put("/api/levels/lop6/questions")
			.send({ questions: questions })
			.expect(200);

		assert.equal(saveResponse.body.questions[0].explanation, "Quy đồng mẫu số rồi cộng tử số.");
		assert.equal(
			Object.prototype.hasOwnProperty.call(saveResponse.body.questions[1], "explanation"),
			false,
			"câu chưa có lời giải vẫn hợp lệ trong cùng một lần lưu"
		);

		await context.runtime.close();
		context.runtime = createApp(context.config);

		var persisted = await request(context.runtime.app)
			.get("/api/levels/lop6/question-bank")
			.expect(200);

		assert.equal(persisted.body.questions[0].explanation, "Quy đồng mẫu số rồi cộng tử số.");
	} finally {
		await context.cleanup();
	}
});

test("PUT questions từ chối explanation quá dài", async function () {
	var context = createTestContext();

	try {
		var agent = await loginAgent(context);
		var bundleResponse = await agent.get("/api/levels/lop6/question-bank").expect(200);
		var questions = bundleResponse.body.questions.slice();

		questions[0] = Object.assign({}, questions[0], {
			explanation: "z".repeat(QuestionModel.EXPLANATION_MAX_LENGTH + 1)
		});

		await agent
			.put("/api/levels/lop6/questions")
			.send({ questions: questions })
			.expect(400);
	} finally {
		await context.cleanup();
	}
});

// --- server: quizMode per-level ---

test("quizMode mặc định gate ở cả 3 lớp và đổi ở lop6 KHÔNG lây sang lop7/lop8", async function () {
	var context = createTestContext();

	try {
		var agent = await loginAgent(context);

		for (var index = 0; index < QuestionModel.LEVELS.length; index += 1) {
			var level = QuestionModel.LEVELS[index];
			var bundle = await agent.get("/api/levels/" + level + "/question-bank").expect(200);
			assert.equal(bundle.body.quizMode, "gate", level + " phải mặc định gate");
		}

		var updateResponse = await agent
			.put("/api/levels/lop6/settings/quiz-mode")
			.send({ value: "modal" })
			.expect(200);

		assert.equal(updateResponse.body.quizMode, "modal");

		var lop6 = await agent.get("/api/levels/lop6/question-bank").expect(200);
		var lop7 = await agent.get("/api/levels/lop7/question-bank").expect(200);
		var lop8 = await agent.get("/api/levels/lop8/question-bank").expect(200);

		assert.equal(lop6.body.quizMode, "modal");
		assert.equal(lop7.body.quizMode, "gate", "⚠ quizMode phải per-level thật sự (khác gameSpeed)");
		assert.equal(lop8.body.quizMode, "gate");

		// Đối chứng: gameSpeed vẫn giữ hành vi cũ (áp cả 3 lớp) — hợp đồng V1 không đổi.
		await agent.put("/api/levels/lop6/settings/speed").send({ value: 1.5 }).expect(200);
		var lop7AfterSpeed = await agent.get("/api/levels/lop7/question-bank").expect(200);
		assert.equal(lop7AfterSpeed.body.gameSpeed, 1.5);
		assert.equal(lop7AfterSpeed.body.quizMode, "gate");

		await context.runtime.close();
		context.runtime = createApp(context.config);

		var persisted = await request(context.runtime.app)
			.get("/api/levels/lop6/question-bank")
			.expect(200);
		assert.equal(persisted.body.quizMode, "modal", "quizMode phải sống sót restart");
	} finally {
		await context.cleanup();
	}
});

test("quiz-mode route cần đăng nhập admin và từ chối giá trị lạ", async function () {
	var context = createTestContext();

	try {
		await request(context.runtime.app)
			.put("/api/levels/lop6/settings/quiz-mode")
			.send({ value: "modal" })
			.expect(401);

		var agent = await loginAgent(context);

		await agent
			.put("/api/levels/lop6/settings/quiz-mode")
			.send({ value: "boss" })
			.expect(400);

		await agent
			.put("/api/levels/lop9/settings/quiz-mode")
			.send({ value: "modal" })
			.expect(400);
	} finally {
		await context.cleanup();
	}
});

// --- server: /api/health additive ---

test("health giữ nguyên shape cũ và thêm dbKind/dbOk", async function () {
	var context = createTestContext();

	try {
		var response = await request(context.runtime.app).get("/api/health").expect(200);

		// Hợp đồng V1 (plan §7.3.2) — 2 field này không được đổi.
		assert.equal(response.body.status, "ok");
		assert.equal(response.body.database, "ready");

		// Bổ sung V2.
		assert.ok(["neon", "pglite", "none"].indexOf(response.body.dbKind) !== -1, "dbKind lạ: " + response.body.dbKind);
		assert.equal(typeof response.body.dbOk, "boolean");
	} finally {
		await context.cleanup();
	}
});

test("health vẫn trả shape cũ khi không có SQL client (dbKind none, dbOk false)", async function () {
	var tempDir = sharedTempDir;
	var runtime = createApp({
		rootDir: path.resolve(__dirname, ".."),
		staticDir: path.resolve(__dirname, ".."),
		runtimeDir: tempDir,
		jwtSecret: "test-secret-key",
		adminPasswordHash: bcrypt.hashSync("admin123", 10),
		nodeEnv: "test",
		sqlClient: null,
		databaseUrl: "",
		// Ép createSqlClient trả null giống môi trường Vercel thiếu DATABASE_URL.
		pgDataDir: null
	});

	try {
		process.env.VERCEL = "1";
		var noDbRuntime = createApp({
			rootDir: path.resolve(__dirname, ".."),
			staticDir: path.resolve(__dirname, ".."),
			runtimeDir: tempDir,
			jwtSecret: "test-secret-key",
			adminPasswordHash: bcrypt.hashSync("admin123", 10),
			nodeEnv: "test",
			databaseUrl: ""
		});
		delete process.env.VERCEL;

		var response = await request(noDbRuntime.app).get("/api/health").expect(200);

		assert.equal(response.body.status, "ok");
		assert.equal(response.body.database, "ready");
		assert.equal(response.body.dbKind, "none");
		assert.equal(response.body.dbOk, false);

		noDbRuntime.close();
	} finally {
		delete process.env.VERCEL;
		runtime.close();
	}
});
