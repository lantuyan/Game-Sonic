"use strict";

// P0-13 — CÂN BẰNG: đo bằng mô phỏng tất định thay vì "chơi thử thấy ổn".
//
// Mục tiêu plan §8 / task P0-13: ván dài 3–6 phút, 8–14 câu/ván.
// Mô phỏng nhịp trạm câu hỏi theo đúng hằng số trong tuning.ts và đối chiếu.
//
// P2-8 bổ sung phần QUAN TRỌNG NHẤT của file này: mô phỏng ĐẦY ĐỦ một ván điển hình
// (quãng đường + câu hỏi + near-miss + boss) và khoá lại **tỉ lệ điểm câu hỏi 80–90%**
// mà plan §4.4 đặt ra. Khoá tỉ lệ chứ không khoá từng hằng số rời: hằng số nào cũng
// có thể đổi miễn là tỉ lệ còn đúng, còn tỉ lệ sai thì bảng xếp hạng thôi không đo
// năng lực Toán nữa — và đó mới là điều không được phép xảy ra lặng lẽ.

var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("../test-helpers/clientModule");
var loadClientBundle = helpers.loadClientBundle;
var scoreCheck = require("../server/scoreCheck");
var lop6Bank = require("../questions/lop6.json");

/**
 * Nhịp một vòng Cổng Toán:
 *   chờ (25–40s) → telegraph (3.5s) → trạm (6–14s) → feedback (2.5s)
 * Trả về số câu hỏi gặp trong `runSeconds` giây.
 */
function simulateQuestionsPerRun(quizTuning, runSeconds, averageQuestionLength) {
	var waitSec = (quizTuning.gateIntervalMinSec + quizTuning.gateIntervalMaxSec) / 2;
	var stationSec = Math.min(
		Math.max(quizTuning.stationBaseSec + averageQuestionLength / quizTuning.stationLengthDivisor, quizTuning.stationMinSec),
		quizTuning.stationMaxSec
	);
	var cycleSec = waitSec + quizTuning.telegraphSec + stationSec + quizTuning.feedbackSec;

	return { questions: Math.floor(runSeconds / cycleSec), cycleSec: cycleSec, stationSec: stationSec };
}

test("nhịp trạm: ván 6 phút cho ít nhất 8 câu (cận dưới mục tiêu 8–14)", async function () {
	var mods = await loadClientBundle({ tuningModule: "tuning.ts" });
	var quizTuning = mods.tuningModule.tuning.quiz;

	// Bank thật của lớp 6 có đề ngắn (~30–40 ký tự) → trạm chạm sàn 6s.
	var result = simulateQuestionsPerRun(quizTuning, 6 * 60, 35);

	assert.ok(
		result.questions >= 8,
		"ván 6 phút chỉ được " + result.questions + " câu (cần ≥8). Chu kỳ hiện tại " + result.cycleSec.toFixed(1) + "s"
	);
});

test("nhịp trạm: ván 3 phút vẫn phải có câu hỏi để ván ngắn không vô nghĩa", async function () {
	var mods = await loadClientBundle({ tuningModule: "tuning.ts" });
	var result = simulateQuestionsPerRun(mods.tuningModule.tuning.quiz, 3 * 60, 35);

	assert.ok(result.questions >= 3, "ván 3 phút phải có ≥3 câu, đang là " + result.questions);
});

test("trần 14 câu/ván là KHÔNG đạt được với dải 25–40s — ghi nhận rõ, không giả vờ", async function () {
	var mods = await loadClientBundle({ tuningModule: "tuning.ts" });
	var quizTuning = mods.tuningModule.tuning.quiz;
	var result = simulateQuestionsPerRun(quizTuning, 6 * 60, 35);

	// Đây là mâu thuẫn NỘI TẠI của plan, không phải lỗi cài đặt:
	//   §4.3 chốt "mỗi 25–40s" một trạm; §8 lại đặt mục tiêu 8–14 câu/ván 3–6 phút.
	//   Chu kỳ tối thiểu = 25 + 3.5 (telegraph) + 6 (trạm) + 2.5 (feedback) = 37s
	//   ⇒ 6 phút = tối đa 9 câu. Muốn 14 câu phải hạ khoảng cách trạm xuống ~12s,
	//   tức phá quyết định đã chốt ở §4.3.
	// Test này khoá lại sự thật đó để không ai "sửa số cho đẹp" mà không bàn lại thiết kế.
	var theoreticalMax = Math.floor(
		(6 * 60) / (quizTuning.gateIntervalMinSec + quizTuning.telegraphSec + quizTuning.stationMinSec + quizTuning.feedbackSec)
	);

	assert.ok(
		theoreticalMax < 14,
		"nếu bây giờ đạt được 14 câu thì dải 25–40s đã bị đổi — phải cập nhật lại plan §4.3 và ghi chú này"
	);
	assert.ok(result.questions >= 8, "vẫn phải giữ được cận dưới 8 câu");
});

test("tốc độ sau 6 phút vẫn trong tầm kiểm soát của học sinh", async function () {
	var mods = await loadClientBundle({ Speed: "systems/Speed.ts", tuningModule: "tuning.ts" });
	var controller = new mods.Speed.SpeedController();

	// Trường hợp xấu nhất: admin đặt tốc độ tối đa và học sinh giỏi (adaptive cao).
	controller.start({ gameSpeed: 2, adaptiveFactor: 1.35 });

	for (var index = 0; index < 60 * 360; index += 1) {
		controller.update(1 / 60);
	}

	assert.ok(
		controller.current <= mods.tuningModule.tuning.speed.baseMax,
		"tốc độ không bao giờ được vượt 2.0 dù ramp bao lâu, đang là " + controller.current
	);

	// Và tốc độ mặc định vẫn phải dễ chịu sau 6 phút.
	var normal = new mods.Speed.SpeedController();
	normal.start({ gameSpeed: 1, adaptiveFactor: 1 });

	for (var step = 0; step < 60 * 360; step += 1) {
		normal.update(1 / 60);
	}

	assert.ok(
		normal.current <= 1.4 + 1e-9,
		"tốc độ mặc định sau 6 phút phải dừng ở trần nền×1.4, đang là " + normal.current
	);
});

test("mật độ chướng ngại: khoảng nghỉ giữa các pattern đủ thở", async function () {
	var mods = await loadClientBundle({ tuningModule: "tuning.ts" });
	var spawnTuning = mods.tuningModule.tuning.spawn;
	var speedTuning = mods.tuningModule.tuning.speed;

	// Ở tốc độ mặc định, khoảng cách giữa 2 pattern quy ra giây.
	var unitsPerSec = speedTuning.unitsPerSecondAtOne;
	var minGapSec = spawnTuning.patternGapMin / unitsPerSec;
	var maxGapSec = spawnTuning.patternGapMax / unitsPerSec;

	assert.ok(minGapSec >= 1.5, "khoảng nghỉ tối thiểu " + minGapSec.toFixed(2) + "s là quá ngắn để thở");
	assert.ok(maxGapSec <= 4, "khoảng nghỉ tối đa " + maxGapSec.toFixed(2) + "s là quá dài, ván sẽ nhạt");

	// Thung lũng nghỉ sau cụm khó phải dài hơn hẳn khoảng nghỉ thường.
	assert.ok(
		spawnTuning.reliefValleyMinSec > maxGapSec,
		"thung lũng nghỉ phải dài hơn khoảng nghỉ thường mới có tác dụng"
	);
});

// ============================================================================
// P2-8 · VÁN ĐIỂN HÌNH — mô hình tất định, mọi giả định ghi rõ ở đây
// ============================================================================
//
// Trước P2-8 chỗ này chỉ khoá `answerShare > 0.1` với ghi chú "để P1 cân lại", và
// nó ĐO SAI: nó truyền `question.point = 100`, một giá trị không có trong ngân hàng
// nào (đề thật là 10/15/20/25). Tỉ lệ thật khi đó là ~1,6% chứ không phải 18%.
//
// Mô hình dưới đây bám hình dạng gameplay HIỆN TẠI, không phải hình dạng thời P0:
//   · boss (P1-1) đóng băng thế giới ⇒ ván 6 phút chạy ít hơn 6 phút;
//   · boss cũng là một CÂU HỎI (đi qua `Score.recordAnswer` như cổng thường);
//   · near-miss (P1-1 + P2-2) cộng thẳng vào `bonusScore`;
//   · số câu là số THỰC TẾ đạt được từ nhịp trạm, không phải con số 14 trên giấy
//     (xem mâu thuẫn §4.3 ↔ §8 ở test phía trên — vẫn chưa được quyết).

/** Thang điểm mặc định theo độ khó. Test bên dưới đối chiếu với ngân hàng thật. */
var POINT_BY_DIFFICULTY = { easy: 10, medium: 15, hard: 20, expert: 25 };

/**
 * Ván điển hình = học sinh khá sống hết 6 phút.
 *
 * `answers` là chuỗi câu THEO THỨ TỰ GẶP: 7 câu ở cổng + 1 câu boss ở cuối. Hai câu
 * sai đặt ở đầu ván (câu 2 và 4) — lúc chưa vào nhịp — rồi giữ chuỗi về sau; đó là
 * hình dạng phổ biến nhất và cũng là hình dạng có streak, tức KHÔNG phải hình dạng
 * dễ dãi nhất cho tỉ lệ ta muốn chứng minh.
 */
var TYPICAL_RUN = {
	runSeconds: 360,
	bossCount: 1,
	answers: [
		{ difficulty: "easy", correct: true },
		{ difficulty: "medium", correct: false },
		{ difficulty: "easy", correct: true },
		{ difficulty: "medium", correct: false },
		{ difficulty: "medium", correct: true },
		{ difficulty: "easy", correct: true },
		{ difficulty: "hard", correct: true },
		{ difficulty: "hard", correct: true, boss: true }
	],
	/**
	 * Số lần lướt sát. 18 ≈ một lần mỗi 20 giây — người chơi có để ý tới near-miss
	 * nhưng không đi săn nó. Kịch bản "đi săn" được kiểm riêng ở test sau.
	 */
	nearMissCount: 18
};

/** Thời gian thế giới ĐỨNG YÊN cho mỗi chặng boss (cắt cảnh + đề + kết + đếm ngược). */
function bossFreezeSeconds(bossTuning) {
	return (
		bossTuning.introSec +
		(bossTuning.questionMinSec + bossTuning.questionMaxSec) / 2 +
		bossTuning.outroSec +
		bossTuning.countdownSec
	);
}

/**
 * Quãng đường (mét) của một ván, dùng CHÍNH `SpeedController` của game nên ramp,
 * trần tốc độ và mọi thay đổi tương lai đều tự phản ánh vào đây.
 */
function simulateDistance(mods, runSeconds, bossCount) {
	var speedTuning = mods.tuningModule.tuning.speed;
	var freezeSec = bossFreezeSeconds(mods.tuningModule.tuning.boss);
	var bossIntervalSec =
		(mods.tuningModule.tuning.boss.intervalMinSec + mods.tuningModule.tuning.boss.intervalMaxSec) / 2;

	var controller = new mods.Speed.SpeedController();
	controller.start({ gameSpeed: 1, adaptiveFactor: 1 });

	var stepSec = 1 / 60;
	var distanceM = 0;
	var runningSec = 0;

	for (var elapsed = 0; elapsed < runSeconds; elapsed += stepSec) {
		var frozen = false;

		for (var stage = 1; stage <= bossCount; stage += 1) {
			var startsAt = stage * bossIntervalSec + (stage - 1) * freezeSec;

			if (elapsed >= startsAt && elapsed < startsAt + freezeSec) {
				frozen = true;
			}
		}

		controller.update(stepSec);

		if (frozen === false) {
			distanceM += controller.current * speedTuning.unitsPerSecondAtOne * stepSec;
			runningSec += stepSec;
		}
	}

	return { distanceM: distanceM, runningSec: runningSec, freezeSec: freezeSec };
}

/** Chạy trọn một ván qua `Score` + `Combo` thật và trả về snapshot điểm. */
function simulateRun(mods, plan) {
	var run = simulateDistance(mods, plan.runSeconds, plan.bossCount);
	var score = new mods.Score.Score();
	var combo = new mods.Combo.Combo();

	score.setDistance(run.distanceM);

	for (var index = 0; index < plan.answers.length; index += 1) {
		var answer = plan.answers[index];
		var point = POINT_BY_DIFFICULTY[answer.difficulty];

		if (answer.correct === true) {
			combo.registerCorrect();
		} else {
			combo.registerWrong();
		}

		score.recordAnswer(answer.correct, mods.Score.answerPointValue(point), combo.multiplier);
	}

	for (var hit = 0; hit < plan.nearMissCount; hit += 1) {
		score.addBonus(mods.tuningModule.tuning.nearMiss.points * (plan.nearMissMultiplier || 1));
	}

	var snapshot = score.snapshot();

	return {
		run: run,
		snapshot: snapshot,
		answerShare: snapshot.answerScore / snapshot.total
	};
}

async function loadBalanceModules() {
	return loadClientBundle({
		Score: "systems/Score.ts",
		Combo: "systems/Combo.ts",
		Speed: "systems/Speed.ts",
		tuningModule: "tuning.ts"
	});
}

test("mô hình ván điển hình bám đúng ngân hàng thật và đúng nhịp trạm hiện tại", async function () {
	// (1) Thang điểm trong mô hình phải là thang điểm ngân hàng đang phát hành —
	// nếu không thì mọi con số bên dưới chỉ là văn chương.
	var actualByDifficulty = {};

	for (var index = 0; index < lop6Bank.length; index += 1) {
		actualByDifficulty[lop6Bank[index].difficulty] = lop6Bank[index].point;
	}

	assert.deepEqual(
		actualByDifficulty,
		POINT_BY_DIFFICULTY,
		"ngân hàng lop6.json đã đổi thang điểm — phải cân lại tỉ lệ 80–90% chứ không sửa mô hình cho khớp"
	);

	// (2) Số câu trong mô hình phải bằng số câu nhịp trạm THẬT SỰ cho ra.
	var mods = await loadBalanceModules();
	var run = simulateDistance(mods, TYPICAL_RUN.runSeconds, TYPICAL_RUN.bossCount);
	var quizTuning = mods.tuningModule.tuning.quiz;
	var gateQuestions = simulateQuestionsPerRun(quizTuning, run.runningSec, 35).questions;

	assert.equal(
		gateQuestions + TYPICAL_RUN.bossCount,
		TYPICAL_RUN.answers.length,
		"nhịp trạm cho " + gateQuestions + " câu cổng + " + TYPICAL_RUN.bossCount +
			" câu boss, nhưng mô hình đang dựng " + TYPICAL_RUN.answers.length + " câu"
	);

	// (3) …và vẫn nằm trong khoảng "thực tế đạt được" mà P0-13/P1 đã ghi nhận (8–9).
	assert.ok(
		TYPICAL_RUN.answers.length >= 8 && TYPICAL_RUN.answers.length <= 9,
		"ván điển hình phải có 8–9 câu (con số thực tế), đang là " + TYPICAL_RUN.answers.length
	);
});

test("KHOÁ plan §4.4 — câu đúng chiếm 80–90% tổng điểm ván điển hình", async function () {
	var mods = await loadBalanceModules();
	var result = simulateRun(mods, TYPICAL_RUN);
	var share = result.answerShare;

	var detail =
		"quãng đường " + result.snapshot.distanceScore +
		" · câu hỏi " + result.snapshot.answerScore +
		" · thưởng " + result.snapshot.bonusScore +
		" · tổng " + result.snapshot.total +
		" ⇒ " + (share * 100).toFixed(1) + "%";

	assert.ok(
		share >= 0.8 && share <= 0.9,
		"plan §4.4 chốt 80–90% cho câu đúng, đang là " + detail + ".\n" +
		"Đây là khẳng định cân bằng QUAN TRỌNG NHẤT của dự án: đổi bất kỳ nguồn điểm nào\n" +
		"(pointsPerMeter, answerPointMultiplier, nearMiss.points, streak, boss…) mà làm\n" +
		"lệch tỉ lệ này là làm bảng xếp hạng thôi đo năng lực Toán. Cân lại, đừng nới test."
	);
});

test("tỉ lệ 80–90% không sụp khi người chơi đi SĂN near-miss", async function () {
	var mods = await loadBalanceModules();

	// Kịch bản cực đoan có thật: 60 lần lướt sát, mỗi lần ăn hệ số chuỗi ×2.
	// Đây chính là kịch bản mà phương án "hạ pointsPerMeter" thất bại (tụt còn ~65%):
	// near-miss được chọn theo thang "10 điểm ≈ 10 mét", hạ điểm mét mà không hạ
	// near-miss là biến nó thành nguồn điểm lớn thứ hai của ván.
	var hunter = Object.assign({}, TYPICAL_RUN, { nearMissCount: 60, nearMissMultiplier: 2 });
	var result = simulateRun(mods, hunter);

	assert.ok(
		result.answerShare >= 0.8,
		"ván nhiều near-miss vẫn phải giữ câu đúng ≥80%, đang là " + (result.answerShare * 100).toFixed(1) + "%"
	);
});

test("càng trả lời đúng nhiều thì tỉ lệ điểm Toán càng cao (đơn điệu)", async function () {
	var mods = await loadBalanceModules();

	function withCorrectCount(count) {
		var answers = TYPICAL_RUN.answers.map(function (answer, index) {
			return Object.assign({}, answer, { correct: index < count });
		});

		return simulateRun(mods, Object.assign({}, TYPICAL_RUN, { answers: answers })).answerShare;
	}

	var weak = withCorrectCount(3);
	var typical = withCorrectCount(6);
	var strong = withCorrectCount(8);

	assert.ok(weak < typical && typical < strong, "tỉ lệ phải tăng theo số câu đúng");

	// Ghi nhận rõ (KHÔNG phải lỗi): học sinh trả lời được ít thì phần lớn điểm của em
	// đến từ quãng đường. Mục tiêu 80–90% của plan §4.4 nói về ván ĐIỂN HÌNH, không
	// phải về mọi ván — và ván 3/8 câu tự nó nói rằng em ấy chưa trả lời được nhiều.
	assert.ok(weak < 0.8, "ván 3/8 câu đúng không kỳ vọng đạt 80% — con số hiện tại: " + (weak * 100).toFixed(1) + "%");
	assert.ok(strong > 0.88, "ván 8/8 câu đúng phải gần như toàn điểm Toán");
});

test("scoreCheck của server vẫn khớp thang điểm client sau khi cân lại", async function () {
	var mods = await loadBalanceModules();
	var scoring = mods.tuningModule.tuning.scoring;
	var powerup = mods.tuningModule.tuning.powerup;

	assert.equal(
		scoreCheck.ANSWER_POINT_MULTIPLIER,
		scoring.answerPointMultiplier,
		"server/scoreCheck.js dùng thang điểm khác client — mọi câu đúng sẽ bị đánh dấu nghi vấn"
	);

	assert.equal(
		scoreCheck.MAX_ANSWER_MULTIPLIER,
		scoring.streakTier2Multiplier * powerup.doublePointsMultiplier,
		"trần hệ số một câu đúng phải là streak trần × Nhân đôi điểm"
	);

	// (a) Ván điển hình phải qua kiểm chéo, không được bị đánh dấu oan.
	var typical = simulateRun(mods, TYPICAL_RUN);
	var typicalCheck = scoreCheck.checkPlausibility(
		{
			score: typical.snapshot.total,
			correctCount: typical.snapshot.correctCount,
			durationMs: TYPICAL_RUN.runSeconds * 1000
		},
		POINT_BY_DIFFICULTY.expert
	);

	assert.equal(typicalCheck.plausible, true, "ván điển hình bị tố oan: điểm " + typical.snapshot.total);

	// (b) Ván TỐT NHẤT về mặt lý thuyết (mọi câu expert, streak trần, có Nhân đôi
	// điểm, chạy hết tốc độ trần) cũng phải lọt. Trước P2-8 số hạng câu hỏi thiếu hệ
	// số Nhân đôi điểm nên đúng ván này bị từ chối — lỗi chỉ lộ ra khi điểm câu hỏi
	// trở thành phần lớn tổng điểm.
	var bestCase =
		360 * scoreCheck.MAX_SPEED_MPS +
		9 * POINT_BY_DIFFICULTY.expert * scoring.answerPointMultiplier *
			scoring.streakTier2Multiplier * powerup.doublePointsMultiplier;

	assert.equal(
		scoreCheck.checkPlausibility({ score: bestCase, correctCount: 9, durationMs: 360000 }, POINT_BY_DIFFICULTY.expert)
			.plausible,
		true,
		"học sinh giỏi nhất chơi hết sức KHÔNG được bị tố gian lận"
	);

	// (c) …nhưng điểm bịa vẫn phải bị bắt.
	assert.equal(
		scoreCheck.checkPlausibility({ score: bestCase * 10, correctCount: 9, durationMs: 360000 }, POINT_BY_DIFFICULTY.expert)
			.plausible,
		false,
		"trần nới ra rồi mà điểm gấp 10 lần vẫn lọt thì trần vô nghĩa"
	);
});
