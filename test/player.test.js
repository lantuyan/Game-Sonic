"use strict";

// P0-5 — cảm giác điều khiển phải kiểm được bằng SỐ, không phải "chơi thử thấy ổn":
//   * tween đổi làn đúng thời lượng, bị cắt ngang bởi lệnh mới;
//   * nhảy parabol đúng đỉnh và đúng thời điểm chạm đất;
//   * fast-fall rút ngắn pha rơi mà KHÔNG đổi độ cao đỉnh;
//   * trượt hạ hitbox 50%;
//   * map id nhân vật cũ (`sonic` → knight…) đúng hợp đồng plan §7.3.3.

var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("../test-helpers/clientModule");
var loadClientModule = helpers.loadClientModule;
var loadClientBundle = helpers.loadClientBundle;

var STEP = 1 / 60;

function stepFor(motion, seconds) {
	var steps = Math.round(seconds / STEP);

	for (var index = 0; index < steps; index += 1) {
		motion.update(STEP);
	}
}

test("đổi làn: tween xong đúng thời lượng và dừng đúng tâm làn", async function () {
	var mods = await loadClientBundle({ motion: "entities/PlayerMotion.ts", tuningModule: "tuning.ts" });
	var motion = new mods.motion.PlayerMotion();
	var laneOffset = mods.tuningModule.tuning.world.laneOffsetX;
	var tweenSec = mods.tuningModule.tuning.player.laneTweenSec;

	assert.equal(motion.lane, 1, "bắt đầu ở làn giữa");
	assert.equal(motion.x, 0);

	assert.equal(motion.command("laneRight"), true);
	assert.equal(motion.isTweening, true);
	assert.equal(motion.lane, 1, "lane chỉ đổi khi tween KẾT THÚC");
	assert.equal(motion.targetLane, 2);

	// Giữa chừng: đã dịch nhưng chưa tới nơi.
	stepFor(motion, tweenSec / 2);
	assert.ok(motion.x > 0 && motion.x < laneOffset, "đang ở giữa 2 làn, x = " + motion.x);

	stepFor(motion, tweenSec);
	assert.equal(motion.isTweening, false);
	assert.equal(motion.lane, 2);
	assert.ok(Math.abs(motion.x - laneOffset) < 1e-9, "phải dừng đúng tâm làn phải");
});

test("đổi làn: đang tween thì từ chối lệnh mới (để input buffer giữ lại)", async function () {
	var PlayerMotion = (await loadClientModule("entities/PlayerMotion.ts")).PlayerMotion;
	var motion = new PlayerMotion();

	assert.equal(motion.command("laneRight"), true);
	assert.equal(motion.command("laneLeft"), false, "đang tween phải trả false — buffer sẽ thử lại");
});

test("đổi làn: ở làn ngoài cùng thì nuốt lệnh thay vì giữ trong buffer", async function () {
	var PlayerMotion = (await loadClientModule("entities/PlayerMotion.ts")).PlayerMotion;
	var motion = new PlayerMotion();

	motion.command("laneRight");
	stepFor(motion, 0.5);
	assert.equal(motion.lane, 2, "đã ở làn ngoài cùng bên phải");

	// Trả true = "đã xử lý xong", để buffer KHÔNG giữ lệnh lại. Nếu trả false thì
	// lệnh còn nằm đó và sẽ bắn ngay khi người chơi vừa quay về làn giữa.
	assert.equal(motion.command("laneRight"), true);
	assert.equal(motion.targetLane, 2, "không được vượt ra ngoài 3 làn");
	assert.equal(motion.isTweening, false);
});

test("nhảy: parabol đúng đỉnh, chạm đất đúng thời lượng, phát sự kiện landed", async function () {
	var mods = await loadClientBundle({ motion: "entities/PlayerMotion.ts", tuningModule: "tuning.ts" });
	var motion = new mods.motion.PlayerMotion();
	var jumpSec = mods.tuningModule.tuning.player.jumpDurationSec;
	var jumpHeight = mods.tuningModule.tuning.player.jumpHeight;

	assert.equal(motion.command("jump"), true);
	assert.equal(motion.pose, "jump");

	// Đỉnh nằm giữa quãng.
	stepFor(motion, jumpSec / 2);
	assert.ok(Math.abs(motion.y - jumpHeight) < 0.05, "đỉnh phải ≈ jumpHeight, đang là " + motion.y);

	// Chạm đất đúng lúc hết thời lượng.
	var landed = false;

	for (var index = 0; index < Math.round(jumpSec / STEP); index += 1) {
		if (motion.update(STEP).landed === true) {
			landed = true;
			break;
		}
	}

	assert.equal(landed, true, "phải phát sự kiện landed");
	assert.equal(motion.y, 0);
	assert.equal(motion.pose, "run");
});

test("nhảy: đang bay thì không nhảy chồng (double jump)", async function () {
	var PlayerMotion = (await loadClientModule("entities/PlayerMotion.ts")).PlayerMotion;
	var motion = new PlayerMotion();

	motion.command("jump");
	motion.update(STEP);
	assert.equal(motion.command("jump"), false, "không có double jump ở P0");
});

test("fast-fall: rơi nhanh hơn nhưng KHÔNG hạ độ cao đỉnh", async function () {
	var mods = await loadClientBundle({ motion: "entities/PlayerMotion.ts", tuningModule: "tuning.ts" });
	var jumpSec = mods.tuningModule.tuning.player.jumpDurationSec;

	function timeToLand(useFastFall) {
		var motion = new mods.motion.PlayerMotion();
		motion.command("jump");

		var elapsed = 0;
		var applied = false;

		for (var index = 0; index < 600; index += 1) {
			// Bấm vuốt-xuống ngay sau đỉnh.
			if (useFastFall === true && applied === false && elapsed >= jumpSec * 0.55) {
				assert.equal(motion.command("slide"), true, "vuốt xuống khi đang bay phải được chấp nhận");
				applied = true;
			}

			var events = motion.update(STEP);
			elapsed += STEP;

			if (events.landed === true) {
				return elapsed;
			}
		}

		throw new Error("không bao giờ chạm đất");
	}

	var normal = timeToLand(false);
	var fast = timeToLand(true);

	assert.ok(fast < normal, "fast-fall phải chạm đất sớm hơn: fast=" + fast + " normal=" + normal);

	// Đỉnh không đổi: vuốt xuống SAU đỉnh nên độ cao tối đa phải giữ nguyên.
	var plain = new mods.motion.PlayerMotion();
	plain.command("jump");
	var maxHeight = 0;

	for (var step = 0; step < 200; step += 1) {
		plain.update(STEP);
		maxHeight = Math.max(maxHeight, plain.y);
	}

	assert.ok(Math.abs(maxHeight - mods.tuningModule.tuning.player.jumpHeight) < 0.05);
});

test("trượt: hạ hitbox 50% và tự hết sau đúng thời lượng", async function () {
	var mods = await loadClientBundle({ motion: "entities/PlayerMotion.ts", tuningModule: "tuning.ts" });
	var motion = new mods.motion.PlayerMotion();
	var fullHeight = mods.tuningModule.tuning.player.height;
	var slideSec = mods.tuningModule.tuning.player.slideDurationSec;

	assert.equal(motion.hitboxHeight, fullHeight);

	motion.command("slide");
	assert.equal(motion.pose, "slide");
	assert.ok(Math.abs(motion.hitboxHeight - fullHeight * 0.5) < 1e-9, "trượt phải hạ hitbox đúng 50%");

	stepFor(motion, slideSec + STEP);
	assert.equal(motion.pose, "run");
	assert.equal(motion.hitboxHeight, fullHeight);
});

test("nhảy cắt ngang trượt: đổi ý giữa chừng là hợp lệ", async function () {
	var PlayerMotion = (await loadClientModule("entities/PlayerMotion.ts")).PlayerMotion;
	var motion = new PlayerMotion();

	motion.command("slide");
	assert.equal(motion.pose, "slide");
	assert.equal(motion.command("jump"), true);
	assert.equal(motion.pose, "jump", "nhảy phải cắt được trượt");
});

test("vấp sau khi trả lời sai: khoá điều khiển 1s rồi trả lại", async function () {
	var mods = await loadClientBundle({ motion: "entities/PlayerMotion.ts", tuningModule: "tuning.ts" });
	var motion = new mods.motion.PlayerMotion();

	motion.stumble();
	assert.equal(motion.isStumbling, true);
	assert.equal(motion.command("laneRight"), false, "đang vấp thì không điều khiển được");

	stepFor(motion, mods.tuningModule.tuning.player.stumbleSec + STEP);
	assert.equal(motion.isStumbling, false);
	assert.equal(motion.command("laneRight"), true, "hết vấp phải điều khiển lại được ngay");
});

test("map id nhân vật cũ sang V2 đúng hợp đồng plan §7.3.3", async function () {
	var characters = await loadClientModule("data/characters.ts");

	assert.equal(characters.resolveCharacterId("sonic"), "knight");
	assert.equal(characters.resolveCharacterId("robot"), "robot");
	assert.equal(characters.resolveCharacterId("horse"), "fox");
	assert.equal(characters.resolveCharacterId("parrot"), "parrot");

	// V1 từng ghi kèm dấu nháy kép (JSON.stringify một chuỗi) — phải chịu được.
	assert.equal(characters.resolveCharacterId('"sonic"'), "knight");
	assert.equal(characters.resolveCharacterId("SONIC"), "knight");
	assert.equal(characters.resolveCharacterId("  sonic  "), "knight");

	// id V2 đã đúng thì giữ nguyên.
	assert.equal(characters.resolveCharacterId("knight"), "knight");

	// Rác / chưa có → nhân vật mặc định, không được ném lỗi.
	assert.equal(characters.resolveCharacterId(null), "knight");
	assert.equal(characters.resolveCharacterId(""), "knight");
	assert.equal(characters.resolveCharacterId("khong-ton-tai"), "knight");

	// 4 nhân vật P0 + 3 nhân vật mở khoá của P1-3.
	assert.equal(characters.CHARACTERS.length, 7);

	// `legacyId` rỗng của nhân vật P1-3 KHÔNG được khớp bừa với chuỗi rỗng.
	assert.equal(characters.resolveCharacterId("mage"), "mage");
	assert.equal(characters.resolveCharacterId(""), "knight");
});

test("input buffer: consumeIf giữ lệnh lại khi bị từ chối, không làm mới hạn", async function () {
	var stubs = helpers.installBrowserStubs();

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

		stubs.window.dispatch("keydown", { code: "ArrowRight", repeat: false, preventDefault: function () {} });

		// Lần 1: "đang bận" → lệnh phải Ở LẠI hàng đợi.
		assert.equal(input.consumeIf(isLane, function () { return false; }), null);

		// Lần 2 (vẫn trong 150ms): rảnh rồi → nhận được.
		stubs.advanceTime(100);
		assert.equal(input.consumeIf(isLane, function () { return true; }), "laneRight");
		assert.equal(input.consumeIf(isLane, function () { return true; }), null, "đã tiêu thụ thì hết");

		// Hạn KHÔNG được làm mới bởi những lần thử thất bại.
		stubs.window.dispatch("keydown", { code: "ArrowLeft", repeat: false, preventDefault: function () {} });
		stubs.advanceTime(80);
		input.consumeIf(isLane, function () { return false; });
		stubs.advanceTime(80);
		assert.equal(
			input.consumeIf(isLane, function () { return true; }),
			null,
			"tổng 160ms > 150ms nên lệnh phải chết, dù đã thử lại giữa chừng"
		);

		input.dispose();
	} finally {
		stubs.restore();
	}
});
