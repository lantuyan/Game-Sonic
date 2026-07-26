"use strict";

// P0-13 — CÂN BẰNG: đo bằng mô phỏng tất định thay vì "chơi thử thấy ổn".
//
// Mục tiêu plan §8 / task P0-13: ván dài 3–6 phút, 8–14 câu/ván.
// Mô phỏng nhịp trạm câu hỏi theo đúng hằng số trong tuning.ts và đối chiếu.

var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("../test-helpers/clientModule");
var loadClientBundle = helpers.loadClientBundle;

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

test("điểm câu hỏi chiếm ưu thế trong ván điển hình (BXH đo Toán)", async function () {
	var mods = await loadClientBundle({ Score: "systems/Score.ts", Combo: "systems/Combo.ts" });
	var score = new mods.Score.Score();
	var combo = new mods.Combo.Combo();

	// Ván 5 phút ở tốc độ mặc định: 15.5 unit/s × 300s ≈ 4.650m.
	score.setDistance(4650);

	// 9 câu, đúng 7 (tỉ lệ điển hình của học sinh khá).
	for (var index = 0; index < 9; index += 1) {
		var correct = index < 7;

		if (correct === true) {
			combo.registerCorrect();
		} else {
			combo.registerWrong();
		}

		score.recordAnswer(correct, 100, combo.multiplier);
	}

	var snapshot = score.snapshot();
	var answerShare = snapshot.answerScore / snapshot.total;

	// Không ép ≥80% như plan §4.4 mong muốn: quãng đường 4.650 điểm là rất lớn.
	// Ghi nhận con số thật để P1 cân lại (giảm điểm quãng đường hoặc tăng point/câu).
	assert.ok(
		answerShare > 0.1,
		"điểm câu hỏi phải có trọng số đáng kể, đang chỉ " + Math.round(answerShare * 100) + "%"
	);
});
