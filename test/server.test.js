"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var bcrypt = require("bcrypt");
var request = require("supertest");
var createApp = require("../server/app").createApp;

// The tests run against PGlite (embedded Postgres) because DATABASE_URL is unset.
// When a data dir is closed and immediately reopened (the "restart" tests),
// PGlite's WASM teardown emits a late, harmless "PGlite is closed" rejection
// after the test has already finished. This never happens with Neon in
// production. Swallow only that specific noise; re-throw anything else.
process.on("unhandledRejection", function (error) {
	// PGlite (the embedded Postgres used when DATABASE_URL is unset) emits late
	// teardown noise after tests finish — "PGlite is closed" or a WASM-filesystem
	// ErrnoError. Neither happens with Neon in production. Ignore only those.
	var name = error && error.constructor ? error.constructor.name : "";
	var message = error ? String(error.message || "") : "";

	if (name === "ErrnoError" || message.indexOf("PGlite is closed") !== -1) {
		return;
	}

	throw error;
});

function createTestContext() {
	var tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "game-sonic-running-"));
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
			// Do not delete the PGlite data dir here: the cached embedded instance
			// stays alive until process exit, and removing the directory underneath
			// it triggers a late WASM-filesystem ErrnoError. The temp dir is small
			// and reclaimed by the OS.
			return Promise.resolve(runtime.close());
		}
	};
}

test("health endpoint and seeded question bank are available", async function () {
	var context = createTestContext();

	try {
		var healthResponse = await request(context.runtime.app)
			.get("/api/health")
			.expect(200);

		assert.equal(healthResponse.body.status, "ok");
		assert.equal(healthResponse.body.database, "ready");

		var bundleResponse = await request(context.runtime.app)
			.get("/api/levels/lop6/question-bank")
			.expect(200);

		assert.equal(bundleResponse.body.questions.length, 100);
		assert.equal(bundleResponse.body.questions[0].id, "6q001");
		assert.ok(bundleResponse.body.pointSettings.easy > 0);
		assert.ok(bundleResponse.body.timeSettings.easy > 0);
		assert.equal(bundleResponse.body.gameSpeed, 1.0);
	} finally {
		await context.cleanup();
	}
});

test("admin login, session cookie and logout work", async function () {
	var context = createTestContext();
	var agent = request.agent(context.runtime.app);

	try {
		await agent
			.post("/api/admin/login")
			.send({ password: "wrong-password" })
			.expect(401);

		await agent
			.post("/api/admin/login")
			.send({ password: "admin123" })
			.expect(200);

		var sessionResponse = await agent
			.get("/api/admin/session")
			.expect(200);

		assert.equal(sessionResponse.body.authenticated, true);

		await agent
			.post("/api/admin/logout")
			.expect(200);

		var loggedOutSessionResponse = await agent
			.get("/api/admin/session")
			.expect(200);

		assert.equal(loggedOutSessionResponse.body.authenticated, false);
	} finally {
		await context.cleanup();
	}
});

test("question bank writes persist across restarts and duplicate ids are rejected", async function () {
	var context = createTestContext();
	var agent = request.agent(context.runtime.app);

	try {
		await agent
			.post("/api/admin/login")
			.send({ password: "admin123" })
			.expect(200);

		var originalBundleResponse = await agent
			.get("/api/levels/lop6/question-bank")
			.expect(200);

		var updatedQuestions = originalBundleResponse.body.questions.slice();
		updatedQuestions[0] = Object.assign({}, updatedQuestions[0], {
			question: "Câu hỏi đã cập nhật từ test"
		});

		var saveResponse = await agent
			.put("/api/levels/lop6/questions")
			.send({ questions: updatedQuestions })
			.expect(200);

		assert.equal(saveResponse.body.questions[0].question, "Câu hỏi đã cập nhật từ test");

		var duplicateQuestions = updatedQuestions.slice();
		duplicateQuestions[1] = Object.assign({}, duplicateQuestions[1], {
			id: duplicateQuestions[0].id
		});

		await agent
			.put("/api/levels/lop6/questions")
			.send({ questions: duplicateQuestions })
			.expect(400);

		await context.runtime.close();
		context.runtime = createApp(context.config);

		var persistedBundleResponse = await request(context.runtime.app)
			.get("/api/levels/lop6/question-bank")
			.expect(200);

		assert.equal(persistedBundleResponse.body.questions[0].question, "Câu hỏi đã cập nhật từ test");
	} finally {
		await context.cleanup();
	}
});

test("difficulty settings update requires auth and applies to all levels", async function () {
	var context = createTestContext();
	var agent = request.agent(context.runtime.app);

	try {
		await request(context.runtime.app)
			.put("/api/levels/lop6/settings/point")
			.send({ settings: { easy: 99 } })
			.expect(401);

		await agent
			.post("/api/admin/login")
			.send({ password: "admin123" })
			.expect(200);

			var pointResponse = await agent
				.put("/api/levels/lop6/settings/point")
				.send({ settings: { easy: 99 } })
				.expect(200);

			assert.equal(pointResponse.body.pointSettings.easy, 99);
			assert.equal(pointResponse.body.questions[0].point, 99);

			var pointBundleLop7 = await request(context.runtime.app)
				.get("/api/levels/lop7/question-bank")
				.expect(200);
			var pointBundleLop8 = await request(context.runtime.app)
				.get("/api/levels/lop8/question-bank")
				.expect(200);

			assert.equal(pointBundleLop7.body.pointSettings.easy, 99);
			assert.equal(pointBundleLop7.body.questions[0].point, 99);
			assert.equal(pointBundleLop8.body.pointSettings.easy, 99);
			assert.equal(pointBundleLop8.body.questions[0].point, 99);

			var timeResponse = await agent
				.put("/api/levels/lop6/settings/time")
				.send({ settings: { easy: 33 } })
				.expect(200);

			assert.equal(timeResponse.body.timeSettings.easy, 33);
			assert.equal(timeResponse.body.questions[0].time, 33);

			var timeBundleLop7 = await request(context.runtime.app)
				.get("/api/levels/lop7/question-bank")
				.expect(200);
			var timeBundleLop8 = await request(context.runtime.app)
				.get("/api/levels/lop8/question-bank")
				.expect(200);

			assert.equal(timeBundleLop7.body.timeSettings.easy, 33);
			assert.equal(timeBundleLop7.body.questions[0].time, 33);
			assert.equal(timeBundleLop8.body.timeSettings.easy, 33);
			assert.equal(timeBundleLop8.body.questions[0].time, 33);

			var speedResponse = await agent
				.put("/api/levels/lop6/settings/speed")
				.send({ value: 1.6 })
			.expect(200);

		assert.equal(speedResponse.body.gameSpeed, 1.6);

		await context.runtime.close();
		context.runtime = createApp(context.config);

			var persistedBundleResponse = await request(context.runtime.app)
				.get("/api/levels/lop6/question-bank")
				.expect(200);

			assert.equal(persistedBundleResponse.body.gameSpeed, 1.6);

			var persistedBundleLop7 = await request(context.runtime.app)
				.get("/api/levels/lop7/question-bank")
				.expect(200);
			var persistedBundleLop8 = await request(context.runtime.app)
				.get("/api/levels/lop8/question-bank")
				.expect(200);

			assert.equal(persistedBundleLop7.body.gameSpeed, 1.6);
			assert.equal(persistedBundleLop8.body.gameSpeed, 1.6);
		} finally {
			await context.cleanup();
		}
	});

test("leaderboard records scores, ranks players by best, and exposes the viewer entry", async function () {
	var context = createTestContext();

	try {
		var app = context.runtime.app;

		var firstResponse = await request(app)
			.post("/api/scores")
			.send({ deviceId: "dev-A", nickname: "Alice", level: "lop6", score: 100, correctCount: 10, wrongCount: 2, timeoutCount: 1, durationMs: 30000 })
			.expect(200);

		assert.equal(firstResponse.body.rank, 1);
		assert.equal(firstResponse.body.best, 100);

		await request(app)
			.post("/api/scores")
			.send({ deviceId: "dev-B", nickname: "Bob", level: "lop6", score: 250 })
			.expect(200);

		// A lower later score must not lower the player's recorded best.
		await request(app)
			.post("/api/scores")
			.send({ deviceId: "dev-A", nickname: "Alice", level: "lop6", score: 50 })
			.expect(200);

		var boardResponse = await request(app)
			.get("/api/levels/lop6/leaderboard?deviceId=dev-A")
			.expect(200);

		assert.equal(boardResponse.body.entries.length, 2);
		assert.equal(boardResponse.body.entries[0].nickname, "Bob");
		assert.equal(boardResponse.body.entries[0].score, 250);
		assert.equal(boardResponse.body.entries[0].rank, 1);
		assert.equal(boardResponse.body.entries[1].nickname, "Alice");
		assert.equal(boardResponse.body.entries[1].score, 100);
		assert.equal(boardResponse.body.entries[1].isMe, true);
		assert.equal(boardResponse.body.me.rank, 2);
		assert.equal(boardResponse.body.me.score, 100);

		var otherLevelResponse = await request(app)
			.get("/api/levels/lop7/leaderboard")
			.expect(200);

		assert.equal(otherLevelResponse.body.entries.length, 0);
		assert.equal(otherLevelResponse.body.me, null);
	} finally {
		await context.cleanup();
	}
});

test("score submission validates device id, nickname and level", async function () {
	var context = createTestContext();

	try {
		var app = context.runtime.app;

		await request(app).post("/api/scores").send({ nickname: "X", level: "lop6", score: 1 }).expect(400);
		await request(app).post("/api/scores").send({ deviceId: "d", level: "lop6", score: 1 }).expect(400);
		await request(app).post("/api/scores").send({ deviceId: "d", nickname: "X", level: "lop9", score: 1 }).expect(400);
	} finally {
		await context.cleanup();
	}
});

test("nickname update backfills scores and skill profile upserts", async function () {
	var context = createTestContext();

	try {
		var app = context.runtime.app;

		await request(app)
			.post("/api/scores")
			.send({ deviceId: "dev-C", nickname: "OldName", level: "lop8", score: 10 })
			.expect(200);

		await request(app)
			.put("/api/players/dev-C/nickname")
			.send({ nickname: "NewName" })
			.expect(200);

		var boardResponse = await request(app)
			.get("/api/levels/lop8/leaderboard?deviceId=dev-C")
			.expect(200);

		assert.equal(boardResponse.body.entries[0].nickname, "NewName");

		await request(app)
			.put("/api/players/dev-C/skill")
			.send({ level: "lop8", skill: 0.7, accuracy: 0.8, avgAnswerMs: 3000, recommendedSpeed: 1.3, difficultyWeights: { easy: 0.2, medium: 0.5, hard: 0.3 }, gamesPlayed: 3 })
			.expect(200);

		var skillResponse = await request(app)
			.put("/api/players/dev-C/skill")
			.send({ level: "lop8", skill: 0.9, gamesPlayed: 4 })
			.expect(200);

		assert.equal(skillResponse.body.skill, 0.9);
	} finally {
		await context.cleanup();
	}
});
