"use strict";

// P0-7 — nhiệm vụ đinh của V2. Kiểm bằng số các luật dễ sai nhất:
//   * luật số cổng min(N,3) với N=2/3/4, đáp án đúng LUÔN có mặt;
//   * bank lớp 6/7 thật (2 đáp án) → 2 cổng + 1 làn TRỐNG;
//   * router theo độ dài đề và theo quizMode của lớp;
//   * công thức thời lượng trạm;
//   * cổng mềm đúng 1 lần mỗi ván;
//   * chu trình telegraph → station → feedback và ghi nhận kết quả.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");
var helpers = require("../test-helpers/clientModule");
var loadClientModule = helpers.loadClientModule;
var loadClientBundle = helpers.loadClientBundle;

function makeQuestion(overrides) {
	var base = {
		id: "q1",
		difficulty: "easy",
		question: "2 + 3 = ?",
		answers: { A: "5", B: "6" },
		availableAnswers: ["A", "B"],
		correctAnswer: "A",
		point: 10,
		time: 20
	};

	return Object.assign({}, base, overrides || {});
}

/** PRNG giả tất định để bố cục cổng lặp lại được trong test. */
function fixedRandom(values) {
	var index = 0;

	return function next() {
		var value = values[index % values.length];
		index += 1;
		return value;
	};
}

test("luật số cổng: min(số đáp án, 3), đáp án đúng LUÔN có mặt", async function () {
	var rules = await loadClientModule("systems/quizRules.ts");
	var random = fixedRandom([0.1, 0.5, 0.9, 0.3, 0.7]);

	// N = 2 (bank lớp 6/7 hiện tại).
	var two = rules.buildGateLayout(makeQuestion(), random);
	var twoFilled = two.lanes.filter(function (lane) {
		return lane !== null;
	});
	assert.equal(twoFilled.length, 2, "2 đáp án → đúng 2 cổng");
	assert.ok(twoFilled.indexOf("A") !== -1, "đáp án đúng phải có mặt");
	assert.equal(two.lanes.length, 3, "vẫn phải mô tả đủ 3 làn");
	assert.equal(
		two.lanes.filter(function (lane) {
			return lane === null;
		}).length,
		1,
		"làn còn lại phải TRỐNG, không được bịa đáp án nhiễu"
	);
	assert.equal(two.lanes[two.correctLane], "A");

	// N = 3.
	var three = rules.buildGateLayout(
		makeQuestion({
			answers: { A: "5", B: "6", C: "7" },
			availableAnswers: ["A", "B", "C"]
		}),
		random
	);
	assert.equal(
		three.lanes.filter(function (lane) {
			return lane !== null;
		}).length,
		3
	);
	assert.equal(three.lanes[three.correctLane], "A");

	// N = 4 → vẫn chỉ 3 cổng (chỉ có 3 làn).
	var four = rules.buildGateLayout(
		makeQuestion({
			answers: { A: "5", B: "6", C: "7", D: "8" },
			availableAnswers: ["A", "B", "C", "D"]
		}),
		random
	);
	assert.equal(
		four.lanes.filter(function (lane) {
			return lane !== null;
		}).length,
		3,
		"tối đa 3 cổng vì chỉ có 3 làn"
	);
	assert.equal(four.lanes[four.correctLane], "A", "đáp án đúng không bao giờ bị loại");
});

test("đáp án đúng xuất hiện ở nhiều vị trí khác nhau (không đoán được)", async function () {
	var rules = await loadClientModule("systems/quizRules.ts");
	var randomModule = await loadClientModule("core/random.ts");
	var random = randomModule.createSeededRandom(4242);
	var lanesSeen = new Set();

	for (var index = 0; index < 200; index += 1) {
		var layout = rules.buildGateLayout(
			makeQuestion({
				answers: { A: "5", B: "6", C: "7" },
				availableAnswers: ["A", "B", "C"]
			}),
			random
		);
		assert.equal(layout.lanes[layout.correctLane], "A");
		lanesSeen.add(layout.correctLane);
	}

	assert.equal(lanesSeen.size, 3, "đáp án đúng phải rơi vào cả 3 làn qua nhiều lần dựng");
});

test("bank THẬT của lớp 6 đúng là 100% câu 2 đáp án (căn cứ của luật 2 cổng)", function () {
	var questions = JSON.parse(
		fs.readFileSync(path.resolve(__dirname, "..", "questions", "lop6.json"), "utf8")
	);

	var withThreeOrMore = questions.filter(function (question) {
		return ["A", "B", "C", "D"].filter(function (key) {
			return typeof question.answers[key] === "string" && question.answers[key].trim() !== "";
		}).length > 2;
	});

	assert.equal(
		withThreeOrMore.length,
		0,
		"nếu bank có câu >2 đáp án thì luật 2-cổng cần xem lại (đang có " + withThreeOrMore.length + ")"
	);
});

test("router: đề dài >120 ký tự thì đi modal, đề ngắn đi cổng", async function () {
	var mods = await loadClientBundle({ rules: "systems/quizRules.ts", tuningModule: "tuning.ts" });
	var threshold = mods.tuningModule.tuning.quiz.modalLengthThreshold;

	var shortQuestion = makeQuestion({ question: "2 + 3 = ?" });
	assert.equal(mods.rules.routeQuestion(shortQuestion, "gate"), "gate");

	var longQuestion = makeQuestion({ question: "x".repeat(threshold + 1) });
	assert.equal(mods.rules.routeQuestion(longQuestion, "gate"), "modal", "đề dài phải sang modal");

	// Đúng ngưỡng thì vẫn là cổng (chỉ ">" mới sang modal).
	assert.equal(mods.rules.routeQuestion(makeQuestion({ question: "x".repeat(threshold) }), "gate"), "gate");

	// quizMode của lớp thắng tất cả.
	assert.equal(mods.rules.routeQuestion(shortQuestion, "modal"), "modal");
});

test("thời lượng trạm: clamp(4 + đềDài/12, 6, 14) × hệ số avgAnswerMs", async function () {
	var mods = await loadClientBundle({ rules: "systems/quizRules.ts", tuningModule: "tuning.ts" });
	var quiz = mods.tuningModule.tuning.quiz;

	// Đề ngắn → chạm sàn 6s. Chưa có dữ liệu avgAnswerMs → hệ số 1.0.
	var shortQuestion = makeQuestion({ question: "1+1?" });
	assert.equal(mods.rules.computeStationDurationSec(shortQuestion, null), quiz.stationMinSec);

	// Đề dài → chạm trần 14s.
	var longQuestion = makeQuestion({ question: "x".repeat(400) });
	assert.equal(mods.rules.computeStationDurationSec(longQuestion, null), quiz.stationMaxSec);

	// Đề vừa: 4 + 60/12 = 9s.
	var mediumQuestion = makeQuestion({ question: "x".repeat(60) });
	assert.ok(Math.abs(mods.rules.computeStationDurationSec(mediumQuestion, null) - 9) < 1e-9);

	// Học sinh trả lời chậm (16s) → hệ số bị kẹp ở trần 1.3.
	assert.ok(
		Math.abs(mods.rules.computeStationDurationSec(mediumQuestion, 16000) - 9 * quiz.answerTimeFactorMax) < 1e-9
	);

	// Học sinh trả lời rất nhanh (2s) → hệ số kẹp ở sàn 0.8, KHÔNG rút xuống 0.25.
	assert.ok(
		Math.abs(mods.rules.computeStationDurationSec(mediumQuestion, 2000) - 9 * quiz.answerTimeFactorMin) < 1e-9
	);

	// Dữ liệu hỏng không được làm sập.
	assert.equal(mods.rules.computeStationDurationSec(mediumQuestion, NaN), 9);
});

test("cổng mềm: cứu ĐÚNG 1 lần mỗi ván, từ lần 2 tính timeout", async function () {
	var rules = await loadClientModule("systems/quizRules.ts");
	var tracker = new rules.SoftGateTracker();

	assert.equal(tracker.onStationExpired(), "rescue", "lần 1 phải được cứu");
	assert.equal(tracker.hasUsedRescue, true);
	assert.equal(tracker.onStationExpired(), "timeout", "lần 2 phải tính timeout");
	assert.equal(tracker.onStationExpired(), "timeout");

	tracker.reset();
	assert.equal(tracker.onStationExpired(), "rescue", "ván mới được cứu lại");
});

test("chu trình cổng: telegraph → station → feedback → idle", async function () {
	var mods = await loadClientBundle({
		QuizGate: "systems/QuizGate.ts",
		rules: "systems/quizRules.ts",
		tuningModule: "tuning.ts"
	});
	var quizTuning = mods.tuningModule.tuning.quiz;

	var events = [];
	var controller = new mods.QuizGate.QuizGateController({
		onTelegraph: function () { events.push("telegraph"); },
		onStationOpen: function () { events.push("station"); },
		onModalOpen: function () { events.push("modal"); },
		onResolved: function (question, outcome) { events.push("resolved:" + outcome); },
		onClosed: function () { events.push("closed"); },
		onQueueEmpty: function () { events.push("empty"); }
	});

	var buildLayout = function (question) {
		return mods.rules.buildGateLayout(question, fixedRandom([0.1, 0.5, 0.9]));
	};

	controller.start([makeQuestion()], { avgAnswerMs: null, levelQuizMode: "gate" });
	controller.forceNextGateIn(0.1);

	function step(seconds) {
		var steps = Math.round(seconds / (1 / 60));

		for (var index = 0; index < steps; index += 1) {
			controller.update(1 / 60, index * 16, buildLayout);
		}
	}

	step(0.2);
	assert.equal(controller.currentPhase, "telegraph");
	assert.equal(controller.isSlowMotion, false, "telegraph CHƯA slow-mo");

	step(quizTuning.telegraphSec + 0.1);
	assert.equal(controller.currentPhase, "station");
	assert.equal(controller.isSlowMotion, true, "vào trạm mới bật slow-mo");

	controller.answer("A", 1000);
	assert.equal(controller.currentPhase, "feedback");
	assert.equal(controller.isSlowMotion, false, "hết trạm phải tắt slow-mo");

	step(quizTuning.feedbackSec + 0.1);
	assert.equal(controller.currentPhase, "idle");

	assert.deepEqual(events, ["telegraph", "station", "resolved:correct", "closed"]);
});

test("hết giờ trạm lần 1 → modal cứu; lần 2 → timeout", async function () {
	var mods = await loadClientBundle({
		QuizGate: "systems/QuizGate.ts",
		rules: "systems/quizRules.ts",
		tuningModule: "tuning.ts"
	});
	var quizTuning = mods.tuningModule.tuning.quiz;

	var modalCalls = [];
	var outcomes = [];
	var controller = new mods.QuizGate.QuizGateController({
		onTelegraph: function () {},
		onStationOpen: function () {},
		onModalOpen: function (question, duration, isRescue) { modalCalls.push({ duration: duration, isRescue: isRescue }); },
		onResolved: function (question, outcome) { outcomes.push(outcome); },
		onClosed: function () {},
		onQueueEmpty: function () {}
	});

	var buildLayout = function (question) {
		return mods.rules.buildGateLayout(question, fixedRandom([0.1, 0.5, 0.9]));
	};

	controller.start([makeQuestion({ id: "q2" }), makeQuestion({ id: "q1" })], {
		avgAnswerMs: null,
		levelQuizMode: "gate"
	});

	function runOneStation() {
		controller.forceNextGateIn(0.05);
		var elapsed = 0;

		// Chạy đủ dài để qua telegraph + trạm + (modal) + feedback.
		while (elapsed < 60) {
			controller.update(1 / 60, elapsed * 1000, buildLayout);
			elapsed += 1 / 60;

			if (controller.currentPhase === "idle" && elapsed > 1) {
				return;
			}
		}
	}

	runOneStation();
	assert.equal(modalCalls.length, 1, "lần 1 hết giờ phải mở modal cứu");
	assert.equal(modalCalls[0].isRescue, true);
	assert.equal(modalCalls[0].duration, quizTuning.softGateModalSec);
	assert.deepEqual(outcomes, ["timeout"], "modal cứu hết giờ thì mới tính timeout");

	runOneStation();
	assert.equal(modalCalls.length, 1, "lần 2 KHÔNG được cứu nữa");
	assert.deepEqual(outcomes, ["timeout", "timeout"]);
});

test("đề dài đi thẳng modal, bỏ qua telegraph và trạm", async function () {
	var mods = await loadClientBundle({
		QuizGate: "systems/QuizGate.ts",
		rules: "systems/quizRules.ts",
		tuningModule: "tuning.ts"
	});

	var events = [];
	var controller = new mods.QuizGate.QuizGateController({
		onTelegraph: function () { events.push("telegraph"); },
		onStationOpen: function () { events.push("station"); },
		onModalOpen: function () { events.push("modal"); },
		onResolved: function () { events.push("resolved"); },
		onClosed: function () { events.push("closed"); },
		onQueueEmpty: function () {}
	});

	var longQuestion = makeQuestion({
		question: "x".repeat(mods.tuningModule.tuning.quiz.modalLengthThreshold + 5)
	});

	controller.start([longQuestion], { avgAnswerMs: null, levelQuizMode: "gate" });
	controller.forceNextGateIn(0.05);

	// 0.05s ở nhịp 1/60 cần 3 frame mới tới hạn; chạy dư vài frame cho chắc.
	for (var index = 0; index < 6; index += 1) {
		controller.update(1 / 60, index * 16, function (question) {
			return mods.rules.buildGateLayout(question, fixedRandom([0.1]));
		});
	}

	assert.equal(controller.currentPhase, "modal");
	assert.deepEqual(events, ["modal"], "đề dài KHÔNG được dựng cổng");
});

test("hết câu hỏi → báo một lần rồi chuyển chạy thuần", async function () {
	var mods = await loadClientBundle({ QuizGate: "systems/QuizGate.ts", rules: "systems/quizRules.ts" });
	var emptyCalls = 0;

	var controller = new mods.QuizGate.QuizGateController({
		onTelegraph: function () {},
		onStationOpen: function () {},
		onModalOpen: function () {},
		onResolved: function () {},
		onClosed: function () {},
		onQueueEmpty: function () { emptyCalls += 1; }
	});

	controller.start([], { avgAnswerMs: null, levelQuizMode: "gate" });
	controller.forceNextGateIn(0.05);

	for (var index = 0; index < 600; index += 1) {
		controller.update(1 / 60, index * 16, function (question) {
			return mods.rules.buildGateLayout(question, fixedRandom([0.1]));
		});
	}

	assert.equal(emptyCalls, 1, "chỉ được báo hết câu ĐÚNG MỘT LẦN, không spam mỗi frame");
	assert.equal(controller.currentPhase, "idle");
});

test("session stats đúng dạng updateSkillProfileAfterGame + submitScore của V1", async function () {
	var rules = await loadClientModule("systems/quizRules.ts");
	var recorder = new rules.SessionStatsRecorder();

	recorder.start(1000);
	recorder.record({ questionId: "q1", status: "correct", mode: "gate", answeredMs: 3000, selectedAnswer: "A" });
	recorder.record({ questionId: "q2", status: "wrong", mode: "gate", answeredMs: 5000, selectedAnswer: "B" });
	recorder.record({ questionId: "q3", status: "timeout", mode: "modal", answeredMs: 0, selectedAnswer: null });

	assert.equal(recorder.correct, 1);
	assert.equal(recorder.wrong, 1);
	assert.equal(recorder.timeout, 1);

	var session = recorder.toSessionStats(61000);
	assert.deepEqual(session, { correct: 1, wrong: 1, timeout: 1, durationMs: 60000 });

	var scoreStats = recorder.toScoreStats(1234, 61000);
	assert.deepEqual(scoreStats, {
		score: 1234,
		correctCount: 1,
		wrongCount: 1,
		timeoutCount: 1,
		durationMs: 60000
	});

	// `mode` được ghi lại để P1 tách thống kê gate vs modal.
	assert.equal(recorder.list[2].mode, "modal");
});
