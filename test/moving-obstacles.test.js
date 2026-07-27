"use strict";

// P2-1 — CHƯỚNG NGẠI DI ĐỘNG + PATTERN TỔ HỢP KHÓ.
//
// Ba nhóm bất biến ở đây, và cả ba đều thuộc loại hỏng-mà-không-báo-lỗi:
//
//   1. **Không được đổi hành vi cũ.** Va chạm giờ so sánh làn bằng KHOẢNG CÁCH chứ
//      không bằng `===`. Nếu bán kính lỡ tay đặt ≥ 1 thì mọi chướng ngại đứng yên
//      bỗng chặn luôn hai làn bên cạnh — game vẫn chạy, chỉ là không qua nổi.
//   2. **Quỹ đạo phải độc lập với tốc độ.** Cả dự án đo bằng unit chứ không đo bằng
//      giây; nếu ai đó đổi sang tham số theo đồng hồ thì cùng một pattern sẽ dễ ở
//      lớp bị đặt gameSpeed 0.5 và bất khả thi ở lớp bị đặt 2.0.
//   3. **Pattern tổ hợp không được rơi vào tay người mới.** Nó phải im lặng suốt
//      đầu ván và suốt pha vừa-mất-tim.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");
var helpers = require("../test-helpers/clientModule");
var loadClientBundle = helpers.loadClientBundle;

var rootDir = path.resolve(__dirname, "..");
var patternData = require("../client/src/data/patterns.json");

function loadRules() {
	return loadClientBundle({
		rules: "systems/patternRules.ts",
		collision: "systems/Collision.ts",
		motion: "systems/movingObstacles.ts",
		tuningModule: "tuning.ts"
	});
}

function band(overrides) {
	return Object.assign(
		{ lane: 1, kind: "full", zStart: -1, zEnd: 1, consumed: false, laneOffset: 0, moving: false },
		overrides
	);
}

function player(overrides) {
	return Object.assign({ lane: 1, targetLane: 1, pose: "run", z: 0, halfDepth: 0.5 }, overrides);
}

// --- 1. Không đổi hành vi cũ -------------------------------------------------

test("chướng ngại ĐỨNG YÊN chặn làn y hệt luật cũ `band.lane === lane`", async function () {
	var mods = await loadRules();

	for (var lane = 0; lane < 3; lane += 1) {
		for (var target = 0; target < 3; target += 1) {
			assert.equal(
				mods.collision.bandBlocksLane(band({ lane: lane }), target),
				lane === target,
				"vật đứng yên ở làn " + lane + " với làn " + target
			);
		}
	}

	// Đây mới là điều thật sự phải khoá: bán kính < 1 thì và chỉ thì luật cũ giữ nguyên.
	assert.ok(
		mods.tuningModule.tuning.spawn.blockLaneRadius < 1,
		"blockLaneRadius ≥ 1 sẽ làm mọi chướng ngại đứng yên chặn cả làn bên cạnh"
	);
});

test("bản kê cũ (không có laneOffset/moving) vẫn dùng được nguyên trạng", async function () {
	var mods = await loadRules();
	// Đúng shape mà test P0/P1 và mọi code cũ dựng ra: không có hai field mới.
	var legacy = { lane: 2, kind: "low", zStart: -1, zEnd: 1, consumed: false };

	assert.equal(mods.collision.bandLane(legacy), 2);
	assert.equal(mods.collision.bandBlocksLane(legacy, 2), true);
	assert.equal(mods.collision.bandBlocksLane(legacy, 1), false);
	assert.equal(mods.collision.findCollision(player({ lane: 2, targetLane: 2 }), [legacy]), legacy);
});

// --- 2. Quỹ đạo ---------------------------------------------------------------

test("sóng tam giác chạy đúng chu kỳ và luôn nằm trong [0,1]", async function () {
	var mods = await loadRules();

	assert.equal(mods.motion.triangleWave(0), 0);
	assert.equal(mods.motion.triangleWave(0.25), 0.5);
	assert.equal(mods.motion.triangleWave(0.5), 1);
	assert.equal(mods.motion.triangleWave(0.75), 0.5);
	assert.ok(Math.abs(mods.motion.triangleWave(1)) < 1e-12, "chu kỳ 1");

	// Cả số âm (vật còn ở phía trước, z < 0 nên tham số âm) lẫn số rất lớn.
	for (var step = -50; step <= 50; step += 0.37) {
		var value = mods.motion.triangleWave(step);
		assert.ok(value >= 0 && value <= 1, "tràn biên tại " + step + ": " + value);
	}
});

test("làn LÚC TỚI NƠI là hằng số — phase 0 về làn gốc, phase 0.5 về toLane", async function () {
	var mods = await loadRules();

	assert.equal(mods.motion.arrivalLane({ toLane: 2, phase: 0 }, 0), 0);
	assert.equal(mods.motion.arrivalLane({ toLane: 2, phase: 0.5 }, 0), 2);
	assert.equal(mods.motion.arrivalLane({ toLane: 0, phase: 0.5 }, 2), 0);
	assert.equal(mods.motion.arrivalLane({ toLane: 2, phase: 0 }, 1), 1);
});

test("quỹ đạo phụ thuộc QUÃNG ĐƯỜNG, không phụ thuộc tốc độ ván", async function () {
	var mods = await loadRules();
	var spec = { toLane: 2, phase: 0.5 };
	var wavelength = mods.tuningModule.tuning.spawn.movingWavelengthUnits;

	// Mô phỏng cùng một quãng đường 160 unit ở hai tốc độ khác nhau (0.5× và 2.0×
	// của plan §7.3.4) rồi so từng mốc: hai đường phải TRÙNG KHÍT.
	function walk(unitsPerFrame) {
		var samples = [];

		for (var z = -160; z <= 0; z += unitsPerFrame) {
			samples.push({ z: z, offset: mods.motion.laneOffsetAt(spec, 0, z) });
		}

		return samples;
	}

	var slow = walk(0.25);
	var fast = walk(1);

	fast.forEach(function (sample) {
		var twin = slow.find(function (other) {
			return Math.abs(other.z - sample.z) < 1e-9;
		});

		assert.notEqual(twin, undefined, "thiếu mốc z=" + sample.z);
		assert.ok(Math.abs(twin.offset - sample.offset) < 1e-12, "z=" + sample.z + " lệch giữa hai tốc độ");
	});

	// Và nó thật sự ĐI: nửa bước sóng phía trước là đầu kia của dao động.
	assert.ok(Math.abs(mods.motion.laneOffsetAt(spec, 0, 0) - 2) < 1e-12);
	assert.ok(Math.abs(mods.motion.laneOffsetAt(spec, 0, -wavelength / 2) - 0) < 1e-12);
});

test("gần chỗ va chạm quỹ đạo gần như đứng yên — validator được phép lấy z=0", async function () {
	var mods = await loadRules();
	var spec = { toLane: 2, phase: 0.5 };
	// Cửa sổ chồng nhau thật sự: nửa dải chướng ngại (OBSTACLE_DEPTH/2 = 0.8) cộng
	// nửa hitbox player (0.5) = ±1.3 unit quanh gốc.
	var atZero = mods.motion.laneOffsetAt(spec, 0, 0);
	var window = mods.rules.OBSTACLE_DEPTH / 2 + 0.5;

	for (var z = -window; z <= window; z += 0.05) {
		var drift = Math.abs(mods.motion.laneOffsetAt(spec, 0, z) - atZero);
		assert.ok(drift < 0.1, "z=" + z.toFixed(1) + " lệch " + drift.toFixed(3) + " làn so với lúc tới nơi");
	}
});

// --- 3. Va chạm + near-miss với vật di động -----------------------------------

test("vật di động đứng GIỮA hai làn thì chặn cả hai", async function () {
	var mods = await loadRules();
	var drifting = band({ lane: 0, laneOffset: 0.5, moving: true });

	assert.equal(mods.collision.bandBlocksLane(drifting, 0), true);
	assert.equal(mods.collision.bandBlocksLane(drifting, 1), true);
	assert.equal(mods.collision.bandBlocksLane(drifting, 2), false);

	// …nhưng khi về đúng tâm một làn thì chỉ chặn làn đó — không "béo" ra mãi.
	var centred = band({ lane: 0, laneOffset: 0, moving: true });
	assert.equal(mods.collision.bandBlocksLane(centred, 0), true);
	assert.equal(mods.collision.bandBlocksLane(centred, 1), false);
});

test("nhảy/trượt KHÔNG cứu được vật di động — chỉ đổi làn", async function () {
	var mods = await loadRules();
	var drifting = band({ lane: 1, kind: "full", laneOffset: 0, moving: true });

	["run", "jump", "slide"].forEach(function (pose) {
		assert.notEqual(
			mods.collision.findCollision(player({ pose: pose }), [drifting]),
			null,
			"tư thế " + pose + " không được cứu khỏi vật di động"
		);
	});

	assert.equal(mods.collision.findCollision(player({ lane: 0, targetLane: 0 }), [drifting]), null);
});

test("near-miss đo theo x THẬT của vật di động, không theo tâm làn gốc", async function () {
	var mods = await loadClientBundle({ near: "systems/NearMiss.ts", tuningModule: "tuning.ts" });
	var laneOffsetX = mods.tuningModule.tuning.world.laneOffsetX;
	var runner = {
		x: 0,
		y: 0,
		z: 0,
		halfWidth: mods.tuningModule.tuning.player.halfWidth,
		halfDepth: 0.5,
		height: mods.tuningModule.tuning.player.height,
		pose: "run"
	};

	// Vật khai làn 0 nhưng đã trôi hẳn sang làn 1 (chỗ player đứng) → phải là VA CHẠM,
	// không phải "lướt sát". Đây đúng là chỗ dễ sai nhất: dùng `band.lane` thì hàm
	// tưởng vật còn ở làn bên và trả về một khoảng hở đẹp.
	var arrived = band({ lane: 0, laneOffset: 1, moving: true });
	assert.ok(mods.near.nearMissClearance(runner, arrived) < 0, "vật đã trôi tới nơi mà vẫn tính là né được");

	// Còn cách một làn thì khoảng hở phải là số dương và khớp hình học.
	var far = band({ lane: 0, laneOffset: 0, moving: true });
	var expected = laneOffsetX - runner.halfWidth - mods.tuningModule.tuning.nearMiss.movingHalfWidth;
	assert.ok(Math.abs(mods.near.nearMissClearance(runner, far) - expected) < 1e-9);

	// Vật di động DÀI hơn nên near-miss của nó khó ăn hơn vật đứng yên cùng vị trí.
	var still = band({ lane: 0, laneOffset: 0, moving: false });
	assert.ok(
		mods.near.nearMissClearance(runner, still) > mods.near.nearMissClearance(runner, far),
		"near-miss vật di động phải chặt hơn vật đứng yên"
	);
});

// --- 4. Validator hiểu chuyển động --------------------------------------------

test("validator bắt khai báo chuyển động hỏng", async function () {
	var mods = await loadRules();

	function kinds(pattern) {
		return mods.rules.validatePattern(pattern).map(function (issue) {
			return issue.kind;
		});
	}

	assert.ok(
		kinds({
			id: "x-out-of-range",
			difficulty: 3,
			events: [{ lane: 0, type: "full", offset: 0, motion: { toLane: 5, phase: 0 } }]
		}).includes("bad-motion")
	);

	assert.ok(
		kinds({
			id: "x-bad-phase",
			difficulty: 3,
			events: [{ lane: 0, type: "full", offset: 0, motion: { toLane: 2, phase: 1 } }]
		}).includes("bad-motion"),
		"phase = 1 trùng phase = 0, phải ép vào [0,1)"
	);

	assert.ok(
		kinds({
			id: "x-tiny-amplitude",
			difficulty: 3,
			events: [{ lane: 1, type: "full", offset: 0, motion: { toLane: 1.2, phase: 0 } }]
		}).includes("bad-motion"),
		"biên độ 0.2 làn chỉ là rung tại chỗ, không phải chuyển động"
	);
});

test("validator bắt vật di động tới nơi chồng lên vật khác cùng hàng", async function () {
	var mods = await loadRules();
	var issues = mods.rules.validatePattern({
		id: "x-row-conflict",
		difficulty: 4,
		events: [
			{ lane: 2, type: "full", offset: 0 },
			// phase 0.5 ⇒ tới nơi ở làn 2, tức đúng chỗ khối chặn đứng yên bên trên.
			{ lane: 0, type: "full", offset: 0, motion: { toLane: 2, phase: 0.5 } }
		]
	});

	assert.ok(
		issues.some(function (issue) {
			return issue.kind === "moving-row-conflict";
		}),
		"hai model sẽ lồng vào nhau mà không ai phát hiện"
	);
});

test("validator vẫn bắt pattern chết chắc khi vật di động bịt nốt làn cuối", async function () {
	var mods = await loadRules();
	var issues = mods.rules.validatePattern({
		id: "x-no-escape",
		difficulty: 4,
		events: [
			{ lane: 0, type: "full", offset: 0 },
			{ lane: 1, type: "full", offset: 0 },
			// Tới nơi ở làn 2 ⇒ bịt nốt làn thoát duy nhất.
			{ lane: 0, type: "full", offset: 0, motion: { toLane: 2, phase: 0.5 } }
		]
	});

	assert.ok(
		issues.some(function (issue) {
			return issue.kind === "no-escape";
		}),
		"cả 3 làn bị bịt mà validator không kêu — đúng thứ giết người chơi oan"
	);
});

test("MỌI pattern trong patterns.json vẫn hợp lệ ở mọi tốc độ, gồm cả bậc 4", async function () {
	var mods = await loadRules();

	assert.deepEqual(mods.rules.validateAllPatterns(patternData.patterns), []);

	var moving = patternData.patterns.filter(function (pattern) {
		return mods.rules.hasMovingObstacle(pattern);
	});
	var combo = patternData.patterns.filter(function (pattern) {
		return pattern.difficulty >= mods.tuningModule.tuning.spawn.comboDifficulty;
	});

	assert.ok(moving.length >= 3, "P2-1 phải có ít nhất 3 pattern dùng chướng ngại di động");
	assert.ok(combo.length >= 3, "P2-1 phải có ít nhất 3 pattern tổ hợp khó");

	combo.forEach(function (pattern) {
		var lanes = new Set(
			pattern.events.map(function (event) {
				return event.type;
			})
		);
		assert.ok(lanes.size >= 2, pattern.id + ": 'tổ hợp' mà chỉ có một loại chướng ngại");
		assert.ok(pattern.events.length >= 5, pattern.id + ": tổ hợp khó phải nhiều hơn một cụm");
	});
});

// --- 5. Cửa mở khoá pattern tổ hợp -------------------------------------------

test("pattern tổ hợp im lặng lúc đầu ván và lúc vừa mất tim", async function () {
	var mods = await loadRules();
	var spawnTuning = mods.tuningModule.tuning.spawn;
	var combo = { id: "combo", difficulty: spawnTuning.comboDifficulty, events: [] };
	var easy = { id: "easy", difficulty: 1, events: [] };
	var medium = { id: "medium", difficulty: 2, events: [] };

	var fresh = { rampFactor: 1, stageIndex: 0, recovering: false };
	assert.equal(mods.rules.isPatternAllowed(combo, fresh), false, "đầu ván không được gặp tổ hợp khó");
	assert.equal(mods.rules.isPatternAllowed(medium, fresh), true);

	// Đủ nóng theo RAMP.
	assert.equal(
		mods.rules.isPatternAllowed(combo, {
			rampFactor: spawnTuning.comboUnlockRampFactor,
			stageIndex: 0,
			recovering: false
		}),
		true
	);

	// …hoặc đủ nóng theo CHẶNG, dù ramp còn thấp (ván bị đặt gameSpeed thấp).
	assert.equal(
		mods.rules.isPatternAllowed(combo, {
			rampFactor: 1,
			stageIndex: spawnTuning.comboUnlockStageIndex,
			recovering: false
		}),
		true
	);

	// Vừa mất tim: chỉ pattern dễ nhất, kể cả khi ván đã rất nóng.
	var recovering = { rampFactor: 1.4, stageIndex: 3, recovering: true };
	assert.equal(mods.rules.isPatternAllowed(combo, recovering), false);
	assert.equal(mods.rules.isPatternAllowed(medium, recovering), false);
	assert.equal(mods.rules.isPatternAllowed(easy, recovering), true);
});

test("ngưỡng mở khoá tương ứng với vài phút chơi thật, không phải vài giây", async function () {
	var mods = await loadClientBundle({ speed: "systems/Speed.ts", tuningModule: "tuning.ts" });
	var threshold = mods.tuningModule.tuning.spawn.comboUnlockRampFactor;
	var seconds = 0;

	while (mods.speed.computeRampFactor(seconds) < threshold && seconds < 3600) {
		seconds += 1;
	}

	assert.ok(seconds >= 60, "mở khoá sau " + seconds + "s — quá sớm cho học sinh lớp 6");
	assert.ok(seconds <= 240, "mở khoá sau " + seconds + "s — muộn tới mức gần như không ai gặp");
});

// --- 6. Quy tắc vàng #6: không cấp phát trong game loop ------------------------

test("Spawn.update không cấp phát object nào cho chướng ngại di động", function () {
	var source = fs.readFileSync(path.join(rootDir, "client", "src", "systems", "Spawn.ts"), "utf8");
	var start = source.indexOf("update(deltaSec: number, advanceUnits: number)");

	assert.notEqual(start, -1, "không tìm thấy Spawn.update — test này phải được sửa theo");

	var body = source.slice(start, source.indexOf("\n\tprivate fillAhead", start));

	assert.equal(/\bnew [A-Z]/.test(body), false, "Spawn.update đang `new` một object trong đường nóng");
	assert.ok(body.includes("laneOffsetAt("), "update phải cập nhật lại vị trí ngang của vật di động");

	// `setIntensity` sửa TẠI CHỖ; tạo object mới mỗi frame là đúng thứ quy tắc #6 cấm.
	var intensity = source.slice(source.indexOf("setIntensity("), source.indexOf("reset(): void"));
	assert.equal(/\bnew \b/.test(intensity), false, "setIntensity đang cấp phát mỗi frame");
});
