"use strict";

// P0-15 — CÔNG TẮC RELEASE. Test này canh đúng những thứ mà nếu sai thì người chơi
// thật gặp ngay: V2 không lên được, hoặc V1 vẫn còn chặn, hoặc overlay bảo trì còn sót.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");
var bcrypt = require("bcrypt");
var os = require("os");
var request = require("supertest");
var createApp = require("../server/app").createApp;

var rootDir = path.resolve(__dirname, "..");

test("KHÔNG còn overlay bảo trì ở cả 2 file", function () {
	var indexHtml = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");
	var gameHtml = fs.readFileSync(path.join(rootDir, "EndlessRunner.htm"), "utf8");

	assert.equal(indexHtml.includes("Đang nâng cấp"), false, "index.html còn overlay bảo trì");
	assert.equal(gameHtml.includes("Đang nâng cấp"), false, "EndlessRunner.htm còn overlay bảo trì");
	assert.equal(gameHtml.includes("maintenance-overlay"), false);
	assert.equal(indexHtml.includes("MAINTENANCE MODE"), false);
});

test("V2 build ra THẲNG public/ (không còn public/v2/)", function () {
	var viteConfig = fs.readFileSync(path.join(rootDir, "client", "vite.config.mts"), "utf8");

	// Mặc định V2_ROOT rỗng = V2 chiếm "/".
	assert.ok(
		/process\.env\.V2_ROOT \?\? ""/.test(viteConfig),
		"V2_ROOT phải mặc định rỗng sau khi bật công tắc release"
	);

	var budgetScript = fs.readFileSync(path.join(rootDir, "scripts", "budget-check.mjs"), "utf8");
	assert.ok(
		/process\.env\.V2_ROOT \?\? ""/.test(budgetScript),
		"budget-check phải đo đúng thư mục build mới"
	);
});

test("danh sách copy legacy KHÔNG còn file V1 đè lên V2", function () {
	var buildScript = fs.readFileSync(path.join(rootDir, "scripts", "vercel-build.js"), "utf8");
	var listMatch = buildScript.match(/var staticFiles = \[([\s\S]*?)\];/);

	assert.notEqual(listMatch, null, "không tìm thấy danh sách staticFiles");

	var list = listMatch[1];

	// 2 file này nếu copy sẽ ĐÈ TRỰC TIẾP lên bản build của Vite → xoá sổ V2.
	assert.equal(/"index\.html"/.test(list), false, "copy index.html sẽ đè mất trang V2");
	assert.equal(/"worker\.js"/.test(list), false, "copy worker.js sẽ đè mất Service Worker của V2");

	// Game V1 không phát hành nữa (EndlessRunner.js ~7MB texture base64).
	assert.equal(/"EndlessRunner\.htm"/.test(list), false);
	assert.equal(/"EndlessRunner\.js"/.test(list), false);

	// Nhưng những thứ V2 CẦN thì phải còn.
	assert.ok(/"admin\.html"/.test(list), "admin legacy vẫn phải phục vụ được");
	assert.ok(/"questionBank\.js"/.test(list), "questionBank.js là hợp đồng tích hợp, phải còn");
	assert.ok(buildScript.includes("questionModel.js"), "shared/questionModel.js phải được copy");
});

test("bookmark cũ EndlessRunner.htm được 301 về /", async function () {
	var tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-switch-"));
	var runtime = createApp({
		rootDir: rootDir,
		staticDir: rootDir,
		runtimeDir: tempDir,
		jwtSecret: "test-secret-key",
		adminPasswordHash: bcrypt.hashSync("admin123", 10),
		nodeEnv: "test"
	});

	try {
		var response = await request(runtime.app).get("/EndlessRunner.htm");

		assert.equal(response.status, 301, "phải 301 chứ không phải phục vụ file V1");
		assert.equal(response.headers.location, "/");
	} finally {
		runtime.close();
	}
});

test("admin vẫn vào được sau khi bật công tắc", async function () {
	var tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-switch-admin-"));
	var runtime = createApp({
		rootDir: rootDir,
		staticDir: rootDir,
		runtimeDir: tempDir,
		jwtSecret: "test-secret-key",
		adminPasswordHash: bcrypt.hashSync("admin123", 10),
		nodeEnv: "test"
	});

	try {
		// API admin còn nguyên (trang admin.html do static phục vụ).
		var session = await request(runtime.app).get("/api/admin/session").expect(200);
		assert.equal(typeof session.body.authenticated, "boolean");

		var bundle = await request(runtime.app).get("/api/levels/lop6/question-bank").expect(200);
		assert.ok(Array.isArray(bundle.body.questions));
	} finally {
		runtime.close();
	}
});

test("vercel.json KHÔNG bị sửa (quy tắc vàng #4)", function () {
	var vercelConfig = JSON.parse(fs.readFileSync(path.join(rootDir, "vercel.json"), "utf8"));

	assert.equal(vercelConfig.outputDirectory, "public", "outputDirectory vẫn là public/");
	assert.equal(vercelConfig.buildCommand, "npm run vercel-build");
});
