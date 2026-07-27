"use strict";

// P1-3 — SHOP + MỞ KHOÁ. DoD nói hai điều, test này canh đúng hai điều đó:
//   (a) CẢ HAI đường mở khoá đều hoạt động — mua bằng xu, và đạt mốc thành tích;
//   (b) không mua được "dễ dàng" bằng cách sửa localStorage/console.
//
// Cộng thêm những chỗ dễ mất tiền oan của học sinh: mua khi đã đạt mốc (phải
// miễn phí), mua hai lần, mua khi không đủ xu.

var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("../test-helpers/clientModule");
var loadClientBundle = helpers.loadClientBundle;

/**
 * MỘT localStorage giả DUY NHẤT, cài TRƯỚC mọi lần nạp module.
 *
 * `core/SaveData` chụp `window.localStorage` ngay lúc module được đánh giá và
 * module thì được cache — cài stub sau lần nạp đầu là vô tác dụng (đã vấp đúng
 * bẫy này ở P0-10).
 */
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
		Unlocks: "systems/Unlocks.ts",
		rules: "systems/unlockRules.ts",
		SaveData: "core/SaveData.ts",
		keys: "core/storageKeys.ts"
	});
}

function reset(mods, coins) {
	store.clear();
	mods.SaveData.saveWallet(Object.assign({}, mods.SaveData.DEFAULT_WALLET, { coins: coins || 0 }));
}

// --- Luật thuần --------------------------------------------------------------

test("mỗi nhân vật khoá có ĐỦ hai đường mở, giá 300/500/800 xu", async function () {
	var mods = await loadModules();

	assert.equal(mods.rules.UNLOCK_RULES.length, 3, "P1-3 mở 3 nhân vật");
	assert.deepEqual(
		mods.rules.UNLOCK_RULES.map(function (rule) {
			return rule.price;
		}),
		[300, 500, 800]
	);

	mods.rules.UNLOCK_RULES.forEach(function (rule) {
		assert.ok(rule.achievement != null, rule.characterId + " thiếu đường thành tích");
		assert.ok(
			typeof rule.achievementLabel === "string" && rule.achievementLabel.length > 0,
			rule.characterId + ": phải mô tả mốc bằng tiếng Việt cho học sinh đọc"
		);
	});
});

test("4 nhân vật P0 KHÔNG bao giờ bị khoá", async function () {
	var mods = await loadModules();

	["knight", "robot", "fox", "parrot"].forEach(function (id) {
		assert.equal(mods.rules.isLockable(id), false, id + " là nhân vật P0, không được khoá");
		assert.equal(mods.rules.evaluateUnlock(id, [], mods.rules.DEFAULT_UNLOCK_PROGRESS).status, "free");
		assert.equal(mods.rules.canPlay(id, []), true);
	});
});

test("thành tích được xét TRƯỚC xu — đã xứng đáng thì không bắt trả tiền", async function () {
	var mods = await loadModules();

	// Đủ cả xu lẫn mốc thành tích: phải ra "claimable" (miễn phí), không phải "affordable".
	var state = mods.rules.evaluateUnlock("mage", [], {
		coins: 100000,
		gamesPlayed: 0,
		correctAnswers: 50,
		bestLeaderboardRank: null
	});

	assert.equal(state.status, "claimable");
});

test("mốc top-10 tính theo hạng NHỎ hơn là tốt hơn", async function () {
	var mods = await loadModules();
	var condition = { kind: "leaderboardTop", amount: 10 };

	assert.equal(mods.rules.meetsAchievement(condition, { coins: 0, gamesPlayed: 0, correctAnswers: 0, bestLeaderboardRank: 3 }), true);
	assert.equal(mods.rules.meetsAchievement(condition, { coins: 0, gamesPlayed: 0, correctAnswers: 0, bestLeaderboardRank: 10 }), true);
	assert.equal(mods.rules.meetsAchievement(condition, { coins: 0, gamesPlayed: 0, correctAnswers: 0, bestLeaderboardRank: 11 }), false);
	assert.equal(mods.rules.meetsAchievement(condition, { coins: 0, gamesPlayed: 0, correctAnswers: 0, bestLeaderboardRank: null }), false);
});

// --- Đường 1: mua bằng xu ----------------------------------------------------

test("mua bằng xu: trừ ĐÚNG giá, mở đúng nhân vật, lưu lại được", async function () {
	var mods = await loadModules();
	reset(mods, 500);

	var unlocks = new mods.Unlocks.Unlocks();
	assert.equal(unlocks.isUnlocked("mage"), false);

	var result = unlocks.purchase("mage");

	assert.equal(result.ok, true);
	assert.equal(result.paidCoins, 300);
	assert.equal(mods.SaveData.loadWallet().coins, 200, "phải trừ đúng 300 xu");
	assert.equal(unlocks.isUnlocked("mage"), true);

	// Phiên sau đọc lại vẫn thấy đã mở.
	assert.equal(new mods.Unlocks.Unlocks().isUnlocked("mage"), true);
});

test("không đủ xu → từ chối và KHÔNG trừ xu nào", async function () {
	var mods = await loadModules();
	reset(mods, 299);

	var unlocks = new mods.Unlocks.Unlocks();
	var result = unlocks.purchase("mage");

	assert.equal(result.ok, false);
	assert.equal(result.reason, "not-enough-coins");
	assert.equal(mods.SaveData.loadWallet().coins, 299, "từ chối rồi thì tuyệt đối không được trừ xu");
	assert.equal(unlocks.isUnlocked("mage"), false);
});

test("mua lần thứ hai không được trừ thêm xu", async function () {
	var mods = await loadModules();
	reset(mods, 1000);

	var unlocks = new mods.Unlocks.Unlocks();
	unlocks.purchase("mage");
	var after = mods.SaveData.loadWallet().coins;

	var again = unlocks.purchase("mage");
	assert.equal(again.ok, false);
	assert.equal(again.reason, "already-unlocked");
	assert.equal(mods.SaveData.loadWallet().coins, after, "mua lại lần hai mà vẫn trừ xu là ăn cắp của học sinh");
});

test("nhân vật không có trong bảng → từ chối gọn", async function () {
	var mods = await loadModules();
	reset(mods, 5000);

	var result = new mods.Unlocks.Unlocks().purchase("khong-ton-tai");
	assert.equal(result.ok, false);
	assert.equal(result.reason, "unknown-character");
	assert.equal(mods.SaveData.loadWallet().coins, 5000);
});

// --- Đường 2: mốc thành tích -------------------------------------------------

test("đạt mốc số câu đúng → tự mở khoá sau ván, KHÔNG tốn xu", async function () {
	var mods = await loadModules();
	reset(mods, 0);

	var unlocks = new mods.Unlocks.Unlocks();

	// 5 ván × 10 câu đúng = 50 → chạm mốc của Pháp sư.
	var newlyUnlocked = [];

	for (var index = 0; index < 5; index += 1) {
		newlyUnlocked = unlocks.recordGame({ correctAnswers: 10 });
	}

	assert.deepEqual(newlyUnlocked, ["mage"], "ván cuối phải báo đúng nhân vật vừa mở");
	assert.equal(unlocks.isUnlocked("mage"), true);
	assert.equal(mods.SaveData.loadWallet().coins, 0, "đường thành tích không được tốn xu");
});

test("đạt mốc số ván → mở Trinh sát", async function () {
	var mods = await loadModules();
	reset(mods, 0);

	var unlocks = new mods.Unlocks.Unlocks();

	for (var index = 0; index < 10; index += 1) {
		unlocks.recordGame({ correctAnswers: 0 });
	}

	assert.equal(unlocks.isUnlocked("rogue"), true);
	assert.equal(unlocks.isUnlocked("barbarian"), false, "chưa lên top 10 thì chưa mở Chiến binh");
});

test("một lần lọt top 10 → mở Chiến binh, và hạng tốt nhất được giữ lại", async function () {
	var mods = await loadModules();
	reset(mods, 0);

	var unlocks = new mods.Unlocks.Unlocks();

	assert.deepEqual(unlocks.recordGame({ correctAnswers: 1, leaderboardRank: 40 }), []);
	assert.deepEqual(unlocks.recordGame({ correctAnswers: 1, leaderboardRank: 7 }), ["barbarian"]);

	// Tụt hạng ở ván sau KHÔNG được lấy lại nhân vật đã trao.
	unlocks.recordGame({ correctAnswers: 1, leaderboardRank: 99 });
	assert.equal(unlocks.isUnlocked("barbarian"), true);
	assert.equal(unlocks.progress.bestLeaderboardRank, 7);
});

test("bấm MUA khi đã đạt mốc thì miễn phí", async function () {
	var mods = await loadModules();
	reset(mods, 1000);

	// Tình huống thật: đã đủ 50 câu đúng nhưng CHƯA nhận (vd bản cũ chưa có mốc này,
	// hoặc người chơi mở Cửa hàng trước khi ván kết thúc kịp ghi nhận).
	store.set(
		"endlessrunner-unlocks-v2",
		JSON.stringify({ unlocked: [], gamesPlayed: 5, correctAnswers: 50, bestLeaderboardRank: null, signature: "" })
	);

	var unlocks = new mods.Unlocks.Unlocks();
	assert.equal(unlocks.evaluate("mage").status, "claimable");

	var result = unlocks.purchase("mage");
	assert.equal(result.ok, true);
	assert.equal(result.paidCoins, 0, "đủ mốc rồi thì bấm MUA cũng không được trừ xu");
	assert.equal(mods.SaveData.loadWallet().coins, 1000);
});

// --- (b) Không mở khoá "dễ dàng" bằng cách sửa tay ---------------------------

test("sửa tay localStorage để mở hết nhân vật thì KHÔNG ăn (DoD P1-3b)", async function () {
	var mods = await loadModules();
	reset(mods, 0);

	// Đúng thao tác mà một học sinh tò mò sẽ làm trong console.
	store.set(
		"endlessrunner-unlocks-v2",
		JSON.stringify({
			unlocked: ["mage", "rogue", "barbarian"],
			gamesPlayed: 0,
			correctAnswers: 0,
			bestLeaderboardRank: null,
			signature: ""
		})
	);

	var unlocks = new mods.Unlocks.Unlocks();

	assert.deepEqual(unlocks.unlockedIds, [], "danh sách không có chữ ký hợp lệ phải bị bỏ qua");
	assert.equal(unlocks.isUnlocked("mage"), false);
});

test("chữ ký sai → mất nhân vật, nhưng GIỮ thành tích học tập", async function () {
	var mods = await loadModules();
	reset(mods, 0);

	store.set(
		"endlessrunner-unlocks-v2",
		JSON.stringify({
			unlocked: ["barbarian"],
			gamesPlayed: 9,
			correctAnswers: 44,
			bestLeaderboardRank: 12,
			signature: "rac"
		})
	);

	var unlocks = new mods.Unlocks.Unlocks();

	assert.deepEqual(unlocks.unlockedIds, []);
	// Số ván / số câu đúng là công sức học thật, không được xoá theo.
	assert.equal(unlocks.progress.gamesPlayed, 9);
	assert.equal(unlocks.progress.correctAnswers, 44);
	assert.equal(unlocks.progress.bestLeaderboardRank, 12);
});

test("chữ ký do chính game ghi thì luôn đọc lại được", async function () {
	var mods = await loadModules();
	reset(mods, 300);

	new mods.Unlocks.Unlocks().purchase("mage");

	var raw = JSON.parse(store.get("endlessrunner-unlocks-v2"));
	assert.deepEqual(raw.unlocked, ["mage"]);
	assert.equal(mods.rules.verifyUnlocks(raw.unlocked, raw.signature), true);

	// Thêm tay một nhân vật vào danh sách đã ký → chữ ký hết hợp lệ.
	raw.unlocked.push("barbarian");
	assert.equal(mods.rules.verifyUnlocks(raw.unlocked, raw.signature), false);
});

test("chữ ký không phụ thuộc thứ tự phần tử", async function () {
	var mods = await loadModules();

	assert.equal(
		mods.rules.signUnlocks(["mage", "rogue"]),
		mods.rules.signUnlocks(["rogue", "mage"]),
		"đổi thứ tự mảng không được làm mất nhân vật của người chơi"
	);
});

test("khoá lưu trữ đúng hậu tố -v2 (quy tắc vàng #2)", async function () {
	var mods = await loadModules();

	assert.equal(mods.keys.V2_STORAGE_KEYS.unlocks, "endlessrunner-unlocks-v2");
	assert.ok(mods.keys.V2_STORAGE_KEYS.unlocks.endsWith("-v2"));
});

test("nhân vật khoá KHÔNG nằm trong precache lúc cài", async function () {
	// ~850KB cho 3 nhân vật mà phần lớn học sinh chưa mở — bắt tải ngay lúc cài là
	// phí băng thông ở đúng nơi băng thông đắt nhất (phòng máy trường).
	var fs = require("fs");
	var path = require("path");
	var mods = await loadModules();
	var viteConfig = fs.readFileSync(
		path.join(path.resolve(__dirname, ".."), "client", "vite.config.mts"),
		"utf8"
	);

	mods.rules.UNLOCK_RULES.forEach(function (rule) {
		assert.ok(
			viteConfig.indexOf(rule.characterId) !== -1,
			rule.characterId + " chưa có trong globIgnores của vite.config"
		);
	});

	// 4 nhân vật P0 thì NGƯỢC LẠI: phải luôn có sẵn, kể cả offline lần đầu.
	["knight", "robot", "fox", "parrot"].forEach(function (id) {
		assert.equal(
			viteConfig.indexOf("{mage,rogue,barbarian}") !== -1 && viteConfig.indexOf(id) !== -1,
			false,
			id + " (nhân vật P0) không được loại khỏi precache"
		);
	});
});
