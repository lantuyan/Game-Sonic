"use strict";

// P1-1 — BOSS GATE. Canh đúng những điều khoản mà nếu sai thì học sinh gánh hậu quả:
//   · sai ở boss trừ ĐÚNG 1 tim (không 0, không 2) — đây là nơi DUY NHẤT trong ván
//     mà kiến thức ăn vào mạng, sai số ở đây là sai số về công bằng;
//   · boss không được chen vào giữa một trạm Cổng Toán đang mở;
//   · hết câu thì bỏ qua chặng boss, KHÔNG treo máy trạng thái;
//   · chu trình 2 chặng liên tiếp chạy trọn vẹn (DoD).

var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("../test-helpers/clientModule");
var loadClientBundle = helpers.loadClientBundle;

function makeQuestion(overrides) {
	return Object.assign(
		{
			id: "q1",
			difficulty: "hard",
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

/** Bộ callback ghi lại mọi lời gọi để test soi trình tự. */
function makeRecorder(question) {
	var log = [];

	return {
		log: log,
		callbacks: {
			pickQuestion: function () {
				return question;
			},
			onIntro: function () {
				log.push("intro");
			},
			onQuestion: function (_question, durationSec) {
				log.push("question:" + durationSec);
			},
			onResolved: function (_question, outcome) {
				log.push("resolved:" + outcome);
			},
			onStageAdvance: function (victory) {
				log.push("stage:" + (victory === true ? "win" : "lose"));
			},
			onCountdown: function (secondsLeft) {
				log.push("countdown:" + secondsLeft);
			},
			onClosed: function () {
				log.push("closed");
			}
		}
	};
}

/** Chạy máy trạng thái ở 60Hz trong `seconds` giây. */
function run(controller, seconds, canStart) {
	var steps = Math.round(seconds * 60);

	for (var index = 0; index < steps; index += 1) {
		controller.update(1 / 60, index * (1000 / 60), canStart !== false);
	}
}

test("chu trình đầy đủ: intro → hỏi → outro → chuyển chặng → đếm ngược → idle", async function () {
	var mods = await loadClientBundle({ BossGate: "systems/BossGate.ts", tuningModule: "tuning.ts" });
	var boss = mods.tuningModule.tuning.boss;
	var recorder = makeRecorder(makeQuestion());
	var controller = new mods.BossGate.BossGateController(recorder.callbacks);

	controller.start();
	controller.forceNextBossIn(0.5);

	run(controller, 0.6);
	assert.equal(controller.currentPhase, "intro");
	assert.equal(controller.isCinematic, true);

	run(controller, boss.introSec);
	assert.equal(controller.currentPhase, "question");
	assert.equal(controller.isFrozen, true, "modal boss phải đóng băng thế giới");

	controller.answer("A", 1000);
	assert.equal(controller.currentPhase, "outro");
	assert.equal(controller.outcome, "correct");

	run(controller, boss.outroSec + 0.05);
	assert.equal(controller.currentPhase, "countdown");
	assert.equal(controller.stageIndex, 1, "phải sang chặng mới dù thắng hay thua");

	run(controller, boss.countdownSec + 0.05);
	assert.equal(controller.currentPhase, "idle");

	assert.deepEqual(recorder.log.slice(0, 2), ["intro", "question:" + boss.questionMaxSec]);
	assert.ok(recorder.log.includes("stage:win"));
	assert.ok(recorder.log.includes("closed"));
});

test("đếm ngược phát ĐÚNG 3 → 2 → 1, không lặp không nhảy cóc", async function () {
	var mods = await loadClientBundle({ BossGate: "systems/BossGate.ts", tuningModule: "tuning.ts" });
	var boss = mods.tuningModule.tuning.boss;
	var recorder = makeRecorder(makeQuestion());
	var controller = new mods.BossGate.BossGateController(recorder.callbacks);

	controller.start();
	controller.forceNextBossIn(0);
	run(controller, boss.introSec + 0.1);
	controller.answer("A", 0);
	run(controller, boss.outroSec + boss.countdownSec + 0.1);

	var ticks = recorder.log.filter(function (entry) {
		return entry.indexOf("countdown:") === 0;
	});

	assert.deepEqual(ticks, ["countdown:3", "countdown:2", "countdown:1"], "đếm ngược phải là 3 → 2 → 1");
});

test("SAI ở boss trừ ĐÚNG 1 tim — kể cả khi đang bất tử", async function () {
	var mods = await loadClientBundle({ Lives: "systems/Lives.ts", tuningModule: "tuning.ts" });
	var lives = new mods.Lives.Lives();

	lives.reset();
	lives.grantInvincibility(10);

	var before = lives.current;
	var result = lives.takeBossPenalty();

	assert.equal(lives.current, before - 1, "phải trừ đúng 1 tim");
	assert.equal(result, "damaged");

	// Khiên đỡ chướng ngại, KHÔNG đỡ được việc không biết làm bài.
	lives.addShield(1);
	lives.takeBossPenalty();
	assert.equal(lives.current, before - 2);
	assert.equal(lives.shieldCount, 1, "khiên phải còn nguyên sau khi thua boss");
});

test("thua boss ở tim cuối → dead", async function () {
	var mods = await loadClientBundle({ Lives: "systems/Lives.ts", tuningModule: "tuning.ts" });
	var lives = new mods.Lives.Lives();
	lives.reset();

	var startingLives = mods.tuningModule.tuning.scoring.startingLives;
	var last = null;

	for (var index = 0; index < startingLives; index += 1) {
		last = lives.takeBossPenalty();
	}

	assert.equal(last, "dead");
});

test("timeout ở boss cũng trừ tim (không phải chỉ khi chọn sai)", async function () {
	var mods = await loadClientBundle({ BossGate: "systems/BossGate.ts", tuningModule: "tuning.ts" });
	var boss = mods.tuningModule.tuning.boss;
	var recorder = makeRecorder(makeQuestion());
	var controller = new mods.BossGate.BossGateController(recorder.callbacks);

	controller.start();
	controller.forceNextBossIn(0);
	run(controller, boss.introSec + boss.questionMaxSec + boss.outroSec + 0.2);

	assert.ok(recorder.log.includes("resolved:timeout"));
	assert.ok(recorder.log.includes("stage:lose"), "thua vẫn phải sang chặng mới (plan §4.3)");
});

test("boss KHÔNG chen vào khi Cổng Toán đang mở", async function () {
	var mods = await loadClientBundle({ BossGate: "systems/BossGate.ts" });
	var recorder = makeRecorder(makeQuestion());
	var controller = new mods.BossGate.BossGateController(recorder.callbacks);

	controller.start();
	controller.forceNextBossIn(0.2);

	// canStart = false suốt 10 giây: boss phải CHỜ, không được huỷ chặng.
	run(controller, 10, false);
	assert.equal(controller.currentPhase, "idle");
	assert.deepEqual(recorder.log, []);

	// Cổng đóng lại → boss vào ngay frame kế tiếp.
	run(controller, 1 / 60, true);
	assert.equal(controller.currentPhase, "intro");
});

test("hết câu → bỏ qua chặng boss, hẹn lại chứ không treo", async function () {
	var mods = await loadClientBundle({ BossGate: "systems/BossGate.ts", tuningModule: "tuning.ts" });
	var calls = 0;
	var controller = new mods.BossGate.BossGateController({
		pickQuestion: function () {
			calls += 1;
			return null;
		},
		onIntro: function () {},
		onQuestion: function () {},
		onResolved: function () {},
		onStageAdvance: function () {},
		onCountdown: function () {},
		onClosed: function () {}
	});

	controller.start();
	controller.forceNextBossIn(0);
	run(controller, 1);

	assert.equal(controller.currentPhase, "idle");
	assert.equal(calls, 1, "chỉ thử bốc 1 lần rồi hẹn lại — không gọi mỗi frame");
	assert.ok(
		controller.remainingSec >= 0,
		"không được để timer âm dồn rồi bắn boss liên tiếp khi có câu trở lại"
	);
});

test("cờ tắt boss trong tuning làm máy trạng thái im hoàn toàn", async function () {
	var mods = await loadClientBundle({ BossGate: "systems/BossGate.ts", tuningModule: "tuning.ts" });
	var recorder = makeRecorder(makeQuestion());
	var controller = new mods.BossGate.BossGateController(recorder.callbacks);

	controller.start();
	controller.forceNextBossIn(0);

	mods.tuningModule.setTuningValue("boss.enabled", 0);

	try {
		run(controller, 20);
		assert.equal(controller.currentPhase, "idle");
		assert.deepEqual(recorder.log, []);
	} finally {
		mods.tuningModule.setTuningValue("boss.enabled", 1);
	}
});

test("2 chặng boss liên tiếp chạy trọn vẹn (DoD P1-1)", async function () {
	var mods = await loadClientBundle({ BossGate: "systems/BossGate.ts", tuningModule: "tuning.ts" });
	var boss = mods.tuningModule.tuning.boss;
	var recorder = makeRecorder(makeQuestion());
	var controller = new mods.BossGate.BossGateController(recorder.callbacks);

	controller.start();

	for (var stage = 0; stage < 2; stage += 1) {
		controller.forceNextBossIn(0);
		run(controller, boss.introSec + 0.1);
		assert.equal(controller.currentPhase, "question", "chặng " + stage + " phải mở được modal");
		controller.answer("A", 0);
		run(controller, boss.outroSec + boss.countdownSec + 0.2);
		assert.equal(controller.currentPhase, "idle", "chặng " + stage + " phải đóng sạch");
	}

	assert.equal(controller.stageIndex, 2);
	assert.equal(
		recorder.log.filter(function (entry) {
			return entry === "closed";
		}).length,
		2
	);
});

// --- Luật bốc câu -----------------------------------------------------------

test("boss luôn bốc từ bậc `hard` trở lên, kể cả với học sinh yếu", async function () {
	var mods = await loadClientBundle({ bossRules: "systems/bossRules.ts", tuningModule: "tuning.ts" });
	var minIndex = mods.tuningModule.tuning.boss.minDifficultyIndex;

	for (var target = 0; target <= 3; target += 1) {
		for (var roll = 0; roll <= 10; roll += 1) {
			var random = function () {
				return roll / 10;
			};
			var index = mods.bossRules.pickBossDifficultyIndex(target, random);

			assert.ok(index >= minIndex, "target " + target + " roll " + roll + " cho bậc " + index);
			assert.ok(index <= 3, "không được vượt bậc cao nhất");
		}
	}
});

test("bậc bốc nằm trong dải target+0.5..+1 khi target đã đủ cao", async function () {
	var mods = await loadClientBundle({ bossRules: "systems/bossRules.ts" });

	// target = 2 (hard): +0.5 → 2.5 làm tròn 3; +1 → 3. Luôn expert.
	assert.equal(mods.bossRules.pickBossDifficultyIndex(2, function () { return 0; }), 3);
	assert.equal(mods.bossRules.pickBossDifficultyIndex(2, function () { return 0.99; }), 3);
});

test("không có câu đúng bậc → hạ xuống bậc gần nhất, ưu tiên bậc CAO hơn", async function () {
	var mods = await loadClientBundle({ bossRules: "systems/bossRules.ts" });
	var questions = [
		makeQuestion({ id: "e1", difficulty: "easy" }),
		makeQuestion({ id: "m1", difficulty: "medium" })
	];

	var picked = mods.bossRules.pickBossQuestion(questions, 3, function () { return 0; }, new Set());
	assert.equal(picked.id, "m1", "bank chỉ có easy/medium thì boss phải lấy medium");

	// Cách đều: desired = 1.0 với bank có easy(0) và... thêm hard(2).
	var both = [
		makeQuestion({ id: "e2", difficulty: "easy" }),
		makeQuestion({ id: "h2", difficulty: "hard" })
	];
	var tie = mods.bossRules.pickBossQuestion(both, 1, function () { return 0; }, new Set());
	assert.equal(tie.id, "h2", "cách đều thì boss không được chọn bậc dễ hơn");
});

test("boss không hỏi lại câu đã gặp trong ván", async function () {
	var mods = await loadClientBundle({ bossRules: "systems/bossRules.ts" });
	var questions = [
		makeQuestion({ id: "h1", difficulty: "hard" }),
		makeQuestion({ id: "h2", difficulty: "hard" })
	];

	var used = new Set(["h1"]);
	var picked = mods.bossRules.pickBossQuestion(questions, 2, function () { return 0; }, used);
	assert.equal(picked.id, "h2");

	used.add("h2");
	assert.equal(mods.bossRules.pickBossQuestion(questions, 2, function () { return 0; }, used), null);
});

test("thời lượng câu boss bị kẹp — đề 60s không làm đứng ván 1 phút", async function () {
	var mods = await loadClientBundle({ bossRules: "systems/bossRules.ts", tuningModule: "tuning.ts" });
	var boss = mods.tuningModule.tuning.boss;

	assert.equal(mods.bossRules.computeBossQuestionSec(makeQuestion({ time: 60 })), boss.questionMaxSec);
	assert.equal(mods.bossRules.computeBossQuestionSec(makeQuestion({ time: 3 })), boss.questionMinSec);
	assert.equal(mods.bossRules.computeBossQuestionSec(makeQuestion({ time: 18 })), 18);
});

test("bảng DIFFICULTY_ORDER nhân bản khớp questionModel.js (hợp đồng)", async function () {
	var mods = await loadClientBundle({ bossRules: "systems/bossRules.ts" });
	var QuestionModel = require("../shared/questionModel.js");

	assert.deepEqual(
		Array.from(mods.bossRules.DEFAULT_DIFFICULTY_ORDER),
		QuestionModel.DIFFICULTY_ORDER,
		"bản sao trong bossRules.ts lệch với nguồn sự thật shared/questionModel.js"
	);
});
