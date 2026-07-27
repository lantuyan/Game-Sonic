"use strict";

// P1-1 — NEAR-MISS. DoD nói thẳng cạm bẫy: "near-miss không kích hoạt nhầm khi va
// chạm thật". Bộ test này tấn công đúng chỗ đó:
//   · đâm thẳng → 0 thưởng, kể cả khi frame trước đó đo được khoảng hở đẹp;
//   · lướt sát nhưng KHÔNG chạm → đúng 1 thưởng, không lặp;
//   · đi cách xa → 0 thưởng;
//   · nhảy sát nóc rào thấp / trượt sát khe rào cao cũng tính là sát nút.

var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("../test-helpers/clientModule");
var loadClientBundle = helpers.loadClientBundle;

function makeBand(overrides) {
	return Object.assign(
		{
			active: true,
			lane: 1,
			kind: "full",
			zStart: -3,
			zEnd: -1.4,
			consumed: false,
			nearMissMin: Number.POSITIVE_INFINITY,
			nearMissAwarded: false
		},
		overrides || {}
	);
}

function makePlayer(tuning, overrides) {
	return Object.assign(
		{
			x: 0,
			y: 0,
			z: tuning.world.playerZ,
			halfWidth: tuning.player.halfWidth,
			halfDepth: 0.6,
			height: tuning.player.height,
			pose: "run"
		},
		overrides || {}
	);
}

/**
 * Cho chướng ngại trôi qua player theo đúng nhịp thế giới và trả về tổng số
 * near-miss được thưởng. Đây là mô phỏng gần nhất với vòng lặp thật.
 */
function sweepPast(tracker, player, band, options) {
	var settings = options || {};
	var stepUnits = settings.stepUnits || 0.25;
	var total = 0;

	for (var index = 0; index < 60; index += 1) {
		if (typeof settings.beforeSample === "function") {
			settings.beforeSample(player, band, index);
		}

		total += tracker.sample(player, [band]);
		band.zStart += stepUnits;
		band.zEnd += stepUnits;

		if (band.zStart > 12) {
			break;
		}
	}

	return total;
}

test("lướt sát chướng ngại ở làn bên cạnh → thưởng ĐÚNG 1 lần", async function () {
	var mods = await loadClientBundle({ NearMiss: "systems/NearMiss.ts", tuningModule: "tuning.ts" });
	var tuning = mods.tuningModule.tuning;
	var tracker = new mods.NearMiss.NearMissTracker();

	// Chướng ngại ở làn 1 (x = 0), player nhích sang phải vừa đủ để né trong gang tấc.
	var gap = 0.2;
	var player = makePlayer(tuning, {
		x: tuning.player.halfWidth + tuning.nearMiss.obstacleHalfWidth + gap
	});

	var awarded = sweepPast(tracker, player, makeBand());
	assert.equal(awarded, 1, "khoảng hở " + gap + " unit phải tính là sát nút");
});

test("đi xa chướng ngại → KHÔNG thưởng", async function () {
	var mods = await loadClientBundle({ NearMiss: "systems/NearMiss.ts", tuningModule: "tuning.ts" });
	var tuning = mods.tuningModule.tuning;
	var tracker = new mods.NearMiss.NearMissTracker();

	// Cách hẳn 1 làn: khoảng hở ≫ ngưỡng 0.4.
	var player = makePlayer(tuning, { x: tuning.world.laneOffsetX });

	assert.equal(sweepPast(tracker, player, makeBand()), 0);
});

test("VA CHẠM THẬT → 0 thưởng, dù frame trước đã đo được khoảng hở nhỏ", async function () {
	var mods = await loadClientBundle({ NearMiss: "systems/NearMiss.ts", tuningModule: "tuning.ts" });
	var tuning = mods.tuningModule.tuning;
	var tracker = new mods.NearMiss.NearMissTracker();

	var player = makePlayer(tuning, {
		x: tuning.player.halfWidth + tuning.nearMiss.obstacleHalfWidth + 0.15
	});

	// Đúng lúc chồng nhau thì player lạng vào — RunScene đánh dấu consumed.
	var awarded = sweepPast(tracker, player, makeBand(), {
		beforeSample: function (currentPlayer, band) {
			if (band.zEnd >= currentPlayer.z - 0.3 && band.zStart <= currentPlayer.z) {
				currentPlayer.x = 0;
				band.consumed = true;
			}
		}
	});

	assert.equal(awarded, 0, "đâm thật mà vẫn được thưởng là lỗi nghiêm trọng của DoD P1-1");
});

test("cùng làn, tư thế không né được → coi là đâm, không thưởng", async function () {
	var mods = await loadClientBundle({ NearMiss: "systems/NearMiss.ts", tuningModule: "tuning.ts" });
	var tuning = mods.tuningModule.tuning;
	var tracker = new mods.NearMiss.NearMissTracker();

	// Chạy thẳng vào khối chặn cả làn: dù chưa kịp đánh dấu consumed cũng không được thưởng.
	var player = makePlayer(tuning, { x: 0, pose: "run" });
	assert.equal(sweepPast(tracker, player, makeBand({ kind: "full" })), 0);
});

test("nhảy sát nóc rào thấp = sát nút", async function () {
	var mods = await loadClientBundle({ NearMiss: "systems/NearMiss.ts", tuningModule: "tuning.ts" });
	var tuning = mods.tuningModule.tuning;
	var tracker = new mods.NearMiss.NearMissTracker();

	// y cao hơn mép rào đúng 0.2 unit — vừa lọt, sát nút.
	var player = makePlayer(tuning, { x: 0, pose: "jump", y: tuning.nearMiss.lowTopY + 0.2 });
	assert.equal(sweepPast(tracker, player, makeBand({ kind: "low" })), 1);

	// Nhảy cao hẳn thì không phải sát nút.
	var soaring = makePlayer(tuning, { x: 0, pose: "jump", y: tuning.nearMiss.lowTopY + 1.4 });
	assert.equal(sweepPast(tracker, soaring, makeBand({ kind: "low" })), 0);
});

test("trượt sát khe rào cao = sát nút", async function () {
	var mods = await loadClientBundle({ NearMiss: "systems/NearMiss.ts", tuningModule: "tuning.ts" });
	var tuning = mods.tuningModule.tuning;
	var tracker = new mods.NearMiss.NearMissTracker();

	// Đỉnh đầu lúc trượt = y + height × slideHitboxScale.
	var headroom = 0.15;
	var slideHeight = tuning.player.height * tuning.player.slideHitboxScale;
	var player = makePlayer(tuning, {
		x: 0,
		pose: "slide",
		y: tuning.nearMiss.highGapY - slideHeight - headroom
	});

	assert.equal(sweepPast(tracker, player, makeBand({ kind: "high" })), 1);
});

test("một chướng ngại chỉ thưởng MỘT lần dù đi qua nhiều frame", async function () {
	var mods = await loadClientBundle({ NearMiss: "systems/NearMiss.ts", tuningModule: "tuning.ts" });
	var tuning = mods.tuningModule.tuning;
	var tracker = new mods.NearMiss.NearMissTracker();

	var player = makePlayer(tuning, {
		x: tuning.player.halfWidth + tuning.nearMiss.obstacleHalfWidth + 0.2
	});
	var band = makeBand();

	var total = sweepPast(tracker, player, band, { stepUnits: 0.08 });
	assert.equal(total, 1);

	// Gọi thêm cả trăm frame nữa cũng không được cộng thêm.
	for (var index = 0; index < 100; index += 1) {
		total += tracker.sample(player, [band]);
	}

	assert.equal(total, 1);
});

test("slot tái chế được đo lại từ đầu", async function () {
	var mods = await loadClientBundle({ NearMiss: "systems/NearMiss.ts", tuningModule: "tuning.ts" });
	var tuning = mods.tuningModule.tuning;
	var tracker = new mods.NearMiss.NearMissTracker();

	var player = makePlayer(tuning, {
		x: tuning.player.halfWidth + tuning.nearMiss.obstacleHalfWidth + 0.2
	});
	var band = makeBand();

	assert.equal(sweepPast(tracker, player, band), 1);

	// Spawn tái sử dụng slot cho pattern mới.
	mods.NearMiss.resetNearMiss(band);
	band.zStart = -3;
	band.zEnd = -1.4;

	assert.equal(sweepPast(tracker, player, band), 1, "slot dùng lại phải đo lại được");
});

test("cờ tắt near-miss trong tuning làm hệ thống im hoàn toàn", async function () {
	var mods = await loadClientBundle({ NearMiss: "systems/NearMiss.ts", tuningModule: "tuning.ts" });
	var tuning = mods.tuningModule.tuning;
	var tracker = new mods.NearMiss.NearMissTracker();

	var player = makePlayer(tuning, {
		x: tuning.player.halfWidth + tuning.nearMiss.obstacleHalfWidth + 0.2
	});

	mods.tuningModule.setTuningValue("nearMiss.enabled", 0);

	try {
		assert.equal(sweepPast(tracker, player, makeBand()), 0);
	} finally {
		mods.tuningModule.setTuningValue("nearMiss.enabled", 1);
	}
});

test("ngưỡng đúng bằng 0.4 unit theo plan §4.4", async function () {
	var mods = await loadClientBundle({ NearMiss: "systems/NearMiss.ts", tuningModule: "tuning.ts" });
	var tuning = mods.tuningModule.tuning;

	assert.equal(tuning.nearMiss.thresholdUnits, 0.4);
	assert.equal(tuning.nearMiss.points, 10);

	var tracker = new mods.NearMiss.NearMissTracker();
	var base = tuning.player.halfWidth + tuning.nearMiss.obstacleHalfWidth;

	// Ngay dưới ngưỡng → thưởng; ngay trên ngưỡng → không.
	assert.equal(sweepPast(tracker, makePlayer(tuning, { x: base + 0.39 }), makeBand()), 1);
	assert.equal(sweepPast(tracker, makePlayer(tuning, { x: base + 0.41 }), makeBand()), 0);
});

test("điểm near-miss KHÔNG bị nhân bởi streak/power-up", async function () {
	var mods = await loadClientBundle({ Score: "systems/Score.ts", tuningModule: "tuning.ts" });
	var score = new mods.Score.Score();

	score.reset();
	score.setPointMultiplier(2);

	assert.equal(score.addBonus(10), 10, "bonus phải vào thẳng, không nhân ×2");
	assert.equal(score.snapshot().bonusScore, 10);
	assert.equal(score.total, 10);

	// Giá trị vô lý bị chặn.
	assert.equal(score.addBonus(-5), 0);
	assert.equal(score.addBonus(Number.NaN), 0);
	assert.equal(score.snapshot().bonusScore, 10);
});
