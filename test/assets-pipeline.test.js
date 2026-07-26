"use strict";

// P0-3 — bảo vệ bộ asset đã build:
//   * assets.json khớp CHÍNH XÁC file thực trên đĩa (không thừa, không thiếu);
//   * mọi file trong client/public đều có một dòng trong docs/LICENSE-ASSETS.md;
//   * ngân sách 500KB/nhân vật giữ nguyên;
//   * bộ asset V2 KHÔNG chứa bất kỳ file Sonic/SEGA nào (quy tắc vàng #7);
//   * 4 nhân vật map đủ 4 id cũ và ai cũng có ít nhất clip idle + run.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");

var rootDir = path.resolve(__dirname, "..");
var publicDir = path.join(rootDir, "client", "public");
var manifestPath = path.join(publicDir, "assets.json");

var MANAGED_DIRECTORIES = ["models", "audio", "textures", "fonts"];
var CHARACTER_BUDGET_BYTES = 500 * 1024;
var LEGACY_CHARACTER_IDS = ["sonic", "robot", "horse", "parrot"];

function listFiles(directory) {
	var results = [];

	if (fs.existsSync(directory) === false) {
		return results;
	}

	fs.readdirSync(directory, { withFileTypes: true }).forEach(function (entry) {
		var entryPath = path.join(directory, entry.name);

		if (entry.isDirectory() === true) {
			results = results.concat(listFiles(entryPath));
			return;
		}

		results.push(path.relative(publicDir, entryPath).split(path.sep).join("/"));
	});

	return results;
}

function readManifest() {
	assert.ok(
		fs.existsSync(manifestPath),
		"thiếu client/public/assets.json — chạy `npm run assets:fetch && npm run assets:build`"
	);

	return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function allManagedFiles() {
	return MANAGED_DIRECTORIES.reduce(function (files, directory) {
		return files.concat(listFiles(path.join(publicDir, directory)));
	}, []);
}

test("assets.json khớp chính xác file thực trên đĩa", function () {
	var manifest = readManifest();
	var declared = []
		.concat(manifest.characters.map(function (character) { return character.url; }))
		.concat(manifest.props.map(function (prop) { return prop.url; }))
		.concat(manifest.particles)
		.concat(manifest.icons)
		.concat(manifest.audio);

	var onDisk = allManagedFiles();
	// Font không liệt kê từng file trong assets.json (CSS @font-face quản), bỏ qua ở đây.
	var onDiskNoFonts = onDisk.filter(function (file) {
		return file.startsWith("fonts/") === false;
	});

	var missing = declared.filter(function (url) {
		return onDisk.indexOf(url) === -1;
	});
	var undeclared = onDiskNoFonts.filter(function (file) {
		return declared.indexOf(file) === -1;
	});

	assert.deepEqual(missing, [], "assets.json khai báo file không tồn tại");
	assert.deepEqual(undeclared, [], "có file trong client/public chưa được assets.json khai báo");
});

test("mọi file asset đều có dòng trong docs/LICENSE-ASSETS.md", function () {
	var licensePath = path.join(rootDir, "docs", "LICENSE-ASSETS.md");
	assert.ok(fs.existsSync(licensePath), "thiếu docs/LICENSE-ASSETS.md — chạy `npm run assets:license`");

	var licenseText = fs.readFileSync(licensePath, "utf8");
	var missing = allManagedFiles().filter(function (file) {
		if (file.startsWith("fonts/") === true) {
			// Font ghi theo họ (baloo-2-*, nunito-*) chứ không từng weight.
			return licenseText.indexOf(file.split("-v")[0]) === -1;
		}

		return licenseText.indexOf("`" + file + "`") === -1;
	});

	assert.deepEqual(missing, [], "asset chưa có hồ sơ bản quyền — chạy `npm run assets:license`");
});

test("mỗi GLB nhân vật nằm trong ngân sách 500KB", function () {
	var manifest = readManifest();

	manifest.characters.forEach(function (character) {
		var filePath = path.join(publicDir, character.url);
		var bytes = fs.statSync(filePath).size;

		assert.ok(
			bytes <= CHARACTER_BUDGET_BYTES,
			character.id + " nặng " + Math.round(bytes / 1024) + "KB, vượt ngân sách 500KB"
		);
		assert.equal(bytes, character.bytes, character.id + ": dung lượng lệch với assets.json");
	});
});

test("4 nhân vật map đủ 4 id cũ và có tối thiểu clip idle + run", function () {
	var manifest = readManifest();

	assert.equal(manifest.characters.length, 4, "P0 chốt đúng 4 nhân vật (plan §3 Q5)");

	var legacyIds = manifest.characters.map(function (character) {
		return character.legacyId;
	});

	LEGACY_CHARACTER_IDS.forEach(function (legacyId) {
		assert.ok(
			legacyIds.indexOf(legacyId) !== -1,
			"id cũ \"" + legacyId + "\" không được map sang nhân vật V2 nào (hợp đồng plan §7.3.3)"
		);
	});

	manifest.characters.forEach(function (character) {
		assert.ok(character.clips.indexOf("idle") !== -1, character.id + " thiếu clip idle");
		assert.ok(character.clips.indexOf("run") !== -1, character.id + " thiếu clip run");
	});

	// Nhân vật mặc định (thay `sonic`) phải đủ 6 clip — không được fallback.
	var knight = manifest.characters.find(function (character) {
		return character.legacyId === "sonic";
	});
	assert.deepEqual(
		knight.clips.slice().sort(),
		["death", "hit", "idle", "jump", "run", "slide"],
		"nhân vật mặc định phải có đủ 6 clip, không dùng fallback"
	);
});

test("bộ asset V2 không chứa asset Sonic/SEGA", function () {
	var offenders = allManagedFiles().filter(function (file) {
		return /sonic|sega|tails|knuckles/i.test(file);
	});

	assert.deepEqual(offenders, [], "phát hiện asset IP bị cấm trong client/public");
});

test("mọi clip fallback đều được ghi lại, không im lặng", function () {
	var manifest = readManifest();

	assert.ok(Array.isArray(manifest.clipFallbacks), "assets.json phải có mảng clipFallbacks");

	var expectedFallbackCount = manifest.characters.reduce(function (total, character) {
		return total + (6 - character.clips.length);
	}, 0);

	assert.equal(
		manifest.clipFallbacks.length,
		expectedFallbackCount,
		"số dòng fallback phải khớp số clip thiếu — mỗi clip thiếu phải được ghi rõ"
	);
});
