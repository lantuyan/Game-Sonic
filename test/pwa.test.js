"use strict";

// P0-12 — RỦI RO R1: chuyển tiếp Service Worker từ V1 sang V2.
//
// Nếu bước này sai thì máy học sinh giữ mãi SW cũ và KHÔNG BAO GIỜ nhận được V2 —
// hỏng âm thầm, không có lỗi nào hiện ra. Vì vậy canh từng điều khoản hợp đồng
// (plan §7.3.5) ngay ở mức mã nguồn + cấu hình, để CI đỏ trước khi kịp deploy.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");

var rootDir = path.resolve(__dirname, "..");
var workerSource = fs.readFileSync(path.join(rootDir, "client", "src", "worker.ts"), "utf8");
var viteConfig = fs.readFileSync(path.join(rootDir, "client", "vite.config.mts"), "utf8");

test("SW build ra ĐÚNG tên worker.js — cùng URL với V1", function () {
	// V1 đăng ký `navigator.serviceWorker.register("worker.js")`. Trình duyệt chỉ
	// coi là bản cập nhật khi TRÙNG URL; đổi tên file là SW cũ sống mãi.
	assert.ok(
		/filename:\s*"worker\.ts"/.test(viteConfig),
		"vite.config phải đặt filename worker.ts để build ra worker.js"
	);

	var legacyWorker = fs.readFileSync(path.join(rootDir, "worker.js"), "utf8");
	assert.ok(
		legacyWorker.includes("endlessrunner-static-v9"),
		"worker.js của V1 vẫn phải còn để đối chiếu tên cache (đừng xoá trước P0-15)"
	);
});

test("SW mới XÓA cache của V1", function () {
	assert.ok(
		workerSource.includes("endlessrunner-static-v9"),
		"phải xoá cache tĩnh của V1, nếu không máy học sinh giữ mãi file cũ"
	);
	assert.ok(workerSource.includes("endlessrunner-api-v1"), "phải xoá cache API của V1");
	assert.ok(/caches\.delete/.test(workerSource), "phải thực sự gọi caches.delete");
	assert.ok(/cleanupOutdatedCaches\(\)/.test(workerSource), "phải dọn precache của bản V2 cũ");
});

test("skipWaiting + clientsClaim để không phải chờ đóng hết tab", function () {
	assert.ok(/skipWaiting\(\)/.test(workerSource));
	assert.ok(/clientsClaim\(\)/.test(workerSource));
});

test("đề bài dùng NETWORK-FIRST (giữ hành vi offline của V1)", function () {
	assert.ok(
		workerSource.includes("question-bank"),
		"phải có route riêng cho /api/levels/*/question-bank"
	);
	assert.ok(
		/NetworkFirst/.test(workerSource),
		"đề bài phải network-first: giáo viên sửa đề thì học sinh thấy ngay, mất mạng mới dùng cache"
	);
	// Model/audio nặng và không đổi → cache-first.
	assert.ok(/CacheFirst/.test(workerSource), "model/audio phải cache-first");
});

test("SW đóng gói dạng IIFE, không phải ES module", function () {
	// SW dạng module cần đăng ký `{type:"module"}` — Chrome cũ ở phòng tin học và
	// iOS <16.4 không hỗ trợ, SW sẽ im lặng không cài được.
	assert.ok(
		/rollupFormat:\s*"iife"/.test(viteConfig),
		"phải ép rollupFormat iife cho tương thích trình duyệt cũ"
	);
});

test("manifest PWA có đủ icon 192/512 + maskable và tiếng Việt", function () {
	assert.ok(/"icons\/icon-192\.png"|icons\/icon-192\.png/.test(viteConfig));
	assert.ok(/icons\/icon-512\.png/.test(viteConfig));
	assert.ok(/maskable/.test(viteConfig), "cần icon maskable cho Android");
	assert.ok(/lang:\s*"vi"/.test(viteConfig));

	for (var iconName of ["icon-192.png", "icon-512.png", "icon-maskable-512.png"]) {
		var iconPath = path.join(rootDir, "client", "public", "icons", iconName);
		assert.ok(fs.existsSync(iconPath), "thiếu icon " + iconName);
		assert.ok(fs.statSync(iconPath).size > 500, iconName + " có vẻ rỗng");
	}
});

test("prompt cập nhật chứ KHÔNG tự tải lại giữa ván", function () {
	var pwaSource = fs.readFileSync(path.join(rootDir, "client", "src", "core", "pwa.ts"), "utf8");

	assert.ok(/registerType:\s*"prompt"/.test(viteConfig), "phải dùng registerType prompt");
	assert.ok(pwaSource.includes("Đã có bản mới"), "phải có prompt tiếng Việt cho học sinh");
	assert.ok(/onNeedRefresh/.test(pwaSource));
	// Tự reload sẽ giết ván đang chơi dở.
	assert.ok(
		/import\.meta\.env\.DEV/.test(pwaSource),
		"dev không được đăng ký SW, nếu không sẽ cache mất file đang sửa"
	);
});

test("V1 vẫn giữ nguyên route / cho tới P0-15", function () {
	var buildScript = fs.readFileSync(path.join(rootDir, "scripts", "vercel-build.js"), "utf8");

	assert.ok(
		buildScript.includes('"worker.js"'),
		"trong P0, worker.js của V1 vẫn được copy ra public/ — V2 nằm ở public/v2/"
	);
});
