"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var bcrypt = require("bcrypt");
var request = require("supertest");
var createApp = require("../server/app").createApp;

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
			runtime.close();
			fs.rmSync(tempDir, { recursive: true, force: true });
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
		context.cleanup();
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
		context.cleanup();
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

		context.runtime.close();
		context.runtime = createApp(context.config);

		var persistedBundleResponse = await request(context.runtime.app)
			.get("/api/levels/lop6/question-bank")
			.expect(200);

		assert.equal(persistedBundleResponse.body.questions[0].question, "Câu hỏi đã cập nhật từ test");
	} finally {
		context.cleanup();
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

		context.runtime.close();
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
			context.cleanup();
		}
	});
