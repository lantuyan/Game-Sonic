"use strict";

// P0-2 — kiểm lõi engine một cách TẤT ĐỊNH (không cần trình duyệt):
//   * fixed timestep: throttle CPU không đổi số bước vật lý theo thời gian thật;
//   * clamp dt ≤ 1/30 + chặn spiral of death;
//   * pause/resume theo visibilitychange + reset clock;
//   * input buffer 150ms: bấm khi đang bận KHÔNG bị nuốt;
//   * thứ tự hạ chất lượng: DPR trước, rồi bloom/shadow.

var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("../test-helpers/clientModule");

var loadClientModule = helpers.loadClientModule;
var installBrowserStubs = helpers.installBrowserStubs;

test("fixed timestep: 60 bước cho mỗi giây thời gian thật, bất kể nhịp frame", async function () {
	var stubs = installBrowserStubs();

	try {
		var EngineModule = await loadClientModule("core/Engine.ts");
		var updates = 0;
		var renders = 0;
		var lastAlpha = -1;
		var engine = new EngineModule.Engine({
			update: function (deltaSec) {
				assert.equal(deltaSec, 1 / 60, "update() phải luôn nhận đúng 1/60s");
				updates += 1;
			},
			render: function (alpha) {
				lastAlpha = alpha;
				renders += 1;
			}
		});

		engine.start();

		// Dùng mốc ms nguyên để đồng hồ giả không sinh nhiễu dấu phẩy động.
		// 200 frame × 10ms = 2.0s thời gian thật → kỳ vọng 120 bước (sai số ±1 bước
		// là phần dư đang nằm trong accumulator, không phải trôi nhịp).
		for (var index = 0; index < 200; index += 1) {
			stubs.advanceFrame(10);
		}

		var fastSteps = updates;
		assert.ok(Math.abs(fastSteps - 120) <= 1, "2 giây thật phải sinh ~120 bước, nhận được " + fastSteps);
		assert.ok(renders >= 200, "mỗi frame phải render một lần");
		assert.ok(lastAlpha >= 0 && lastAlpha < 1, "alpha phải nằm trong [0,1)");

		// Cùng 2 giây thật nhưng chỉ 80 frame (25ms/frame = 40fps, giả lập throttle
		// CPU 4×): số bước vật lý phải GIỮ NGUYÊN.
		updates = 0;

		for (var slowIndex = 0; slowIndex < 80; slowIndex += 1) {
			stubs.advanceFrame(25);
		}

		assert.ok(
			Math.abs(updates - fastSteps) <= 1,
			"throttle CPU không được làm đổi tốc độ vật lý: nhanh=" + fastSteps + " chậm=" + updates
		);

		engine.stop();
	} finally {
		stubs.restore();
	}
});

test("dưới 30fps: clamp 1/30 CỐ Ý làm thế giới chậm lại thay vì nhảy cóc", async function () {
	var stubs = installBrowserStubs();

	try {
		var EngineModule = await loadClientModule("core/Engine.ts");
		var updates = 0;
		var engine = new EngineModule.Engine({
			update: function () {
				updates += 1;
			},
			render: function () {}
		});

		engine.start();

		// 20fps: mỗi frame 50ms nhưng dt bị kẹp còn 33.3ms → 2 bước/frame.
		for (var index = 0; index < 40; index += 1) {
			stubs.advanceFrame(50);
		}

		assert.equal(
			updates,
			80,
			"đây là đánh đổi có chủ đích: máy dưới 30fps thì game chậm lại, KHÔNG cho vật thể xuyên qua nhau"
		);

		engine.stop();
	} finally {
		stubs.restore();
	}
});

test("clamp dt ≤ 1/30 và chặn spiral of death khi frame khổng lồ", async function () {
	var stubs = installBrowserStubs();

	try {
		var EngineModule = await loadClientModule("core/Engine.ts");
		var updates = 0;
		var engine = new EngineModule.Engine({
			update: function () {
				updates += 1;
			},
			render: function () {}
		});

		engine.start();
		// Một frame dài 5 giây (tab bị treo / máy nghẽn).
		stubs.advanceFrame(5000);

		assert.equal(updates, 2, "dt bị kẹp 1/30s → tối đa 2 bước, không phải 300");

		engine.stop();
	} finally {
		stubs.restore();
	}
});

test("visibilitychange: ẩn thì dừng cập nhật, hiện lại thì bỏ khoảng thời gian đã trôi", async function () {
	var stubs = installBrowserStubs();

	try {
		var EngineModule = await loadClientModule("core/Engine.ts");
		var updates = 0;
		var engine = new EngineModule.Engine({
			update: function () {
				updates += 1;
			},
			render: function () {}
		});

		engine.start();
		stubs.advanceFrame(20);
		assert.equal(updates, 1);

		stubs.document.visibilityState = "hidden";
		stubs.document.dispatch("visibilitychange");
		assert.equal(engine.isPaused, true);

		// Tab ẩn 10 giây.
		for (var index = 0; index < 10; index += 1) {
			stubs.advanceFrame(1000);
		}

		assert.equal(updates, 1, "tab ẩn thì không chạy bước vật lý nào");

		stubs.document.visibilityState = "visible";
		stubs.document.dispatch("visibilitychange");
		assert.equal(engine.isPaused, false);

		stubs.advanceFrame(20);
		assert.equal(updates, 2, "quay lại phải chạy tiếp 1 bước, không bù 600 bước");

		engine.stop();
	} finally {
		stubs.restore();
	}
});

test("timeScale slow-mo làm chậm vật lý mà không đổi nhịp render", async function () {
	var stubs = installBrowserStubs();

	try {
		var EngineModule = await loadClientModule("core/Engine.ts");
		var updates = 0;
		var renders = 0;
		var engine = new EngineModule.Engine({
			update: function () {
				updates += 1;
			},
			render: function () {
				renders += 1;
			}
		});

		engine.start();
		engine.timeScale = 0.4;

		// 100 frame × 10ms = 1.0s thật → 60 bước ở 1×, còn 0.4× thì ≈ 24 bước.
		for (var index = 0; index < 100; index += 1) {
			stubs.advanceFrame(10);
		}

		assert.equal(renders, 100, "render vẫn chạy mỗi frame");
		assert.ok(updates >= 23 && updates <= 25, "0.4× của 60 bước ≈ 24, nhận được " + updates);

		engine.stop();
	} finally {
		stubs.restore();
	}
});

test("input buffer 150ms: lệnh bấm lúc đang bận không bị nuốt, quá hạn thì bỏ", async function () {
	var stubs = installBrowserStubs();

	try {
		var InputModule = await loadClientModule("core/Input.ts");
		var target = {
			style: {},
			addEventListener: function () {},
			removeEventListener: function () {},
			setPointerCapture: function () {},
			releasePointerCapture: function () {},
			hasPointerCapture: function () {
				return false;
			}
		};
		var input = new InputModule.Input(target);
		var isLane = function (action) {
			return action === "laneLeft" || action === "laneRight";
		};

		// Giả lập nhấn phím ←: bắn qua handler keydown đã đăng ký trên window stub.
		stubs.window.dispatch("keydown", { code: "ArrowLeft", repeat: false, preventDefault: function () {} });

		// "Đang tween": 100ms sau mới rảnh — lệnh vẫn còn trong buffer.
		stubs.advanceTime(100);
		assert.equal(input.consume(isLane), "laneLeft", "lệnh trong 150ms phải còn nguyên");
		assert.equal(input.consume(isLane), null, "đã tiêu thụ thì không lấy lại được");

		// Lệnh quá hạn 150ms thì bỏ, không "chạy trễ" gây cảm giác mất kiểm soát.
		stubs.window.dispatch("keydown", { code: "ArrowRight", repeat: false, preventDefault: function () {} });
		stubs.advanceTime(200);
		assert.equal(input.consume(isLane), null, "lệnh quá 150ms phải bị bỏ");

		// Bộ lọc: lệnh nhảy không bị hàm consume của đổi làn lấy mất.
		stubs.window.dispatch("keydown", { code: "Space", repeat: false, preventDefault: function () {} });
		assert.equal(input.consume(isLane), null);
		assert.equal(
			input.consume(function (action) {
				return action === "jump";
			}),
			"jump"
		);

		input.dispose();
	} finally {
		stubs.restore();
	}
});

test("bàn phím phủ đúng bảng điều khiển plan §4.1", async function () {
	var stubs = installBrowserStubs();

	try {
		var InputModule = await loadClientModule("core/Input.ts");
		var target = {
			style: {},
			addEventListener: function () {},
			removeEventListener: function () {},
			setPointerCapture: function () {},
			releasePointerCapture: function () {},
			hasPointerCapture: function () {
				return false;
			}
		};
		var input = new InputModule.Input(target);
		var seen = [];
		input.on(function (action) {
			seen.push(action);
		});

		[
			["ArrowLeft", "laneLeft"],
			["KeyA", "laneLeft"],
			["ArrowRight", "laneRight"],
			["KeyD", "laneRight"],
			["ArrowUp", "jump"],
			["KeyW", "jump"],
			["Space", "jump"],
			["ArrowDown", "slide"],
			["KeyS", "slide"],
			["Escape", "pause"],
			["Digit1", "answer1"],
			["Digit4", "answer4"]
		].forEach(function (entry) {
			seen.length = 0;
			stubs.window.dispatch("keydown", { code: entry[0], repeat: false, preventDefault: function () {} });
			assert.deepEqual(seen, [entry[1]], entry[0] + " phải phát " + entry[1]);
		});

		// Giữ phím (repeat) không được spam lệnh.
		seen.length = 0;
		stubs.window.dispatch("keydown", { code: "ArrowLeft", repeat: true, preventDefault: function () {} });
		assert.deepEqual(seen, []);

		input.dispose();
	} finally {
		stubs.restore();
	}
});

test("auto-quality hạ DPR TRƯỚC, rồi mới tới bloom và shadow", async function () {
	var stubs = installBrowserStubs();

	try {
		globalThis.navigator = { hardwareConcurrency: 8, deviceMemory: 8 };

		var QualityModule = await loadClientModule("core/Quality.ts");
		var quality = new QualityModule.Quality();
		quality.setPreset("high", false);

		assert.equal(quality.current.pixelRatioCap, 2);
		assert.equal(quality.current.bloom, true);
		assert.equal(quality.current.shadows, true);

		// Mỗi lần "3 giây fps thấp" + hết cooldown = hạ đúng 1 nấc.
		function starveOneStep() {
			// Xả cooldown trước (cooldown chỉ trừ dần, không tính vào cửa sổ đo).
			for (var cooldown = 0; cooldown < 80; cooldown += 1) {
				quality.sample(0.1);
			}

			for (var frame = 0; frame < 90; frame += 1) {
				quality.sample(1 / 30);
			}
		}

		starveOneStep();
		assert.equal(quality.current.pixelRatioCap, 1.5, "nấc 1 phải là DPR 2 → 1.5");
		assert.equal(quality.current.bloom, true, "chưa được tắt bloom ở nấc 1");

		starveOneStep();
		assert.equal(quality.current.pixelRatioCap, 1, "nấc 2 phải là DPR 1.5 → 1");
		assert.equal(quality.current.shadows, true, "chưa được tắt shadow ở nấc 2");

		starveOneStep();
		assert.equal(quality.current.bloom, false, "nấc 3 mới tắt bloom");
		assert.equal(quality.current.shadows, true);

		starveOneStep();
		assert.equal(quality.current.shadows, false, "nấc 4 mới tắt shadow");
		assert.equal(quality.current.blobShadow, true, "tắt shadow map thì bật blob shadow");
	} finally {
		delete globalThis.navigator;
		stubs.restore();
	}
});

test("tuning: chỉnh nóng ghi được và từ chối đường dẫn/giá trị rác", async function () {
	var TuningModule = await loadClientModule("tuning.ts");

	var paths = TuningModule.listTuningPaths();
	assert.ok(paths.length > 50, "bảng tuning phải đủ dày, đang có " + paths.length);
	assert.ok(paths.indexOf("player.jumpDurationSec") !== -1);

	var original = TuningModule.getTuningValue("player.jumpDurationSec");
	assert.equal(TuningModule.setTuningValue("player.jumpDurationSec", 0.9), true);
	assert.equal(TuningModule.tuning.player.jumpDurationSec, 0.9, "giá trị phải đổi ngay tại nguồn");

	assert.equal(TuningModule.setTuningValue("player.khongTonTai", 1), false);
	assert.equal(TuningModule.setTuningValue("khongTonTai.x", 1), false);
	assert.equal(TuningModule.setTuningValue("player.jumpDurationSec", Number.NaN), false);

	TuningModule.setTuningValue("player.jumpDurationSec", original);
});

test("hằng số tốc độ khớp hợp đồng admin (0.5–2.0)", async function () {
	var TuningModule = await loadClientModule("tuning.ts");

	assert.equal(TuningModule.tuning.speed.baseMin, 0.5);
	assert.equal(TuningModule.tuning.speed.baseMax, 2);
	assert.equal(TuningModule.tuning.scoring.startingLives, 3);
	assert.equal(TuningModule.tuning.quiz.maxGates, 3);
});
