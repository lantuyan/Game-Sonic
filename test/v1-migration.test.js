"use strict";

// P0-13 — REGRESSION quan trọng nhất với người dùng thật:
// "dữ liệu người chơi V1 sống sót" (tiêu chí nghiệm thu P0, plan §8).
//
// Kịch bản: điền localStorage y như một máy đã chơi V1 lâu ngày, rồi mở V2 và
// kiểm từng thứ: biệt danh, deviceId, tiến trình câu đã trả lời, hồ sơ kỹ năng,
// nhân vật đang chọn, và best score trong cookie.

var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("../test-helpers/clientModule");
var loadClientModule = helpers.loadClientModule;

var sharedStore = new Map();
var cookieValue = "";

globalThis.window = {
	addEventListener: function () {},
	removeEventListener: function () {},
	localStorage: {
		getItem: function (key) {
			return sharedStore.has(key) ? sharedStore.get(key) : null;
		},
		setItem: function (key, value) {
			sharedStore.set(key, String(value));
		},
		removeItem: function (key) {
			sharedStore.delete(key);
		}
	}
};

globalThis.document = {
	get cookie() {
		return cookieValue;
	}
};

/** Trạng thái localStorage của một máy đã chơi V1 nhiều ngày. */
function seedV1Data() {
	sharedStore.clear();
	sharedStore.set("endlessrunner-nickname-v1", "Bạn Minh");
	sharedStore.set("endlessrunner-device-id-v1", "device-abc-123");
	sharedStore.set("endlessrunner-character-v1", "sonic");
	sharedStore.set(
		"endlessrunner-question-progress-v1",
		JSON.stringify({
			entriesByLevel: {
				lop6: {
					"6q1": { level: "lop6", id: "6q1", status: "correct", shownCount: 2 },
					"6q2": { level: "lop6", id: "6q2", status: "wrong", shownCount: 1 }
				}
			}
		})
	);
	sharedStore.set(
		"endlessrunner-skill-profile-v1",
		JSON.stringify({
			byLevel: {
				lop6: { targetDifficultyIndex: 1.4, skill: 0.47, accuracy: 0.72, avgAnswerMs: 9200, gamesPlayed: 17 }
			}
		})
	);
	cookieValue = "highscoresonic=4820; other=x";
}

test("5 khóa V1 KHÔNG bị V2 xoá hay đổi tên", async function () {
	seedV1Data();
	var keys = await loadClientModule("core/storageKeys.ts");

	// Danh sách vàng — contract-test cũng canh, nhắc lại ở đây theo góc "dữ liệu thật".
	var golden = [
		"endlessrunner-question-progress-v1",
		"endlessrunner-device-id-v1",
		"endlessrunner-nickname-v1",
		"endlessrunner-skill-profile-v1",
		"endlessrunner-character-v1"
	];

	assert.deepEqual(Object.values(keys.V1_STORAGE_KEYS).sort(), golden.slice().sort());

	// Mọi khoá mới của V2 phải có hậu tố -v2, không được đụng vào không gian tên V1.
	for (var key of Object.values(keys.V2_STORAGE_KEYS)) {
		assert.ok(key.endsWith("-v2"), "khoá mới sai hậu tố: " + key);
		assert.equal(sharedStore.has(key), false, "khoá V2 không được tồn tại sẵn trên máy V1");
	}
});

test("nhân vật cũ `sonic` được map sang knight và GHI LẠI vào đúng khoá cũ", async function () {
	seedV1Data();
	var characters = await loadClientModule("data/characters.ts");

	assert.equal(characters.loadSelectedCharacterId(), "knight");
	assert.equal(
		sharedStore.get("endlessrunner-character-v1"),
		"knight",
		"phải ghi đè giá trị đã map vào CHÍNH khoá cũ, không tạo khoá mới"
	);

	// Các giá trị V1 còn lại giữ nguyên.
	assert.equal(sharedStore.get("endlessrunner-nickname-v1"), "Bạn Minh");
	assert.equal(sharedStore.get("endlessrunner-device-id-v1"), "device-abc-123");
});

test("tiến trình câu và hồ sơ kỹ năng của V1 KHÔNG bị đụng tới", async function () {
	seedV1Data();
	var before = {
		progress: sharedStore.get("endlessrunner-question-progress-v1"),
		skill: sharedStore.get("endlessrunner-skill-profile-v1")
	};

	// Mở V2: nạp các module có ghi localStorage.
	var characters = await loadClientModule("data/characters.ts");
	characters.loadSelectedCharacterId();

	var reviewModule = await loadClientModule("systems/ReviewQueue.ts");
	var queue = new reviewModule.ReviewQueue();
	queue.recordWrong("6q9", "lop6", 1000);

	var saveData = await loadClientModule("core/SaveData.ts");
	saveData.saveSettings(saveData.loadSettings());

	assert.equal(
		sharedStore.get("endlessrunner-question-progress-v1"),
		before.progress,
		"tiến trình câu đã trả lời phải nguyên vẹn"
	);
	assert.equal(sharedStore.get("endlessrunner-skill-profile-v1"), before.skill, "hồ sơ kỹ năng phải nguyên vẹn");
});

test("best score trong cookie `highscoresonic` được migrate ĐÚNG MỘT LẦN", async function () {
	seedV1Data();
	var saveData = await loadClientModule("core/SaveData.ts");

	var wallet = saveData.migrateLegacyBestScore(saveData.loadWallet());
	assert.equal(wallet.bestScore, 4820, "phải lấy được best score cũ từ cookie");
	assert.equal(wallet.migratedLegacyBestScore, true);

	// Lần sau KHÔNG đọc lại cookie nữa (plan §7.3.3: "đọc 1 lần rồi bỏ").
	cookieValue = "highscoresonic=999999";
	var second = saveData.migrateLegacyBestScore(saveData.loadWallet());
	assert.equal(second.bestScore, 4820, "đã migrate rồi thì không đọc lại cookie");
});

test("máy hoàn toàn mới (không có dữ liệu V1) vẫn chạy bình thường", async function () {
	sharedStore.clear();
	cookieValue = "";

	var characters = await loadClientModule("data/characters.ts");
	assert.equal(characters.loadSelectedCharacterId(), "knight", "mặc định là nhân vật đầu tiên");

	var saveData = await loadClientModule("core/SaveData.ts");
	var wallet = saveData.migrateLegacyBestScore(saveData.loadWallet());
	assert.equal(wallet.bestScore, 0);
	assert.equal(wallet.coins, 0);

	var settings = saveData.loadSettings();
	assert.ok(settings.musicVolume >= 0 && settings.musicVolume <= 1);
	assert.equal(settings.qualityPreset, null, "chưa chọn tay thì để auto-quality quyết định");
});

test("dữ liệu V1 hỏng/lạ không làm sập V2", async function () {
	sharedStore.clear();
	sharedStore.set("endlessrunner-character-v1", "{}}}rác");
	sharedStore.set("endlessrunner-nickname-v1", "");
	cookieValue = "highscoresonic=khong-phai-so";

	var characters = await loadClientModule("data/characters.ts");
	assert.equal(characters.loadSelectedCharacterId(), "knight", "giá trị rác → nhân vật mặc định");

	var saveData = await loadClientModule("core/SaveData.ts");
	var wallet = saveData.migrateLegacyBestScore(saveData.loadWallet());
	assert.equal(wallet.bestScore, 0, "cookie không phải số → giữ 0, không NaN");
	assert.ok(Number.isNaN(wallet.bestScore) === false);
});
