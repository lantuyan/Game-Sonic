"use strict";

// P2-2 — SKIN/TRAIL, ĐỒNG HỒ CHẬM, VỆT CHẠY.
//
// Bốn thứ được canh ở đây, theo thứ tự mức độ nguy hiểm nếu sai:
//
//   1. HAI CÁI PHANH THẾ GIỚI. Boss Gate/hồi sinh ĐẶT `worldSpeedFactor`; Đồng hồ
//      chậm là hệ số NHÂN riêng. Nếu cả hai cùng ghi một biến thì hết Đồng hồ chậm
//      giữa lúc modal boss đang mở sẽ đặt lại 1 và thế giới lao đi sau lưng đề bài.
//   2. Đồng hồ chậm KHÔNG được cho ra 0 — đó là đường trở lại của lỗi treo vĩnh
//      viễn mà `engine.timeScale = 0` từng gây ra (ghi ở P1-1).
//   3. Tiền: mua ngoại hình phải trừ ví ĐÚNG một lần, và không mặc được đồ chưa mua.
//   4. Vệt chạy là đường nóng nhất của gói này — cấm cấp phát trong game loop.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");
var helpers = require("../test-helpers/clientModule");
var loadClientBundle = helpers.loadClientBundle;

var rootDir = path.resolve(__dirname, "..");

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
		rules: "systems/cosmeticRules.ts",
		Unlocks: "systems/Unlocks.ts",
		unlockRules: "systems/unlockRules.ts",
		SaveData: "core/SaveData.ts",
		keys: "core/storageKeys.ts",
		worldSpeed: "systems/worldSpeed.ts",
		Powerup: "systems/Powerup.ts",
		trailPath: "fx/trailPath.ts",
		tuningModule: "tuning.ts"
	});
}

function reset(mods, coins) {
	store.clear();
	mods.SaveData.saveWallet(Object.assign({}, mods.SaveData.DEFAULT_WALLET, { coins: coins || 0 }));
}

// --- 1. Bảng ngoại hình -------------------------------------------------------

test("mỗi ô (skin/trail) có đúng MỘT món mặc định giá 0", async function () {
	var mods = await loadModules();

	["skin", "trail"].forEach(function (slot) {
		var free = mods.rules.cosmeticsForSlot(slot).filter(function (item) {
			return item.price === 0;
		});

		assert.equal(free.length, 1, "ô " + slot + " phải có đúng 1 món miễn phí để luôn gỡ ra được");
		assert.equal(free[0].id, mods.rules.defaultCosmeticId(slot));
	});
});

test("giá ngoại hình rẻ hơn nhân vật rẻ nhất — trang trí không được cạnh tranh với nội dung", async function () {
	var mods = await loadModules();
	var cheapestCharacter = Math.min.apply(
		null,
		mods.unlockRules.UNLOCK_RULES.map(function (rule) {
			return rule.price;
		})
	);
	var priciestCosmetic = Math.max.apply(
		null,
		mods.rules.COSMETICS.map(function (item) {
			return item.price;
		})
	);

	assert.ok(
		priciestCosmetic < cheapestCharacter,
		"ngoại hình đắt nhất " + priciestCosmetic + " ≥ nhân vật rẻ nhất " + cheapestCharacter
	);
});

test("resolveEquipped rơi về mặc định với id rác, sai ô, hoặc chưa mua", async function () {
	var mods = await loadModules();
	var owned = ["trail-spark"];

	assert.equal(mods.rules.resolveEquipped("trail", "trail-spark", owned), "trail-spark");
	// Sai ô: trail nhét vào ô skin.
	assert.equal(mods.rules.resolveEquipped("skin", "trail-spark", owned), mods.rules.DEFAULT_SKIN_ID);
	// Chưa mua.
	assert.equal(mods.rules.resolveEquipped("trail", "trail-rainbow", owned), mods.rules.DEFAULT_TRAIL_ID);
	// Rác.
	assert.equal(mods.rules.resolveEquipped("skin", "khong-co-that", owned), mods.rules.DEFAULT_SKIN_ID);
	assert.equal(mods.rules.resolveEquipped("skin", null, owned), mods.rules.DEFAULT_SKIN_ID);
	// Món miễn phí thì không cần nằm trong danh sách sở hữu.
	assert.equal(mods.rules.resolveEquipped("skin", mods.rules.DEFAULT_SKIN_ID, []), mods.rules.DEFAULT_SKIN_ID);
});

// --- 2. Mua / trang bị --------------------------------------------------------

test("mua ngoại hình trừ ví ĐÚNG một lần và mặc luôn", async function () {
	var mods = await loadModules();
	reset(mods, 500);

	var unlocks = new mods.Unlocks.Unlocks();
	var result = unlocks.purchaseCosmetic("trail-spark");

	assert.equal(result.ok, true);
	var price = mods.rules.getCosmetic("trail-spark").price;
	assert.equal(result.paidCoins, price);
	assert.equal(mods.SaveData.loadWallet().coins, 500 - price);
	assert.equal(unlocks.equipped("trail"), "trail-spark", "mua xong phải mặc luôn");

	// Mua lại không được trừ thêm đồng nào.
	var again = unlocks.purchaseCosmetic("trail-spark");
	assert.equal(again.ok, false);
	assert.equal(again.reason, "already-owned");
	assert.equal(mods.SaveData.loadWallet().coins, 500 - price);
});

test("không đủ xu → KHÔNG mua, KHÔNG trừ, KHÔNG mặc", async function () {
	var mods = await loadModules();
	reset(mods, 50);

	var unlocks = new mods.Unlocks.Unlocks();
	var result = unlocks.purchaseCosmetic("trail-rainbow");

	assert.equal(result.ok, false);
	assert.equal(result.reason, "not-enough-coins");
	assert.equal(mods.SaveData.loadWallet().coins, 50);
	assert.equal(unlocks.equipped("trail"), mods.rules.DEFAULT_TRAIL_ID);
});

test("KHÔNG mặc được món chưa mua, kể cả gọi thẳng equip()", async function () {
	var mods = await loadModules();
	reset(mods, 0);

	var unlocks = new mods.Unlocks.Unlocks();

	assert.equal(unlocks.equip("skin-neon"), false, "chặn phải nằm ở Unlocks, không phải ở UI");
	assert.equal(unlocks.equipped("skin"), mods.rules.DEFAULT_SKIN_ID);
	// Món miễn phí thì mặc được ngay.
	assert.equal(unlocks.equip(mods.rules.DEFAULT_SKIN_ID), true);
});

test("ngoại hình sống sót qua lần mở game sau, và gỡ ra được", async function () {
	var mods = await loadModules();
	reset(mods, 500);

	new mods.Unlocks.Unlocks().purchaseCosmetic("skin-gold");

	var reopened = new mods.Unlocks.Unlocks();
	assert.equal(reopened.equipped("skin"), "skin-gold");

	reopened.unequip("skin");
	assert.equal(new mods.Unlocks.Unlocks().equipped("skin"), mods.rules.DEFAULT_SKIN_ID);
	assert.equal(
		new mods.Unlocks.Unlocks().ownsCosmetic("skin-gold"),
		true,
		"gỡ ra không được làm mất món đã mua"
	);
});

test("sửa tay localStorage để 'sở hữu' ngoại hình chưa mua thì bị chữ ký bắt", async function () {
	var mods = await loadModules();
	reset(mods, 0);

	var raw = JSON.parse(JSON.stringify(mods.SaveData.DEFAULT_UNLOCKS));
	raw.cosmetics = ["skin-neon", "trail-rainbow"];
	raw.cosmeticSignature = "bia-dat";
	raw.equippedSkin = "skin-neon";
	store.set(mods.keys.V2_STORAGE_KEYS.unlocks, JSON.stringify(raw));

	var unlocks = new mods.Unlocks.Unlocks();
	assert.equal(unlocks.ownsCosmetic("skin-neon"), false);
	assert.equal(unlocks.equipped("skin"), mods.rules.DEFAULT_SKIN_ID);
});

test("chữ ký ngoại hình ĐỘC LẬP với chữ ký nhân vật — hỏng cái này không mất cái kia", async function () {
	var mods = await loadModules();
	reset(mods, 2000);

	var unlocks = new mods.Unlocks.Unlocks();
	unlocks.purchase("mage");
	unlocks.purchaseCosmetic("skin-gold");

	var raw = JSON.parse(store.get(mods.keys.V2_STORAGE_KEYS.unlocks));
	raw.cosmeticSignature = "hong";
	store.set(mods.keys.V2_STORAGE_KEYS.unlocks, JSON.stringify(raw));

	var reopened = new mods.Unlocks.Unlocks();
	assert.equal(reopened.ownsCosmetic("skin-gold"), false, "ngoại hình bị sửa tay thì mất");
	assert.equal(reopened.isUnlocked("mage"), true, "nhưng nhân vật đã mua thì KHÔNG được mất theo");
});

test("Unlocks là NƠI DUY NHẤT chạm ví cho ngoại hình", function () {
	var menus = fs.readFileSync(path.join(rootDir, "client", "src", "ui", "screens", "MenuScreens.ts"), "utf8");
	var cosmeticRules = fs.readFileSync(path.join(rootDir, "client", "src", "systems", "cosmeticRules.ts"), "utf8");

	// Chỉ soi thân class ShopScreen: S8 Game over vẫn ghi ví theo đúng luồng P0.
	var shop = menus.slice(menus.indexOf("export class ShopScreen"), menus.indexOf("// --- S7 Pause"));

	assert.notEqual(shop.length, 0, "không tìm thấy ShopScreen — test này phải được sửa theo");
	assert.equal(/saveWallet\s*\(/.test(shop), false, "màn Cửa hàng đang tự ghi ví — phải đi qua Unlocks");
	assert.equal(
		/saveWallet|window\.localStorage|import .* from/.test(cosmeticRules),
		false,
		"cosmeticRules phải THUẦN: không chạm ví, không chạm kho, không import gì cả"
	);
});

// --- 3. Hợp thành tốc độ thế giới ---------------------------------------------

function speedInputs(mods, overrides) {
	return Object.assign(
		{
			speedFactor: 1,
			unitsPerSecondAtOne: mods.tuningModule.tuning.speed.unitsPerSecondAtOne,
			brakeFactor: 1,
			practiceFactor: 1,
			boostFactor: 1,
			slowClockFactor: 1
		},
		overrides || {}
	);
}

test("phanh boss = 0 thì thế giới đứng im, dù Đồng hồ chậm và Tăng tốc cùng bật", async function () {
	var mods = await loadModules();

	assert.equal(
		mods.worldSpeed.worldSpeedUnitsPerSec(
			speedInputs(mods, { brakeFactor: 0, slowClockFactor: 0.55, boostFactor: 1.35 })
		),
		0
	);
});

test("Đồng hồ chậm làm chậm chứ KHÔNG BAO GIỜ dừng thế giới", async function () {
	var mods = await loadModules();
	var normal = mods.worldSpeed.worldSpeedUnitsPerSec(speedInputs(mods, {}));
	var slowed = mods.worldSpeed.worldSpeedUnitsPerSec(speedInputs(mods, { slowClockFactor: 0.55 }));

	assert.ok(slowed < normal, "phải chậm hơn");
	assert.ok(slowed > 0, "đứng im là đường trở lại của lỗi treo vòng lặp — cấm tuyệt đối");
});

test("Đồng hồ chậm và phanh boss là HAI biến khác nhau (canh mã nguồn)", function () {
	var run = fs.readFileSync(path.join(rootDir, "client", "src", "scenes", "RunScene.ts"), "utf8");
	var assignments = run.match(/this\.worldSpeedFactor\s*(=|\+=)/g) || [];

	assert.ok(assignments.length > 0, "không tìm thấy phanh thế giới — test này phải được sửa theo");

	// Mọi lệnh gán `worldSpeedFactor` phải nằm trong updateBoss/updateRevival/reset,
	// KHÔNG được có lệnh nào mang tên slow clock.
	assert.equal(
		/worldSpeedFactor\s*[*]?=\s*[^;]*slow/i.test(run),
		false,
		"Đồng hồ chậm đang ghi vào phanh của Boss Gate — đúng cái bẫy mà P2-2 phải tránh"
	);
	assert.ok(
		run.includes("slowClockFactor: this.powerups.worldSlowFactor"),
		"Đồng hồ chậm phải đi qua hàm hợp thành thuần worldSpeedUnitsPerSec"
	);
	// Bỏ dòng chú thích trước khi soi: chính các cảnh báo "KHÔNG dùng timeScale = 0"
	// là thứ chứa chuỗi đó nhiều nhất.
	var code = run
		.split("\n")
		.filter(function (line) {
			var trimmed = line.trim();
			return trimmed.startsWith("//") === false && trimmed.startsWith("*") === false;
		})
		.join("\n");

	assert.equal(
		/engine\.timeScale\s*=\s*0\s*;/.test(code),
		false,
		"timeScale 0 treo vòng lặp vĩnh viễn (bài học P1-1)"
	);
});

test("isWorldRunning coi phanh đang trôi về 0 là ĐÃ đứng", async function () {
	var mods = await loadModules();

	assert.equal(mods.worldSpeed.isWorldRunning(1), true);
	assert.equal(mods.worldSpeed.isWorldRunning(0), false);
	assert.equal(mods.worldSpeed.isWorldRunning(0.003), false, "0.003 nhìn ra là đứng im");
});

// --- 4. Đồng hồ chậm trong hệ power-up ----------------------------------------

test("Đồng hồ chậm: hệ số <1 khi bật, đúng 1 khi tắt", async function () {
	var mods = await loadModules();
	var powerups = new mods.Powerup.Powerups();

	assert.equal(powerups.worldSlowFactor, 1);
	powerups.collect("slowClock");
	assert.ok(powerups.worldSlowFactor < 1 && powerups.worldSlowFactor > 0);

	powerups.update(mods.tuningModule.tuning.powerup.slowClockSec + 0.1);
	assert.equal(powerups.worldSlowFactor, 1, "hết giờ phải trả thế giới về bình thường");
});

test("Đồng hồ chậm KHÔNG hao khi thế giới đóng băng (modal boss / câu hồi sinh)", async function () {
	var mods = await loadModules();
	var powerups = new mods.Powerup.Powerups();
	var duration = mods.tuningModule.tuning.powerup.slowClockSec;

	powerups.collect("slowClock");

	// 30 giây đóng băng — dài hơn cả câu hỏi của trùm.
	for (var index = 0; index < 30; index += 1) {
		powerups.update(1, false);
	}

	assert.equal(powerups.isActive("slowClock"), true, "6 giây quà tặng bốc hơi trong lúc đọc đề là lỗi");
	assert.ok(Math.abs(powerups.remaining("slowClock") - duration) < 1e-9);

	powerups.update(duration + 0.1, true);
	assert.equal(powerups.isActive("slowClock"), false);
});

test("power-up cũ KHÔNG đổi cách đếm giờ — P0-8/P1-5 giữ nguyên cân bằng", async function () {
	var mods = await loadModules();
	var powerups = new mods.Powerup.Powerups();

	powerups.collect("magnet");
	powerups.collect("doublePoints");
	powerups.collect("speedBoost");
	powerups.update(2, false);

	var magnetSec = mods.tuningModule.tuning.powerup.magnetSec;
	assert.ok(
		Math.abs(powerups.remaining("magnet") - (magnetSec - 2)) < 1e-9,
		"Magnet vẫn phải đếm theo đồng hồ thật kể cả lúc thế giới đứng"
	);
	assert.equal(mods.Powerup.POWERUP_WORLD_TIME_KINDS.slowClock, true);
	assert.equal(mods.Powerup.POWERUP_WORLD_TIME_KINDS.magnet, false);
});

// --- 5. Bộ đệm vệt chạy -------------------------------------------------------

test("TrailPath: điểm lùi ra sau đúng bằng quãng đường đã đi", async function () {
	var mods = await loadModules();
	var trail = new mods.trailPath.TrailPath(32);

	// Sinh điểm đầu tiên rồi chạy thêm 3 unit.
	trail.update(0, 0, 0, 0.5, 9);
	assert.equal(trail.length, 1);

	for (var index = 0; index < 6; index += 1) {
		trail.update(0.5, 0, 0, 0.5, 9);
	}

	assert.equal(trail.length, 7, "6 unit / 0.5 = 6 điểm mới");
	assert.ok(Math.abs(trail.pointZ(0)) < 1e-6, "điểm mới nhất luôn dính chân player");
	assert.ok(Math.abs(trail.pointZ(6) - 3) < 1e-6, "điểm cũ nhất lùi đúng 3 unit");
});

test("TrailPath: cắt đuôi theo chiều dài tối đa, không phình quá sức chứa", async function () {
	var mods = await loadModules();
	var trail = new mods.trailPath.TrailPath(24);

	for (var index = 0; index < 500; index += 1) {
		trail.update(0.5, index % 3, 0, 0.5, 4);
	}

	assert.ok(trail.length <= 24, "vượt sức chứa là ghi đè bộ nhớ của chính mình");
	assert.ok(trail.pointZ(trail.length - 1) <= 4 + 1e-6, "đuôi dài hơn trần đã đặt");
	assert.ok(trail.length >= 8, "vệt 4 unit / bước 0.5 phải giữ được ~8 điểm");
});

test("TrailPath: điểm mới nhất bám theo player giữa hai lần sinh điểm", async function () {
	var mods = await loadModules();
	var trail = new mods.trailPath.TrailPath(16);

	trail.update(0, 0, 0, 1, 9);
	// Chưa đủ 1 unit để sinh điểm mới, nhưng player vừa lạng sang làn khác.
	trail.update(0.2, 2.3, 0.5, 1, 9);

	assert.equal(trail.length, 1);
	assert.ok(Math.abs(trail.pointX(0) - 2.3) < 1e-6, "đuôi vệt phải dính chân, không giật từng nấc");
	assert.ok(Math.abs(trail.pointY(0) - 0.5) < 1e-6);
});

test("TrailPath: chỉ số ngoài dải trả 0 thay vì ném giữa game loop", async function () {
	var mods = await loadModules();
	var trail = new mods.trailPath.TrailPath(8);

	assert.equal(trail.pointX(0), 0);
	assert.equal(trail.pointY(99), 0);
	assert.equal(trail.pointZ(-1), 0);
});

test("vệt chạy không cấp phát trong game loop (quy tắc vàng #6)", function () {
	var pathSource = fs.readFileSync(path.join(rootDir, "client", "src", "fx", "trailPath.ts"), "utf8");
	var trailSource = fs.readFileSync(path.join(rootDir, "client", "src", "fx", "Trail.ts"), "utf8");

	var hotPath = pathSource.slice(pathSource.indexOf("\tupdate("));
	assert.equal(/\bnew [A-Z]/.test(hotPath), false, "TrailPath.update đang cấp phát");
	assert.equal(/\[\s*\]|\{\s*\}/.test(hotPath), false, "TrailPath.update đang tạo mảng/object");

	var trailUpdate = trailSource.slice(
		trailSource.indexOf("\tupdate(advanceUnits"),
		trailSource.indexOf("\tdispose()")
	);
	assert.notEqual(trailUpdate.length, 0, "không tìm thấy Trail.update — test này phải được sửa theo");
	assert.equal(/\bnew [A-Z]/.test(trailUpdate), false, "Trail.update đang cấp phát mỗi frame");
	assert.ok(
		trailSource.includes("setDrawRange"),
		"vệt ngắn phải cắt bằng setDrawRange chứ không dựng lại geometry"
	);
	assert.ok(
		trailSource.includes("new Float32Array") && trailSource.includes("constructor()"),
		"bộ đệm phải cấp phát một lần trong constructor"
	);
});

test("dải ruy-băng phải là DoubleSide — nếu không nó bị cull và biến mất lặng lẽ", function () {
	var trailSource = fs.readFileSync(path.join(rootDir, "client", "src", "fx", "Trail.ts"), "utf8");

	// Lỗi này đã xảy ra thật khi làm P2-2: dải nằm ngang trong mặt phẳng XZ, thứ tự
	// đỉnh cho pháp tuyến hướng XUỐNG, nên với FrontSide mặc định camera (ở trên)
	// chỉ thấy mặt sau. Không lỗi console, không cảnh báo — chỉ là không có gì cả.
	assert.ok(trailSource.includes("side: DoubleSide"), "Trail đang dùng mặt mặc định — vệt sẽ vô hình");
	assert.ok(trailSource.includes("frustumCulled = false"), "vệt dài cả chục unit sẽ bị cắt nhầm khi đổi làn");
});

// --- 6. Không thêm asset ------------------------------------------------------

test("skin làm bằng MÀU, không phải model mới — không thêm một byte tải về nào", async function () {
	var mods = await loadModules();
	var source = fs.readFileSync(path.join(rootDir, "client", "src", "systems", "cosmeticRules.ts"), "utf8");

	assert.equal(/\.glb|\.png|models\//.test(source), false, "bảng ngoại hình đang trỏ tới file asset");

	mods.rules.COSMETICS.forEach(function (item) {
		assert.equal(typeof item.color, "number", item.id + " phải định nghĩa bằng màu");
		assert.ok(item.color >= 0 && item.color <= 0xffffff, item.id + " màu ngoài dải 0xRRGGBB");
	});
});
