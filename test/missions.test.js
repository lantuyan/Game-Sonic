"use strict";

// P1-8 — NHIỆM VỤ NGÀY, HUY HIỆU, HỒ SƠ, RUNG.
//
// DoD: đổi ngày hệ thống → nhiệm vụ mới; huy hiệu trao đúng mốc; S13 render từ dữ
// liệu thật; rung chỉ chạy trên Android + tắt được.
//
// Điều được canh kỹ nhất ở đây KHÔNG phải là chức năng mà là SỰ TỬ TẾ: nghỉ vài
// hôm không được mất huy hiệu, không được mất số câu đã học, và gãy chuỗi không
// bị phạt gì cả.

var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("../test-helpers/clientModule");
var loadClientBundle = helpers.loadClientBundle;

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
		rules: "systems/missionRules.ts",
		Missions: "systems/Missions.ts",
		SaveData: "core/SaveData.ts",
		keys: "core/storageKeys.ts",
		tuningModule: "tuning.ts"
	});
}

function reset(mods, coins) {
	store.clear();
	mods.SaveData.saveWallet(Object.assign({}, mods.SaveData.DEFAULT_WALLET, { coins: coins || 0 }));
}

function totals(overrides) {
	return Object.assign(
		{ correctAnswers: 0, distanceM: 0, coins: 0, nearMisses: 0, correctByDifficulty: {} },
		overrides || {}
	);
}

var DAY1 = new Date(2026, 6, 27, 10, 0, 0);
var DAY2 = new Date(2026, 6, 28, 10, 0, 0);
var DAY4 = new Date(2026, 6, 30, 10, 0, 0);

// --- Nhiệm vụ ngày -----------------------------------------------------------

test("sinh ĐÚNG 3 nhiệm vụ mỗi ngày, không trùng loại", async function () {
	var mods = await loadModules();
	var missions = mods.rules.generateDailyMissions("2026-07-27");

	assert.equal(missions.length, mods.tuningModule.tuning.missions.perDay);
	assert.equal(new Set(missions.map(function (m) { return m.id; })).size, 3, "3 nhiệm vụ phải khác nhau");

	missions.forEach(function (mission) {
		assert.ok(mission.target > 0);
		assert.ok(mission.reward > 0, "nhiệm vụ không thưởng gì thì không phải nhiệm vụ");
		assert.ok(typeof mission.label === "string" && mission.label.length > 0);
	});
});

test("nhiệm vụ TẤT ĐỊNH theo ngày — cả lớp nhận cùng một bộ", async function () {
	var mods = await loadModules();
	var first = mods.rules.generateDailyMissions("2026-07-27");
	var again = mods.rules.generateDailyMissions("2026-07-27");

	assert.deepEqual(first, again, "cùng ngày phải ra cùng bộ, dù gọi ở máy nào");

	var otherDay = mods.rules.generateDailyMissions("2026-07-28");
	assert.notDeepEqual(
		first.map(function (m) { return m.id; }),
		otherDay.map(function (m) { return m.id; }),
		"ngày khác phải ra bộ khác, nếu không thì 'nhiệm vụ ngày' vô nghĩa"
	);
});

test("ĐỔI NGÀY → nhiệm vụ mới và tiến độ về 0 (DoD)", async function () {
	var mods = await loadModules();
	reset(mods, 0);

	var missions = new mods.Missions.Missions();
	var day1 = missions.today(DAY1);

	missions.recordRun(totals({ correctAnswers: 3, distanceM: 500, coins: 20 }), DAY1);
	assert.ok(missions.today(DAY1).entries.some(function (e) { return e.progress > 0; }), "phải có tiến độ trong ngày");

	var day2 = missions.today(DAY2);

	assert.notEqual(day2.date, day1.date);
	assert.deepEqual(
		day2.entries.map(function (e) { return e.progress; }),
		[0, 0, 0],
		"sang ngày mới thì tiến độ về 0"
	);
});

test("hoàn thành nhiệm vụ trả thưởng ĐÚNG MỘT LẦN", async function () {
	var mods = await loadModules();
	reset(mods, 0);

	var missions = new mods.Missions.Missions();
	var daily = missions.today(DAY1);

	// Đập một phát thật to để chắc chắn xong hết mọi nhiệm vụ.
	var huge = totals({
		correctAnswers: 100,
		distanceM: 100000,
		coins: 10000,
		nearMisses: 100,
		correctByDifficulty: { easy: 100, medium: 100, hard: 100, expert: 100 }
	});

	var first = missions.recordRun(huge, DAY1);
	assert.equal(first.completedMissions.length, daily.missions.length);
	assert.ok(first.coinsAwarded > 0);
	assert.equal(mods.SaveData.loadWallet().coins, first.coinsAwarded, "xu thưởng phải vào ví");

	var second = missions.recordRun(huge, DAY1);
	assert.equal(second.completedMissions.length, 0, "nhiệm vụ đã xong không được thưởng lại");
	assert.equal(second.coinsAwarded, 0);
	assert.equal(mods.SaveData.loadWallet().coins, first.coinsAwarded);
});

test("tiến độ cộng dồn QUA NHIỀU VÁN trong cùng ngày", async function () {
	var mods = await loadModules();
	reset(mods, 0);

	var missions = new mods.Missions.Missions();
	var mission = missions.today(DAY1).missions.find(function (m) { return m.kind === "correctAnswers"; });

	if (mission === undefined) {
		// Bộ nhiệm vụ của ngày này không có loại đó — kiểm bằng công thức thay thế.
		assert.equal(mods.rules.missionDelta({ kind: "correctAnswers" }, totals({ correctAnswers: 4 })), 4);
		return;
	}

	for (var run = 0; run < mission.target; run += 1) {
		missions.recordRun(totals({ correctAnswers: 1 }), DAY1);
	}

	var entry = missions.today(DAY1).entries.find(function (e) { return e.id === mission.id; });
	assert.equal(entry.claimed, true, "gom đủ qua nhiều ván vẫn phải tính là xong");
});

test("missionDelta đọc đúng số liệu cho từng loại", async function () {
	var mods = await loadModules();
	var run = totals({
		correctAnswers: 7,
		distanceM: 1234.9,
		coins: 88,
		nearMisses: 5,
		correctByDifficulty: { hard: 3 }
	});

	assert.equal(mods.rules.missionDelta({ kind: "correctAnswers" }, run), 7);
	assert.equal(mods.rules.missionDelta({ kind: "distance" }, run), 1234, "mét làm tròn xuống");
	assert.equal(mods.rules.missionDelta({ kind: "coins" }, run), 88);
	assert.equal(mods.rules.missionDelta({ kind: "nearMiss" }, run), 5);
	assert.equal(mods.rules.missionDelta({ kind: "correctByDifficulty", difficulty: "hard" }, run), 3);
	assert.equal(mods.rules.missionDelta({ kind: "correctByDifficulty", difficulty: "expert" }, run), 0);
});

// --- Chuỗi ngày chăm chỉ -----------------------------------------------------

test("chuỗi ngày: +1 khi liền kề, giữ nguyên khi cùng ngày", async function () {
	var mods = await loadModules();
	var state = { lastDate: "", days: 0 };

	state = mods.rules.advanceStreak(state, "2026-07-27", "2026-07-26");
	assert.equal(state.days, 1);

	// Chơi thêm 10 ván trong cùng ngày vẫn là 1 ngày.
	state = mods.rules.advanceStreak(state, "2026-07-27", "2026-07-26");
	assert.equal(state.days, 1);

	state = mods.rules.advanceStreak(state, "2026-07-28", "2026-07-27");
	assert.equal(state.days, 2);
});

test("gãy chuỗi KHÔNG bị phạt — chỉ bắt đầu lại từ 1", async function () {
	var mods = await loadModules();
	var state = { lastDate: "2026-07-20", days: 5 };

	// Nghỉ một tuần (ốm, đi chơi, mất mạng…).
	state = mods.rules.advanceStreak(state, "2026-07-27", "2026-07-26");

	assert.equal(state.days, 1, "về 1, KHÔNG về 0 và KHÔNG trừ gì thêm");
});

test("chuỗi ngày có TRẦN 7 — không biến việc nghỉ một hôm thành mất mát lớn", async function () {
	var mods = await loadModules();
	var cap = mods.tuningModule.tuning.missions.streakCapDays;
	var state = { lastDate: "2026-07-01", days: 1 };

	for (var day = 2; day <= 20; day += 1) {
		var today = "2026-07-" + String(day).padStart(2, "0");
		var yesterday = "2026-07-" + String(day - 1).padStart(2, "0");
		state = mods.rules.advanceStreak(state, today, yesterday);
	}

	assert.equal(state.days, cap);
	assert.equal(cap, 7, "task P1-8 chốt trần 7 ngày");
});

test("nghỉ vài hôm KHÔNG mất huy hiệu và KHÔNG mất số câu đã học", async function () {
	var mods = await loadModules();
	reset(mods, 0);

	var missions = new mods.Missions.Missions();
	missions.recordRun(totals({ correctAnswers: 12 }), DAY1);

	var badgesAfterDay1 = missions.earnedBadgeIds.slice();
	assert.ok(badgesAfterDay1.length > 0, "12 câu đúng phải chạm mốc huy hiệu đầu tiên");

	// Nhảy 3 ngày — chuỗi gãy.
	missions.recordRun(totals({ correctAnswers: 1 }), DAY4);

	assert.equal(missions.streakDays, 1, "chuỗi bắt đầu lại");
	badgesAfterDay1.forEach(function (id) {
		assert.ok(missions.earnedBadgeIds.includes(id), "huy hiệu đã trao KHÔNG BAO GIỜ được lấy lại: " + id);
	});
	assert.equal(missions.badgeProgress.correctTotal, 13, "số câu đã học là công sức thật, không được reset");
});

// --- Huy hiệu ----------------------------------------------------------------

test("huy hiệu trao ĐÚNG MỐC, không sớm không muộn (DoD)", async function () {
	var mods = await loadModules();
	var progress = { correctTotal: 9, correctByDifficulty: {}, streakDays: 0 };

	assert.deepEqual(mods.rules.newlyEarnedBadges(progress, []), [], "9 câu chưa đủ mốc 10");

	progress.correctTotal = 10;
	var earned = mods.rules.newlyEarnedBadges(progress, []);
	assert.equal(earned.length, 1);
	assert.equal(earned[0].id, "first-10");

	// Đã có rồi thì không trao lại.
	assert.deepEqual(mods.rules.newlyEarnedBadges(progress, ["first-10"]), []);
});

test("huy hiệu theo độ khó và theo chuỗi ngày", async function () {
	var mods = await loadModules();

	var hard = mods.rules.newlyEarnedBadges(
		{ correctTotal: 0, correctByDifficulty: { hard: 25 }, streakDays: 0 },
		[]
	);
	assert.ok(hard.some(function (b) { return b.id === "hard-25"; }));

	var week = mods.rules.newlyEarnedBadges(
		{ correctTotal: 0, correctByDifficulty: {}, streakDays: 7 },
		[]
	);
	assert.ok(week.some(function (b) { return b.id === "streak-7"; }));
	assert.ok(week.some(function (b) { return b.id === "streak-3"; }), "vượt mốc thì nhận cả mốc dưới");
});

test("huy hiệu 'trọn tuần' trao NGAY trong ván khiến chuỗi chạm 7", async function () {
	var mods = await loadModules();
	reset(mods, 0);

	var missions = new mods.Missions.Missions();

	for (var day = 1; day <= 7; day += 1) {
		var date = new Date(2026, 6, day, 10, 0, 0);
		var result = missions.recordRun(totals({ correctAnswers: 1 }), date);

		if (day === 7) {
			assert.ok(
				result.newBadges.some(function (b) { return b.id === "streak-7"; }),
				"chuỗi phải được cập nhật TRƯỚC khi chấm huy hiệu, nếu không sẽ trễ một ngày"
			);
		}
	}

	assert.equal(missions.streakDays, 7);
});

test("mọi huy hiệu đều có nhãn + mô tả tiếng Việt cho học sinh đọc", async function () {
	var mods = await loadModules();

	mods.rules.BADGES.forEach(function (badge) {
		assert.ok(badge.label.length > 0, badge.id + " thiếu nhãn");
		assert.ok(badge.description.length > 0, badge.id + " thiếu mô tả");
		assert.ok(badge.threshold > 0);
	});
});

// --- Lưu trữ -----------------------------------------------------------------

test("khoá lưu trữ đúng hậu tố -v2 (quy tắc vàng #2)", async function () {
	var mods = await loadModules();

	assert.equal(mods.keys.V2_STORAGE_KEYS.missions, "endlessrunner-missions-v2");
	Object.values(mods.keys.V2_STORAGE_KEYS).forEach(function (key) {
		assert.ok(key.endsWith("-v2"), key + " phải kết thúc bằng -v2");
	});
	// 5 khoá V1 KHÔNG được đụng tới.
	assert.equal(Object.keys(mods.keys.V1_STORAGE_KEYS).length, 5);
});

test("dữ liệu hỏng trong localStorage không làm sập game", async function () {
	var mods = await loadModules();
	store.clear();
	store.set(
		"endlessrunner-missions-v2",
		JSON.stringify({ daily: "khong-phai-object", earnedBadges: 42, streak: null, correctTotal: "rac" })
	);

	var missions = new mods.Missions.Missions();

	assert.deepEqual(missions.earnedBadgeIds, []);
	assert.equal(missions.streakDays, 0);
	assert.equal(missions.today(DAY1).missions.length, 3, "vẫn phải sinh được nhiệm vụ hôm nay");
});

// --- Rung --------------------------------------------------------------------

test("rung: feature-detect, KHÔNG đoán theo user-agent", function () {
	var fs = require("fs");
	var path = require("path");
	var source = fs.readFileSync(
		path.join(path.resolve(__dirname, ".."), "client", "src", "core", "haptics.ts"),
		"utf8"
	);

	assert.ok(/typeof navigator\.vibrate === "function"/.test(source), "phải feature-detect");
	assert.equal(/userAgent/.test(source), false, "đoán theo user-agent là sai và sẽ hỏng ở bản trình duyệt sau");
	// Tắt được, và mặc định tôn trọng cài đặt.
	assert.ok(/isVibrationEnabled/.test(source));
	assert.ok(/setVibrationEnabled/.test(source));
});

test("rung tắt được và im hoàn toàn khi máy không hỗ trợ", async function () {
	var haptics = await loadClientBundle({
		haptics: "core/haptics.ts",
		SaveData: "core/SaveData.ts"
	});

	store.clear();
	delete globalThis.navigator;

	// Máy không có navigator.vibrate (iPhone) → coi như không hỗ trợ, không ném lỗi.
	assert.equal(haptics.haptics.isVibrationSupported(), false);
	assert.equal(haptics.haptics.isVibrationEnabled(), false);
	haptics.haptics.vibrateHit();

	// Máy Android: có vibrate.
	var calls = [];
	globalThis.navigator = {
		vibrate: function (ms) {
			calls.push(ms);
			return true;
		}
	};

	assert.equal(haptics.haptics.isVibrationSupported(), true);
	assert.equal(haptics.haptics.isVibrationEnabled(), true, "mặc định BẬT");

	haptics.haptics.vibrateHit();
	assert.equal(calls.length, 1);

	// Tắt trong Cài đặt → im hẳn.
	haptics.haptics.setVibrationEnabled(false);
	haptics.haptics.vibrateHit();
	haptics.haptics.vibrateWrong();
	assert.equal(calls.length, 1, "tắt rồi mà vẫn rung là lỗi tôn trọng người dùng");

	delete globalThis.navigator;
});

test("rung khi SAI nhẹ hơn khi VA CHẠM — báo hiệu, không phải hình phạt", async function () {
	var mods = await loadModules();
	var missionsTuning = mods.tuningModule.tuning.missions;

	assert.ok(missionsTuning.vibrateWrongMs < missionsTuning.vibrateHitMs);
	assert.ok(missionsTuning.vibrateHitMs <= 50, "rung dài quá thành khó chịu khi va liên tiếp");
});

// --- S13 render từ dữ liệu thật ----------------------------------------------

test("S13 đọc dữ liệu THẬT: nhiệm vụ, huy hiệu, chuỗi ngày, số câu đang nợ", function () {
	var fs = require("fs");
	var path = require("path");
	var source = fs.readFileSync(
		path.join(path.resolve(__dirname, ".."), "client", "src", "ui", "screens", "MenuScreens.ts"),
		"utf8"
	);

	assert.ok(/class ProfileScreen/.test(source));
	assert.ok(/this\.missions\.today\(\)/.test(source), "nhiệm vụ phải lấy từ kho thật");
	assert.ok(/this\.missions\.earnedBadgeIds/.test(source));
	assert.ok(/this\.missions\.streakDays/.test(source));
	assert.ok(/getReviewCount\(\)/.test(source), "phải hiện số câu đang nợ trong hàng đợi ôn tập");
	assert.ok(/loadSkill\(\)/.test(source), "phải lấy accuracy theo độ khó từ hồ sơ kỹ năng");
});
