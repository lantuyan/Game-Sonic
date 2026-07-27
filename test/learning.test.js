"use strict";

// P1-5 — HỌC TẬP NÂNG CAO. DoD: "unit test từng luật". Mỗi luật một khối dưới đây.
//
// Điểm chung của cả 5 luật: chúng quyết định thay học sinh, nên phải giải thích
// được cho giáo viên. Test ở đây vừa là lưới an toàn, vừa là bản đặc tả đọc được.

var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("../test-helpers/clientModule");
var loadClientBundle = helpers.loadClientBundle;

var store = new Map();

globalThis.window = {
	addEventListener: function () {},
	removeEventListener: function () {},
	localStorage: {
		getItem: function (key) {
			return store.has(key) ? store.get(key) : null;
		},
		setItem: function (key, value) {
			store.set(key, String(value));
		},
		removeItem: function (key) {
			store.delete(key);
		}
	}
};

globalThis.document = { cookie: "" };

function loadModules() {
	return loadClientBundle({
		learning: "systems/learningRules.ts",
		Powerup: "systems/Powerup.ts",
		Lives: "systems/Lives.ts",
		Unlocks: "systems/Unlocks.ts",
		SaveData: "core/SaveData.ts",
		tuningModule: "tuning.ts"
	});
}

function makeQuestion(overrides) {
	return Object.assign(
		{
			id: "q1",
			difficulty: "medium",
			question: "2 + 2 = ?",
			answers: { A: "4", B: "5" },
			availableAnswers: ["A", "B"],
			correctAnswer: "A",
			point: 20,
			time: 30
		},
		overrides || {}
	);
}

// --- Luật 1: micro-DDA -------------------------------------------------------

test("micro-DDA: 2 sai liên tiếp HẠ 1 bậc, 3 đúng liên tiếp NÂNG 1 bậc", async function () {
	var mods = await loadModules();
	var dda = new mods.learning.MicroDda();

	assert.equal(dda.shift, 0);

	dda.registerWrong();
	assert.equal(dda.shift, 0, "một câu sai chưa đủ — có thể chỉ là bấm nhầm");

	dda.registerWrong();
	assert.equal(dda.shift, -1, "hai sai liên tiếp thì phải hạ NGAY");

	// Nâng lại cần 3 câu đúng liên tiếp — chắc chắn hơn hạ.
	dda.registerCorrect();
	dda.registerCorrect();
	assert.equal(dda.shift, -1, "hai đúng chưa đủ để nâng");

	dda.registerCorrect();
	assert.equal(dda.shift, 0);
});

test("micro-DDA: chuỗi bị GÃY thì đếm lại từ đầu", async function () {
	var mods = await loadModules();
	var dda = new mods.learning.MicroDda();

	dda.registerWrong();
	dda.registerCorrect();
	dda.registerWrong();

	assert.equal(dda.shift, 0, "sai–đúng–sai không phải 2 sai LIÊN TIẾP");
});

test("micro-DDA: không trôi quá ±1 bậc trong một ván", async function () {
	var mods = await loadModules();
	var dda = new mods.learning.MicroDda();
	var maxShift = mods.tuningModule.tuning.learning.ddaMaxShift;

	for (var index = 0; index < 30; index += 1) {
		dda.registerWrong();
	}

	assert.equal(dda.shift, -maxShift, "một ván xui không được định nghĩa lại trình độ của em");

	for (var up = 0; up < 30; up += 1) {
		dda.registerCorrect();
	}

	assert.equal(dda.shift, maxShift);
});

test("micro-DDA chọn câu lệch bậc TRONG hàng đợi, không dựng lại hàng đợi", async function () {
	var mods = await loadModules();
	var queue = [
		makeQuestion({ id: "easy1", difficulty: "easy" }),
		makeQuestion({ id: "hard1", difficulty: "hard" }),
		makeQuestion({ id: "medium1", difficulty: "medium" })
	];

	// shift = 0 → đúng bằng `queue.pop()` của P0 (hợp đồng §7.3.1).
	assert.equal(mods.learning.pickQueueIndexWithShift(queue, 0), 2);

	// shift = -1 → từ medium(1) muốn easy(0).
	assert.equal(queue[mods.learning.pickQueueIndexWithShift(queue, -1)].id, "easy1");

	// shift = +1 → từ medium(1) muốn hard(2).
	assert.equal(queue[mods.learning.pickQueueIndexWithShift(queue, 1)].id, "hard1");

	assert.equal(mods.learning.pickQueueIndexWithShift([], -1), -1);
});

// --- Luật 2: tần suất cổng theo accuracy -------------------------------------

test("tần suất cổng: làm đúng nhiều → dày (25s), sai nhiều → thưa (40s)", async function () {
	var mods = await loadModules();
	var quiz = mods.tuningModule.tuning.quiz;
	var learning = mods.tuningModule.tuning.learning;

	assert.equal(mods.learning.computeGateIntervalSec(1), quiz.gateIntervalMinSec);
	assert.equal(mods.learning.computeGateIntervalSec(0), learning.gateIntervalCeilingSec);

	var mid = mods.learning.computeGateIntervalSec(0.5);
	assert.ok(mid > quiz.gateIntervalMinSec && mid < learning.gateIntervalCeilingSec);

	// Chưa có dữ liệu → giữa dải, không thiên về bên nào.
	assert.equal(
		mods.learning.computeGateIntervalSec(null),
		(quiz.gateIntervalMinSec + learning.gateIntervalCeilingSec) / 2
	);
});

test("tần suất cổng KHÔNG bao giờ ra ngoài dải 25–40s đã chốt (plan §4.3)", async function () {
	var mods = await loadModules();

	// Kể cả accuracy vô lý (âm, >1, NaN) cũng phải nằm trong dải.
	[-5, -0.1, 0, 0.37, 1, 5, Number.NaN, Number.POSITIVE_INFINITY].forEach(function (accuracy) {
		var value = mods.learning.computeGateIntervalSec(accuracy);
		assert.ok(value >= 25 && value <= 40, "accuracy " + accuracy + " cho ra " + value + "s");
	});
});

// --- Luật 3: định tuyến modal cho em đọc chậm --------------------------------

test("đọc chậm (>12s) + câu medium trở lên → modal; câu easy vẫn ở cổng", async function () {
	var mods = await loadModules();
	var route = mods.learning.shouldRouteToModalForSlowReader;

	assert.equal(route(makeQuestion({ difficulty: "medium" }), 13000), true);
	assert.equal(route(makeQuestion({ difficulty: "hard" }), 20000), true);

	// Câu dễ vẫn để ở cổng — giữ nhịp chạy, và đề dễ thì đọc kịp.
	assert.equal(route(makeQuestion({ difficulty: "easy" }), 20000), false);

	// Đọc nhanh thì không đổi gì.
	assert.equal(route(makeQuestion({ difficulty: "hard" }), 5000), false);

	// Chưa có dữ liệu (ván đầu) → không suy đoán.
	assert.equal(route(makeQuestion({ difficulty: "hard" }), null), false);
});

// --- Luật 4: câu hồi sinh ----------------------------------------------------

test("câu hồi sinh luôn bốc bậc DỄ NHẤT còn lại", async function () {
	var mods = await loadModules();
	var questions = [
		makeQuestion({ id: "h", difficulty: "hard" }),
		makeQuestion({ id: "e", difficulty: "easy" }),
		makeQuestion({ id: "m", difficulty: "medium" })
	];

	var picked = mods.learning.pickRevivalQuestion(questions, function () { return 0; }, new Set());
	assert.equal(picked.id, "e", "vừa mất tim cuối thì phải cho câu dễ, không phải sát hạch thêm");

	// Bank không có easy → lấy bậc thấp nhất CÒN LẠI thay vì trả null.
	var noEasy = [makeQuestion({ id: "m2", difficulty: "medium" }), makeQuestion({ id: "h2", difficulty: "hard" })];
	assert.equal(mods.learning.pickRevivalQuestion(noEasy, function () { return 0; }, new Set()).id, "m2");

	assert.equal(mods.learning.pickRevivalQuestion([], function () { return 0; }, new Set()), null);
});

test("hồi sinh: lần 1 trong ngày MIỄN PHÍ, lần 2 tốn 100 xu", async function () {
	var mods = await loadModules();
	var cost = mods.tuningModule.tuning.learning.revivalCoinCost;

	assert.deepEqual(mods.learning.offerRevival(0, 0), { kind: "free" });
	assert.deepEqual(mods.learning.offerRevival(1, cost), { kind: "paid", coins: cost });

	// Lần 2 mà không đủ xu → không có hồi sinh, ván kết thúc.
	assert.deepEqual(mods.learning.offerRevival(1, cost - 1), {
		kind: "unavailable",
		reason: "not-enough-coins"
	});

	assert.equal(cost, 100, "plan §4.6 chốt 100 xu");
});

test("hồi sinh: đếm theo NGÀY, sang ngày mới về 0", async function () {
	var mods = await loadModules();
	store.clear();
	mods.SaveData.saveWallet(Object.assign({}, mods.SaveData.DEFAULT_WALLET, { coins: 500 }));

	var unlocks = new mods.Unlocks.Unlocks();
	var day1 = new Date(2026, 6, 27, 10, 0, 0);
	var day2 = new Date(2026, 6, 28, 10, 0, 0);

	assert.equal(unlocks.revivalUsedToday(day1), 0);

	assert.equal(unlocks.consumeRevival(0, day1), true);
	assert.equal(unlocks.revivalUsedToday(day1), 1);

	assert.equal(unlocks.consumeRevival(100, day1), true);
	assert.equal(unlocks.revivalUsedToday(day1), 2);
	assert.equal(mods.SaveData.loadWallet().coins, 400, "lần 2 phải trừ đúng 100 xu");

	// Sang ngày mới: đếm lại từ 0 mà không cần tác vụ dọn dẹp nào.
	assert.equal(unlocks.revivalUsedToday(day2), 0);
});

test("hồi sinh: không đủ xu thì KHÔNG ghi nhận và KHÔNG trừ gì", async function () {
	var mods = await loadModules();
	store.clear();
	mods.SaveData.saveWallet(Object.assign({}, mods.SaveData.DEFAULT_WALLET, { coins: 50 }));

	var unlocks = new mods.Unlocks.Unlocks();
	var day = new Date(2026, 6, 27, 10, 0, 0);

	assert.equal(unlocks.consumeRevival(100, day), false);
	assert.equal(unlocks.revivalUsedToday(day), 0);
	assert.equal(mods.SaveData.loadWallet().coins, 50);
});

test("hồi sinh cho lại ĐÚNG 1 tim, không phải đầy máu", async function () {
	var mods = await loadModules();
	var lives = new mods.Lives.Lives();
	var startingLives = mods.tuningModule.tuning.scoring.startingLives;

	lives.reset();

	for (var index = 0; index < startingLives; index += 1) {
		lives.takeHit();
		lives.update(999);
	}

	assert.equal(lives.current, 0);

	lives.revive();
	assert.equal(lives.current, 1, "hồi sinh là cơ hội chơi tiếp, không phải nhân đôi ván");
});

// --- Luật 5: thưởng khiên + power-up Tăng tốc --------------------------------

test("đúng câu hard/expert được tặng Khiên; câu dễ thì không", async function () {
	var mods = await loadModules();

	assert.equal(mods.learning.earnsShield(makeQuestion({ difficulty: "hard" }), true), true);
	assert.equal(mods.learning.earnsShield(makeQuestion({ difficulty: "expert" }), true), true);
	assert.equal(mods.learning.earnsShield(makeQuestion({ difficulty: "medium" }), true), false);
	assert.equal(mods.learning.earnsShield(makeQuestion({ difficulty: "easy" }), true), false);

	// SAI câu khó thì tất nhiên không có gì.
	assert.equal(mods.learning.earnsShield(makeQuestion({ difficulty: "expert" }), false), false);
});

test("power-up Tăng tốc: có thời hạn, hết thì trả tốc độ về 1", async function () {
	var mods = await loadModules();
	var powerups = new mods.Powerup.Powerups();
	var learning = mods.tuningModule.tuning.learning;

	powerups.reset();
	assert.equal(powerups.speedMultiplier, 1);

	powerups.collect("speedBoost");
	assert.equal(powerups.speedMultiplier, learning.speedBoostFactor);

	powerups.update(learning.speedBoostSec - 0.1);
	assert.equal(powerups.speedMultiplier, learning.speedBoostFactor, "chưa hết giờ thì còn hiệu lực");

	powerups.update(0.2);
	assert.equal(powerups.speedMultiplier, 1, "hết giờ phải trả về bình thường");
});

test("nhặt lại Tăng tốc thì LÀM MỚI đồng hồ, không cộng dồn", async function () {
	var mods = await loadModules();
	var powerups = new mods.Powerup.Powerups();
	var learning = mods.tuningModule.tuning.learning;

	powerups.reset();
	powerups.collect("speedBoost");
	powerups.update(learning.speedBoostSec - 1);
	powerups.collect("speedBoost");

	assert.ok(
		Math.abs(powerups.remaining("speedBoost") - learning.speedBoostSec) < 1e-9,
		"đồng hồ phải về đủ thời lượng, không phải cộng thêm"
	);
});

// --- Số liệu bổ sung cho hồ sơ kỹ năng ---------------------------------------

test("gateAnswerMs + modeStats: tách riêng cổng và modal", async function () {
	var mods = await loadModules();
	var recorder = new mods.learning.LearningStatsRecorder();

	recorder.reset();
	recorder.record("gate", true, 4000);
	recorder.record("gate", false, 6000);
	recorder.record("modal", true, 20000);

	var snapshot = recorder.snapshot();

	assert.equal(snapshot.gateAnswerMs, 5000, "trung bình CHỈ tính ở cổng — đọc trên cổng khác đọc modal");
	assert.deepEqual(snapshot.modeStats.gate, { correct: 1, total: 2 });
	assert.deepEqual(snapshot.modeStats.modal, { correct: 1, total: 1 });

	// Accuracy dùng ngay trong ván cho luật tần suất cổng.
	assert.ok(Math.abs(recorder.accuracy - 2 / 3) < 1e-9);
});

test("chưa trả lời câu nào → accuracy null, không phải 0", async function () {
	var mods = await loadModules();
	var recorder = new mods.learning.LearningStatsRecorder();

	recorder.reset();
	assert.equal(recorder.accuracy, null, "0 nghĩa là 'sai hết', null nghĩa là 'chưa biết' — khác nhau");
	assert.equal(recorder.snapshot().gateAnswerMs, null);
});

test("số liệu P1-5 đi trong JSONB difficulty_weights, không cần migration (DoD)", function () {
	var fs = require("fs");
	var path = require("path");
	var rootDir = path.resolve(__dirname, "..");
	var playerStore = fs.readFileSync(path.join(rootDir, "server", "playerStore.js"), "utf8");
	var schema = fs.readFileSync(path.join(rootDir, "server", "schema.js"), "utf8");

	assert.ok(/data\.learning/.test(playerStore), "server phải nhận khoá `learning`");
	assert.ok(/\{ learning: data\.learning \}/.test(playerStore), "phải nhét vào difficulty_weights");
	// Không được thêm cột mới cho việc này.
	assert.equal(
		/ADD COLUMN IF NOT EXISTS (gate_answer_ms|mode_stats)/.test(schema),
		false,
		"P1-5 KHÔNG được thêm cột — cả điểm của việc dùng JSONB là ở đó"
	);
});
