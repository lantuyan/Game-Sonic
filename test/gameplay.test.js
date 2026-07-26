"use strict";

// P0-6 — luật gameplay phải đúng bằng SỐ:
//   * MỌI pattern công bằng ở MỌI tốc độ trong dải 0.5–2.0 (không có "chết chắc");
//   * công thức tốc độ tuyến tính, kẹp 0.5–2.0, ramp +5%/30s trần nền×1.4;
//   * điểm: quãng đường ×1 + câu đúng × point × streak;
//   * mạng CHỈ mất vì va chạm — trả lời sai không đụng tới tim (Q2).

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");
var helpers = require("../test-helpers/clientModule");
var loadClientModule = helpers.loadClientModule;
var loadClientBundle = helpers.loadClientBundle;

var patternDoc = JSON.parse(
	fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "data", "patterns.json"), "utf8")
);

test("có ít nhất 20 pattern như plan §4.2 yêu cầu", function () {
	assert.ok(
		patternDoc.patterns.length >= 20,
		"cần >=20 pattern, đang có " + patternDoc.patterns.length
	);

	var ids = patternDoc.patterns.map(function (pattern) {
		return pattern.id;
	});
	assert.equal(new Set(ids).size, ids.length, "id pattern phải là duy nhất");
});

test("MỌI pattern đều công bằng — không có pattern chết chắc", async function () {
	var rules = await loadClientModule("systems/patternRules.ts");
	var issues = rules.validateAllPatterns(patternDoc.patterns);

	assert.deepEqual(
		issues,
		[],
		"pattern vi phạm luật công bằng:\n" +
			issues
				.map(function (issue) {
					return "  · " + issue.patternId + " [" + issue.kind + "] " + issue.detail;
				})
				.join("\n")
	);
});

test("validator BẮT được pattern chết chắc (kiểm chính validator)", async function () {
	var rules = await loadClientModule("systems/patternRules.ts");

	// Chặn cứng cả 3 làn cùng lúc.
	var deadly = {
		id: "test-deadly",
		difficulty: 3,
		events: [
			{ lane: 0, type: "full", offset: 0 },
			{ lane: 1, type: "full", offset: 0 },
			{ lane: 2, type: "full", offset: 0 }
		]
	};
	var deadlyIssues = rules.validatePattern(deadly);
	assert.ok(
		deadlyIssues.some(function (issue) {
			return issue.kind === "no-escape";
		}),
		"phải phát hiện không còn lối thoát"
	);

	// Rào thấp chồng rào cao trên cùng làn: không tư thế nào qua nổi.
	var contradiction = {
		id: "test-contradiction",
		difficulty: 3,
		events: [
			{ lane: 0, type: "full", offset: 0 },
			{ lane: 1, type: "low", offset: 0 },
			{ lane: 1, type: "high", offset: 0 },
			{ lane: 2, type: "full", offset: 0 }
		]
	};
	assert.ok(
		rules.validatePattern(contradiction).some(function (issue) {
			return issue.kind === "overlapping-lane-block";
		}),
		"phải phát hiện chồng chướng ngại loại trừ nhau"
	);

	// Hai cụm quá sát nhau: không đủ thời gian phản xạ ở tốc độ tối đa.
	var tooTight = {
		id: "test-tight",
		difficulty: 2,
		events: [
			{ lane: 0, type: "full", offset: 0 },
			{ lane: 2, type: "full", offset: 6 }
		]
	};
	assert.ok(
		rules.validatePattern(tooTight).some(function (issue) {
			return issue.kind === "reaction-too-short";
		}),
		"phải phát hiện khoảng phản xạ quá ngắn"
	);

	// Làn ngoài dải 0..2.
	assert.ok(
		rules
			.validatePattern({ id: "t", difficulty: 1, events: [{ lane: 5, type: "full", offset: 0 }] })
			.some(function (issue) {
				return issue.kind === "bad-lane";
			})
	);
});

test("khoảng phản xạ đủ cho cả dải tốc độ 0.5–2.0", async function () {
	var mods = await loadClientBundle({ rules: "systems/patternRules.ts", tuningModule: "tuning.ts" });
	var speeds = mods.rules.speedRangeUnitsPerSec();

	assert.ok(speeds.length >= 15, "dải tốc độ phải phủ 0.5→2.0 theo bước 0.1");

	var fastest = Math.max.apply(null, speeds);
	var minGap = fastest * mods.tuningModule.tuning.spawn.minReactionSec;

	// Mọi khoảng cách giữa 2 cụm trong mọi pattern phải >= minGap.
	patternDoc.patterns.forEach(function (pattern) {
		var offsets = Array.from(
			new Set(
				pattern.events.map(function (event) {
					return event.offset;
				})
			)
		).sort(function (a, b) {
			return a - b;
		});

		for (var index = 1; index < offsets.length; index += 1) {
			var gap = offsets[index] - offsets[index - 1];
			assert.ok(
				gap >= minGap,
				pattern.id + ": khoảng cách " + gap + " < " + minGap.toFixed(1) + " cần cho tốc độ tối đa"
			);
		}
	});
});

test("tốc độ nền: TUYẾN TÍNH và kẹp trong 0.5–2.0 (bỏ multiplier² của V1)", async function () {
	var Speed = await loadClientModule("systems/Speed.ts");

	// Tuyến tính: admin đặt 1.5 thì ra đúng 1.5, không phải 2.25 như V1.
	assert.equal(Speed.computeBaseSpeed({ gameSpeed: 1.5, adaptiveFactor: 1 }), 1.5);
	assert.equal(Speed.computeBaseSpeed({ gameSpeed: 1, adaptiveFactor: 1 }), 1);
	assert.ok(Math.abs(Speed.computeBaseSpeed({ gameSpeed: 1.2, adaptiveFactor: 1.1 }) - 1.32) < 1e-9);

	// Kẹp 2 đầu.
	assert.equal(Speed.computeBaseSpeed({ gameSpeed: 2, adaptiveFactor: 2 }), 2);
	assert.equal(Speed.computeBaseSpeed({ gameSpeed: 0.5, adaptiveFactor: 0.1 }), 0.5);

	// Dữ liệu hỏng không được làm sập ván.
	assert.equal(Speed.computeBaseSpeed({ gameSpeed: NaN, adaptiveFactor: 1 }), 1);
	assert.equal(Speed.computeBaseSpeed({ gameSpeed: 1, adaptiveFactor: undefined }), 1);
});

test("ramp +5% mỗi 30s, trần = nền × 1.4 và không vượt 2.0", async function () {
	var Speed = await loadClientModule("systems/Speed.ts");

	assert.equal(Speed.computeRampFactor(0), 1);
	assert.equal(Speed.computeRampFactor(29), 1);
	assert.ok(Math.abs(Speed.computeRampFactor(30) - 1.05) < 1e-9);
	assert.ok(Math.abs(Speed.computeRampFactor(120) - 1.2) < 1e-9);

	assert.ok(Math.abs(Speed.computeSpeedCeiling(1) - 1.4) < 1e-9);
	// Nền 1.8 × 1.4 = 2.52 nhưng phải bị kẹp về 2.0.
	assert.equal(Speed.computeSpeedCeiling(1.8), 2);

	var controller = new Speed.SpeedController();
	controller.start({ gameSpeed: 1, adaptiveFactor: 1 });

	for (var index = 0; index < 60 * 600; index += 1) {
		controller.update(1 / 60);
	}

	assert.ok(controller.current <= 1.4 + 1e-9, "sau 10 phút vẫn không được vượt trần, đang là " + controller.current);
});

test("va chạm làm tụt tốc rồi hồi dần đúng 3 giây", async function () {
	var mods = await loadClientBundle({ Speed: "systems/Speed.ts", tuningModule: "tuning.ts" });
	var controller = new mods.Speed.SpeedController();
	controller.start({ gameSpeed: 1, adaptiveFactor: 1 });

	var before = controller.current;
	controller.onHit();

	var justAfter = controller.current;
	assert.ok(justAfter < before, "va chạm phải làm chậm lại ngay");
	assert.ok(
		Math.abs(justAfter - mods.tuningModule.tuning.speed.hitSlowdownFactor) < 0.02,
		"tụt đúng hệ số hitSlowdownFactor"
	);

	for (var index = 0; index < 60 * 3; index += 1) {
		controller.update(1 / 60);
	}

	assert.ok(Math.abs(controller.current - before) < 0.02, "sau 3s phải hồi về như cũ");
});

test("toast tốc độ đúng định dạng hợp đồng plan §7.3.4", async function () {
	var Speed = await loadClientModule("systems/Speed.ts");
	var controller = new Speed.SpeedController();

	controller.start({ gameSpeed: 1, adaptiveFactor: 1 });
	assert.equal(controller.toastText, "Tốc độ hiện tại: x1.0");

	controller.start({ gameSpeed: 1.5, adaptiveFactor: 1 });
	assert.equal(controller.toastText, "Tốc độ hiện tại: x1.5");
});

test("điểm: quãng đường ×1 + câu đúng × point × streak", async function () {
	var Score = (await loadClientModule("systems/Score.ts")).Score;
	var score = new Score();

	score.setDistance(250.7);
	assert.equal(score.distanceScore, 250, "điểm quãng đường làm tròn xuống");
	assert.equal(score.total, 250);

	// Câu đúng 100 điểm với streak ×2.
	assert.equal(score.recordAnswer(true, 100, 2), 200);
	assert.equal(score.total, 450);

	// Câu sai không cộng điểm và không trừ điểm.
	assert.equal(score.recordAnswer(false, 100, 2), 0);
	assert.equal(score.total, 450);

	var snapshot = score.snapshot();
	assert.equal(snapshot.correctCount, 1);
	assert.equal(snapshot.totalAnswered, 2);
	// Câu đúng cũng cho coin (plan §4.4: +5).
	assert.equal(snapshot.coins, 5);
});

test("điểm câu hỏi chiếm phần lớn tổng điểm (BXH đo năng lực Toán)", async function () {
	var Score = (await loadClientModule("systems/Score.ts")).Score;
	var score = new Score();

	// Ván 4 phút ~ 1.500m, 10 câu đúng × 100 điểm × streak trung bình 1.5.
	score.setDistance(1500);

	for (var index = 0; index < 10; index += 1) {
		score.recordAnswer(true, 100, 1.5);
	}

	var snapshot = score.snapshot();
	var answerShare = snapshot.answerScore / snapshot.total;

	assert.ok(
		answerShare >= 0.4,
		"điểm câu hỏi phải là phần đáng kể của tổng, đang là " + Math.round(answerShare * 100) + "%"
	);
});

test("mạng: CHỈ mất vì va chạm, có ân xá, khiên đỡ trước tim", async function () {
	var mods = await loadClientBundle({ Lives: "systems/Lives.ts", tuningModule: "tuning.ts" });
	var lives = new mods.Lives.Lives();

	assert.equal(lives.current, 3, "bắt đầu 3 tim");

	assert.equal(lives.takeHit(), "damaged");
	assert.equal(lives.current, 2);

	// Đang trong ân xá: cú thứ hai của cùng cụm không được ăn thêm tim.
	assert.equal(lives.takeHit(), "ignored");
	assert.equal(lives.current, 2);

	for (var index = 0; index < 60 * 4; index += 1) {
		lives.update(1 / 60);
	}

	assert.equal(lives.isInvincible, false);

	// Khiên đỡ trước, không mất tim.
	lives.addShield();
	assert.equal(lives.takeHit(), "shielded");
	assert.equal(lives.current, 2);
	assert.equal(lives.shieldCount, 0);

	for (var step = 0; step < 60 * 4; step += 1) {
		lives.update(1 / 60);
	}

	assert.equal(lives.takeHit(), "damaged");
	assert.equal(lives.current, 1);

	for (var wait = 0; wait < 60 * 4; wait += 1) {
		lives.update(1 / 60);
	}

	assert.equal(lives.takeHit(), "dead");
	assert.equal(lives.current, 0);
});

test("Fever cho bất tử tạm thời mà không đụng số tim", async function () {
	var Lives = (await loadClientModule("systems/Lives.ts")).Lives;
	var lives = new Lives();

	lives.grantInvincibility(8);
	assert.equal(lives.isInvincible, true);
	assert.equal(lives.takeHit(), "ignored");
	assert.equal(lives.current, 3, "Fever không được làm mất tim");
});
