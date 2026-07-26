"use strict";

// P0-8 — máy trạng thái streak/Fever/power-up và luật chồng (stack).
// Đây là chỗ dễ sinh lỗi "combo vô hạn" hoặc "khiên bị Fever ăn mất", nên test kỹ.

var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("../test-helpers/clientModule");
var loadClientModule = helpers.loadClientModule;
var loadClientBundle = helpers.loadClientBundle;

test("streak: 3 đúng → ×1.5, 5 đúng → ×2 và DỪNG ở đó (có trần)", async function () {
	var Combo = (await loadClientModule("systems/Combo.ts")).Combo;
	var combo = new Combo();

	assert.equal(combo.multiplier, 1, "chưa có streak thì ×1");

	combo.registerCorrect();
	assert.equal(combo.multiplier, 1, "1 đúng chưa lên mốc");
	combo.registerCorrect();
	assert.equal(combo.multiplier, 1, "2 đúng chưa lên mốc");

	combo.registerCorrect();
	assert.equal(combo.multiplier, 1.5, "mốc 3 đúng → ×1.5");

	combo.registerCorrect();
	assert.equal(combo.multiplier, 1.5);

	combo.registerCorrect();
	assert.equal(combo.multiplier, 2, "mốc 5 đúng → ×2");

	for (var index = 0; index < 20; index += 1) {
		combo.registerCorrect();
	}

	assert.equal(combo.multiplier, 2, "×2 là TRẦN, không được leo tiếp");
	assert.equal(combo.currentStreak, 25);
});

test("sai/timeout làm vỡ streak về ×1 và phát sự kiện broken", async function () {
	var Combo = (await loadClientModule("systems/Combo.ts")).Combo;
	var combo = new Combo();
	var events = [];
	combo.onEvent(function (event) { events.push(event.type); });

	combo.registerCorrect();
	combo.registerCorrect();
	combo.registerCorrect();
	assert.equal(combo.multiplier, 1.5);

	combo.registerWrong();
	assert.equal(combo.currentStreak, 0);
	assert.equal(combo.multiplier, 1, "vỡ streak phải về đúng ×1");
	assert.ok(events.indexOf("broken") !== -1);

	// Vỡ khi đang 0 streak thì không phát sự kiện thừa.
	events.length = 0;
	combo.registerWrong();
	assert.equal(events.indexOf("broken"), -1, "không phát 'broken' khi vốn đã 0");
});

test("Fever: mở ở streak 5, kéo 8s, cảnh báo 2s cuối rồi tắt", async function () {
	var mods = await loadClientBundle({ Combo: "systems/Combo.ts", tuningModule: "tuning.ts" });
	var scoring = mods.tuningModule.tuning.scoring;
	var combo = new mods.Combo.Combo();
	var events = [];
	combo.onEvent(function (event) { events.push(event.type); });

	for (var index = 0; index < scoring.feverStreak - 1; index += 1) {
		combo.registerCorrect();
	}

	assert.equal(combo.isFeverActive, false, "chưa đủ 5 đúng thì chưa Fever");

	assert.equal(combo.registerCorrect(), true, "câu thứ 5 phải kích hoạt Fever");
	assert.equal(combo.isFeverActive, true);
	assert.equal(combo.coinMultiplier, scoring.feverCoinMultiplier, "Fever cho coin ×2");
	assert.ok(events.indexOf("fever-start") !== -1);

	// Chạy tới trước mốc cảnh báo.
	var step = 1 / 60;
	var elapsed = 0;

	while (elapsed < scoring.feverDurationSec - scoring.feverWarningSec - 0.2) {
		combo.update(step);
		elapsed += step;
	}

	assert.equal(events.indexOf("fever-warning"), -1, "chưa tới 2s cuối thì chưa cảnh báo");

	while (elapsed < scoring.feverDurationSec - 0.1) {
		combo.update(step);
		elapsed += step;
	}

	assert.ok(events.indexOf("fever-warning") !== -1, "phải cảnh báo ở 2s cuối");
	assert.equal(combo.isFeverActive, true);

	while (combo.isFeverActive === true && elapsed < scoring.feverDurationSec + 1) {
		combo.update(step);
		elapsed += step;
	}

	assert.equal(combo.isFeverActive, false);
	assert.equal(combo.coinMultiplier, 1, "hết Fever thì coin về ×1");
	assert.ok(events.indexOf("fever-end") !== -1);

	// Cảnh báo chỉ phát ĐÚNG MỘT LẦN, không spam mỗi frame.
	var warnings = events.filter(function (type) { return type === "fever-warning"; });
	assert.equal(warnings.length, 1);
});

test("đang Fever mà tiếp tục đúng thì KHÔNG kích hoạt Fever chồng", async function () {
	var Combo = (await loadClientModule("systems/Combo.ts")).Combo;
	var combo = new Combo();

	for (var index = 0; index < 5; index += 1) {
		combo.registerCorrect();
	}

	assert.equal(combo.isFeverActive, true);
	assert.equal(combo.registerCorrect(), false, "đang Fever thì câu đúng tiếp theo không mở Fever mới");
});

test("power-up: nhặt lại cùng loại LÀM MỚI thời gian, không cộng dồn", async function () {
	var mods = await loadClientBundle({ Powerup: "systems/Powerup.ts", tuningModule: "tuning.ts" });
	var magnetSec = mods.tuningModule.tuning.powerup.magnetSec;
	var powerups = new mods.Powerup.Powerups();

	powerups.collect("magnet");
	assert.equal(powerups.remaining("magnet"), magnetSec);

	// Chạy 5s rồi nhặt lại.
	for (var index = 0; index < 60 * 5; index += 1) {
		powerups.update(1 / 60);
	}

	assert.ok(powerups.remaining("magnet") < magnetSec);
	powerups.collect("magnet");
	assert.ok(
		Math.abs(powerups.remaining("magnet") - magnetSec) < 1e-9,
		"nhặt lại phải đặt về đúng 8s, KHÔNG cộng thành 11s"
	);
});

test("power-up khác loại chạy song song, hết hạn độc lập", async function () {
	var mods = await loadClientBundle({ Powerup: "systems/Powerup.ts", tuningModule: "tuning.ts" });
	var powerups = new mods.Powerup.Powerups();
	var powerupTuning = mods.tuningModule.tuning.powerup;

	powerups.collect("magnet");
	powerups.collect("doublePoints");

	assert.equal(powerups.isActive("magnet"), true);
	assert.equal(powerups.isActive("doublePoints"), true);
	assert.equal(powerups.pointMultiplier, powerupTuning.doublePointsMultiplier);

	// Magnet (8s) hết trước ×2 điểm (10s).
	for (var index = 0; index < 60 * 9; index += 1) {
		powerups.update(1 / 60);
	}

	assert.equal(powerups.isActive("magnet"), false, "magnet 8s phải hết trước");
	assert.equal(powerups.isActive("doublePoints"), true, "×2 điểm 10s vẫn còn");

	for (var step = 0; step < 60 * 2; step += 1) {
		powerups.update(1 / 60);
	}

	assert.equal(powerups.isActive("doublePoints"), false);
	assert.equal(powerups.pointMultiplier, 1);
});

test("khiên là SỐ LẦN ĐỠ, không phải thời gian, và Fever không tiêu khiên", async function () {
	var mods = await loadClientBundle({
		Powerup: "systems/Powerup.ts",
		Combo: "systems/Combo.ts",
		tuningModule: "tuning.ts"
	});
	var powerups = new mods.Powerup.Powerups();

	powerups.collect("shield");
	assert.equal(powerups.isActive("shield"), true);

	// Thời gian trôi KHÔNG làm mất khiên.
	for (var index = 0; index < 60 * 30; index += 1) {
		powerups.update(1 / 60);
	}

	assert.equal(powerups.isActive("shield"), true, "khiên không hết theo thời gian");

	assert.equal(powerups.consumeShield(), true, "đỡ được 1 cú");
	assert.equal(powerups.isActive("shield"), false);
	assert.equal(powerups.consumeShield(), false, "hết khiên thì không đỡ được nữa");
});

test("magnetRadius bật khi có Magnet HOẶC đang Fever", async function () {
	var mods = await loadClientBundle({ Powerup: "systems/Powerup.ts", tuningModule: "tuning.ts" });
	var powerups = new mods.Powerup.Powerups();
	var radius = mods.tuningModule.tuning.powerup.magnetRadius;

	assert.equal(powerups.magnetRadius(false), 0, "không có gì thì không hút");
	assert.equal(powerups.magnetRadius(true), radius, "Fever tự hút coin toàn màn");

	powerups.collect("magnet");
	assert.equal(powerups.magnetRadius(false), radius);
});

test("reset ván mới xoá sạch streak, Fever và power-up", async function () {
	var mods = await loadClientBundle({ Combo: "systems/Combo.ts", Powerup: "systems/Powerup.ts" });
	var combo = new mods.Combo.Combo();
	var powerups = new mods.Powerup.Powerups();

	for (var index = 0; index < 6; index += 1) {
		combo.registerCorrect();
	}

	powerups.collect("magnet");
	powerups.collect("shield");

	combo.reset();
	powerups.reset();

	assert.equal(combo.currentStreak, 0);
	assert.equal(combo.isFeverActive, false);
	assert.equal(combo.multiplier, 1);
	assert.equal(powerups.isActive("magnet"), false);
	assert.equal(powerups.isActive("shield"), false);
});
