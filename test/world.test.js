"use strict";

// P0-4 — kiểm phần LOGIC của thế giới (không cần WebGL):
//   * va chạm lane-based: đúng tư thế thì qua, sai tư thế thì trúng;
//   * đang tween chiếm 2 làn (không "lách" xuyên chướng ngại giữa chừng);
//   * luật công bằng: luôn tồn tại lối thoát;
//   * PRNG có seed tái lập được (bố cục ván chơi lại y hệt).

var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("../test-helpers/clientModule");
var loadClientModule = helpers.loadClientModule;
var loadClientBundle = helpers.loadClientBundle;

function band(lane, kind, zStart, zEnd) {
	return { lane: lane, kind: kind, zStart: zStart, zEnd: zEnd, consumed: false };
}

function player(overrides) {
	return Object.assign({ lane: 1, targetLane: 1, pose: "run", z: 0, halfDepth: 0.5 }, overrides || {});
}

test("mỗi loại chướng ngại chỉ bị vượt bởi đúng tư thế của nó", async function () {
	var Collision = await loadClientModule("systems/Collision.ts");

	// Rào thấp: nhảy qua được, trượt thì KHÔNG (rào vẫn cao hơn người đang trượt).
	assert.equal(Collision.poseClears("low", "jump"), true);
	assert.equal(Collision.poseClears("low", "slide"), false);
	assert.equal(Collision.poseClears("low", "run"), false);

	// Rào cao có khe dưới: trượt qua được, nhảy là đâm thẳng vào.
	assert.equal(Collision.poseClears("high", "slide"), true);
	assert.equal(Collision.poseClears("high", "jump"), false);
	assert.equal(Collision.poseClears("high", "run"), false);

	// Khối chặn cả làn: không tư thế nào cứu được, chỉ còn cách đổi làn.
	assert.equal(Collision.poseClears("full", "jump"), false);
	assert.equal(Collision.poseClears("full", "slide"), false);
	assert.equal(Collision.poseClears("full", "run"), false);
});

test("va chạm chỉ tính khi cùng làn VÀ chồng khoảng z VÀ sai tư thế", async function () {
	var Collision = await loadClientModule("systems/Collision.ts");
	var bands = [band(1, "low", -0.4, 0.4)];

	assert.notEqual(Collision.findCollision(player({ pose: "run" }), bands), null, "chạy thẳng vào rào thấp phải trúng");
	assert.equal(Collision.findCollision(player({ pose: "jump" }), bands), null, "nhảy thì thoát");
	assert.equal(Collision.findCollision(player({ lane: 0, targetLane: 0 }), bands), null, "khác làn thì không trúng");
	assert.equal(Collision.findCollision(player({ z: 20 }), bands), null, "chưa tới nơi thì không trúng");

	// Đã tiêu thụ thì không tính lần hai (tránh mất 3 tim trong 1 cú đâm).
	var consumed = [Object.assign(band(1, "low", -0.4, 0.4), { consumed: true })];
	assert.equal(Collision.findCollision(player(), consumed), null);
});

test("đang tween đổi làn thì chiếm CẢ HAI làn", async function () {
	var Collision = await loadClientModule("systems/Collision.ts");
	var tweening = player({ lane: 1, targetLane: 2 });

	assert.deepEqual(Collision.occupiedLanes(tweening), [1, 2]);
	assert.notEqual(
		Collision.findCollision(tweening, [band(2, "full", -0.4, 0.4)]),
		null,
		"đang lướt sang làn 2 mà làn 2 bị chặn thì phải trúng, không được 'lách' qua"
	);
	assert.notEqual(Collision.findCollision(tweening, [band(1, "full", -0.4, 0.4)]), null, "làn đang rời cũng vẫn tính");
});

test("luật công bằng: phát hiện đúng lát cắt không có lối thoát", async function () {
	var Collision = await loadClientModule("systems/Collision.ts");

	// Chặn cứng cả 3 làn = chết chắc.
	var deadly = [band(0, "full", -1, 1), band(1, "full", -1, 1), band(2, "full", -1, 1)];
	assert.equal(Collision.hasEscapeLane(deadly, 0, 3), false);

	// Một làn trống là đủ.
	assert.equal(Collision.hasEscapeLane([band(0, "full", -1, 1), band(1, "full", -1, 1)], 0, 3), true);

	// Làn có rào thấp vẫn qua được bằng nhảy.
	var jumpable = [band(0, "full", -1, 1), band(1, "low", -1, 1), band(2, "full", -1, 1)];
	assert.equal(Collision.hasEscapeLane(jumpable, 0, 3), true);

	// ⚠ Bẫy thiết kế: chồng rào thấp + rào cao trên CÙNG một làn thì không tư thế nào
	// qua nổi — phải bị coi là chết chắc y như chặn cứng.
	var impossible = [
		band(0, "full", -1, 1),
		band(1, "low", -1, 1),
		band(1, "high", -1, 1),
		band(2, "full", -1, 1)
	];
	assert.equal(Collision.hasEscapeLane(impossible, 0, 3), false);
});

test("distanceToNextObstacle đo đúng khoảng cách trong làn đang đứng", async function () {
	var Collision = await loadClientModule("systems/Collision.ts");
	var bands = [band(1, "full", -32, -30), band(1, "full", -12, -10), band(0, "full", -4, -2)];

	// Vật thể chạy về +z nên "phía trước" là z nhỏ hơn player.
	assert.equal(Collision.distanceToNextObstacle(player({ z: 0 }), bands), 10);
	assert.equal(Collision.distanceToNextObstacle(player({ lane: 2, targetLane: 2, z: 0 }), bands), Infinity);
});

test("PRNG có seed: cùng seed cho cùng chuỗi, khác seed cho khác chuỗi", async function () {
	var random = await loadClientModule("core/random.ts");

	var a = random.createSeededRandom(1337);
	var b = random.createSeededRandom(1337);
	var c = random.createSeededRandom(1338);

	var seriesA = [];
	var seriesB = [];
	var seriesC = [];

	for (var index = 0; index < 40; index += 1) {
		seriesA.push(a());
		seriesB.push(b());
		seriesC.push(c());
	}

	assert.deepEqual(seriesA, seriesB, "cùng seed phải tái lập y hệt — ván chơi lại được");
	assert.notDeepEqual(seriesA, seriesC);

	seriesA.forEach(function (value) {
		assert.ok(value >= 0 && value < 1, "giá trị phải nằm trong [0,1): " + value);
	});
});

test("tiện ích random: range/int/pick/shuffle đều nằm trong biên", async function () {
	var random = await loadClientModule("core/random.ts");
	var next = random.createSeededRandom(7);

	for (var index = 0; index < 200; index += 1) {
		var value = random.randomRange(next, 5, 9);
		assert.ok(value >= 5 && value < 9);

		var integer = random.randomInt(next, 0, 2);
		assert.ok(integer === 0 || integer === 1 || integer === 2);
	}

	assert.equal(random.randomPick(next, []), undefined, "mảng rỗng phải trả undefined, không được ném lỗi");

	var items = [1, 2, 3, 4, 5, 6, 7, 8];
	var shuffled = random.shuffleInPlace(random.createSeededRandom(9), items.slice());
	assert.deepEqual(shuffled.slice().sort(function (x, y) { return x - y; }), items, "shuffle không được làm mất phần tử");
});

test("curveOffsetAt khớp công thức shader và tắt được bằng tuning", async function () {
	// Nạp chung 1 bundle: CurvedWorld và tuning phải là CÙNG một instance, y như
	// khi Vite đóng gói — nếu tách bundle thì mỗi bên có bản sao tuning riêng.
	var mods = await loadClientBundle({ curve: "fx/CurvedWorld.ts", tuningModule: "tuning.ts" });
	var CurvedWorld = mods.curve;
	var TuningModule = mods.tuningModule;

	var offset = CurvedWorld.curveOffsetAt(100);
	assert.ok(offset.y < 0, "thế giới phải cong XUỐNG khi ra xa");
	assert.ok(Math.abs(offset.y) < 20, "ở 100 unit độ rơi phải ở mức chục unit, đang là " + offset.y);

	// Bậc 2: gấp đôi khoảng cách thì offset gấp 4.
	var near = CurvedWorld.curveOffsetAt(50);
	assert.ok(Math.abs(offset.y / near.y - 4) < 0.001, "phải là hàm bậc 2 theo khoảng cách");

	TuningModule.setTuningValue("curvedWorld.enabled", 0);
	assert.deepEqual(CurvedWorld.curveOffsetAt(100), { x: 0, y: 0 }, "tắt trong tuning là phẳng hoàn toàn");
	TuningModule.setTuningValue("curvedWorld.enabled", 1);
});
