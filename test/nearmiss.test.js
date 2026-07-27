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

// --- P2-2 · bậc CỰC SÁT + chuỗi liên tiếp ------------------------------------
//
// Điều được canh kỹ nhất: mọi test P1-1 ở trên vẫn phải xanh nguyên. Chuỗi và bậc
// PERFECT là hai lớp CỘNG THÊM lên trên luật cũ, không được đổi luật cũ.

/**
 * Như `sweepPast` nhưng cộng dồn cả số CỰC SÁT.
 * Phải cộng NGAY sau mỗi `sample()`: `lastPerfectCount` chỉ nói về lần gọi gần
 * nhất, và vòng quét còn chạy tiếp nhiều frame sau khi đã chốt thưởng.
 */
function sweepPastCounting(tracker, player, band) {
	var awarded = 0;
	var perfect = 0;

	for (var index = 0; index < 60; index += 1) {
		awarded += tracker.sample(player, [band]);
		perfect += tracker.lastPerfectCount;
		band.zStart += 0.25;
		band.zEnd += 0.25;

		if (band.zStart > 12) {
			break;
		}
	}

	return { awarded: awarded, perfect: perfect };
}

test("bậc CỰC SÁT chỉ ăn khi khoảng hở dưới ngưỡng hẹp", async function () {
	var mods = await loadClientBundle({ NearMiss: "systems/NearMiss.ts", tuningModule: "tuning.ts" });
	var tuning = mods.tuningModule.tuning;
	var tracker = new mods.NearMiss.NearMissTracker();
	var base = tuning.player.halfWidth + tuning.nearMiss.obstacleHalfWidth;

	// Hở 0.1 < perfectUnits (0.18) → CỰC SÁT.
	var tight = sweepPastCounting(tracker, makePlayer(tuning, { x: base + 0.1 }), makeBand());
	assert.equal(tight.awarded, 1);
	assert.equal(tight.perfect, 1);

	// Hở 0.3: vẫn là near-miss (<0.4) nhưng KHÔNG phải CỰC SÁT.
	var loose = sweepPastCounting(tracker, makePlayer(tuning, { x: base + 0.3 }), makeBand());
	assert.equal(loose.awarded, 1);
	assert.equal(loose.perfect, 0);
});

test("ngưỡng near-miss cũ (0.4) KHÔNG bị đổi — bậc mới nằm bên trong nó", async function () {
	var mods = await loadClientBundle({ NearMiss: "systems/NearMiss.ts", tuningModule: "tuning.ts" });
	var nearMissTuning = mods.tuningModule.tuning.nearMiss;

	assert.equal(nearMissTuning.thresholdUnits, 0.4, "plan §4.4 chốt 0.4 — đổi là mở lại quyết định thiết kế");
	assert.ok(
		nearMissTuning.perfectUnits > 0 && nearMissTuning.perfectUnits < nearMissTuning.thresholdUnits,
		"CỰC SÁT phải nằm trong ngưỡng near-miss, không phải thay nó"
	);
});

test("chuỗi: 3 lần liên tiếp mới lên hệ số, và điểm nhân theo hệ số đó", async function () {
	var mods = await loadClientBundle({ NearMiss: "systems/NearMiss.ts", tuningModule: "tuning.ts" });
	var tuning = mods.tuningModule.tuning;
	var chain = new mods.NearMiss.NearMissChainTracker();

	var first = chain.register(1, 0, tuning.nearMiss.points);
	assert.equal(first.chain, 1);
	assert.equal(first.multiplier, 1, "chuỗi 1 chưa được thưởng thêm gì");
	assert.equal(first.points, tuning.nearMiss.points);

	chain.register(1, 0, tuning.nearMiss.points);
	var third = chain.register(1, 0, tuning.nearMiss.points);

	assert.equal(third.chain, tuning.nearMiss.chainTier1);
	assert.equal(third.multiplier, tuning.nearMiss.chainTier1Multiplier);
	assert.equal(third.points, Math.round(tuning.nearMiss.points * tuning.nearMiss.chainTier1Multiplier));
});

test("chuỗi: hệ số lên đúng ba bậc rồi dừng, không tăng vô hạn", async function () {
	var mods = await loadClientBundle({ NearMiss: "systems/NearMiss.ts", tuningModule: "tuning.ts" });
	var nearMissTuning = mods.tuningModule.tuning.nearMiss;
	var chainMultiplier = mods.NearMiss.chainMultiplier;

	assert.equal(chainMultiplier(1), 1);
	assert.equal(chainMultiplier(nearMissTuning.chainTier1), nearMissTuning.chainTier1Multiplier);
	assert.equal(chainMultiplier(nearMissTuning.chainTier2), nearMissTuning.chainTier2Multiplier);
	assert.equal(chainMultiplier(nearMissTuning.chainTier3), nearMissTuning.chainTier3Multiplier);
	assert.equal(
		chainMultiplier(nearMissTuning.chainTier3 * 10),
		nearMissTuning.chainTier3Multiplier,
		"chuỗi 100 không được cho ×30 — trần phải là trần"
	);

	// Bậc phải TĂNG DẦN, nếu không thì nối chuỗi có lúc lại thiệt.
	assert.ok(nearMissTuning.chainTier1 < nearMissTuning.chainTier2);
	assert.ok(nearMissTuning.chainTier2 < nearMissTuning.chainTier3);
	assert.ok(nearMissTuning.chainTier1Multiplier < nearMissTuning.chainTier2Multiplier);
	assert.ok(nearMissTuning.chainTier2Multiplier < nearMissTuning.chainTier3Multiplier);
});

test("chuỗi: hết cửa sổ thời gian thì về 0", async function () {
	var mods = await loadClientBundle({ NearMiss: "systems/NearMiss.ts", tuningModule: "tuning.ts" });
	var tuning = mods.tuningModule.tuning;
	var chain = new mods.NearMiss.NearMissChainTracker();

	chain.register(2, 0, tuning.nearMiss.points);
	assert.equal(chain.current, 2);

	// Còn trong cửa sổ.
	chain.update(tuning.nearMiss.chainWindowSec - 0.1);
	assert.equal(chain.current, 2);

	chain.update(0.2);
	assert.equal(chain.current, 0, "hết cửa sổ mà không lướt sát thêm thì chuỗi tắt");
});

test("chuỗi: VA CHẠM THẬT làm gãy ngay lập tức", async function () {
	var mods = await loadClientBundle({ NearMiss: "systems/NearMiss.ts", tuningModule: "tuning.ts" });
	var tuning = mods.tuningModule.tuning;
	var chain = new mods.NearMiss.NearMissChainTracker();

	chain.register(5, 0, tuning.nearMiss.points);
	assert.ok(chain.current >= tuning.nearMiss.chainTier1);

	chain.break();
	assert.equal(chain.current, 0);

	// Sau khi gãy, lần lướt sát tiếp theo bắt đầu lại từ 1 — không có hệ số cũ.
	var next = chain.register(1, 0, tuning.nearMiss.points);
	assert.equal(next.chain, 1);
	assert.equal(next.multiplier, 1);
});

test("chuỗi: CỰC SÁT nhân thêm cho ĐÚNG số cái đạt bậc, không cho cả cụm", async function () {
	var mods = await loadClientBundle({ NearMiss: "systems/NearMiss.ts", tuningModule: "tuning.ts" });
	var nearMissTuning = mods.tuningModule.tuning.nearMiss;
	var chain = new mods.NearMiss.NearMissChainTracker();

	// 2 near-miss cùng frame, 1 cái CỰC SÁT: điểm = (1 + 1×2) × points.
	var award = chain.register(2, 1, nearMissTuning.points);
	assert.equal(award.perfect, 1);
	assert.equal(award.points, nearMissTuning.points * (1 + nearMissTuning.perfectMultiplier));

	// `perfect` lớn hơn `count` là dữ liệu vô lý — kẹp lại, không nhân bừa.
	chain.reset();
	var clamped = chain.register(1, 99, nearMissTuning.points);
	assert.equal(clamped.perfect, 1);
});

test("chuỗi: register(0) không tạo gì và không đụng chuỗi", async function () {
	var mods = await loadClientBundle({ NearMiss: "systems/NearMiss.ts", tuningModule: "tuning.ts" });
	var chain = new mods.NearMiss.NearMissChainTracker();

	assert.equal(chain.register(0, 0, 10), null);
	assert.equal(chain.current, 0);
});

test("cao độ tiếng 'sát nút' tăng theo chuỗi rồi kẹp lại", async function () {
	var mods = await loadClientBundle({ NearMiss: "systems/NearMiss.ts", tuningModule: "tuning.ts" });
	var nearMissTuning = mods.tuningModule.tuning.nearMiss;
	var chainPitch = mods.NearMiss.chainPitch;

	assert.equal(chainPitch(1), 1, "lần đầu phải là cao độ nguyên bản");
	assert.ok(chainPitch(4) > chainPitch(2));
	assert.ok(chainPitch(1000) <= nearMissTuning.chainPitchMax);
	// Howler chỉ nhận 0.5–4; vượt ra là câm tiếng.
	assert.ok(nearMissTuning.chainPitchMax <= 4);
});
