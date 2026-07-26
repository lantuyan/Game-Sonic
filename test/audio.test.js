"use strict";

// P0-11 — kiểm 3 luật âm thanh dễ hỏng nhất, bằng Howl giả:
//   * throttle giọng (ăn 20 coin/giây không được phát 20 lần);
//   * ducking −8dB khi có đề trên màn;
//   * volume nhạc/SFX tách riêng và được LƯU LẠI.

var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("../test-helpers/clientModule");

var sharedStore = new Map();

globalThis.window = {
	addEventListener: function (type, listener) {
		(globalThis.__listeners[type] = globalThis.__listeners[type] || []).push(listener);
	},
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

globalThis.__listeners = {};
globalThis.performance = globalThis.performance || { now: function () { return Date.now(); } };

/** Howl giả: ghi lại mọi lần play/volume/fade để test soi. */
function createHowlerStub() {
	var instances = [];

	function FakeHowl(options) {
		this.options = options;
		this.plays = 0;
		this._volume = options.volume;
		this.fades = [];
		this.stopped = false;
		instances.push(this);
	}

	FakeHowl.prototype.play = function () {
		this.plays += 1;
	};

	FakeHowl.prototype.stop = function () {
		this.stopped = true;
	};

	FakeHowl.prototype.volume = function (value) {
		if (value === undefined) {
			return this._volume;
		}

		this._volume = value;
		return value;
	};

	FakeHowl.prototype.fade = function (from, to) {
		this.fades.push({ from: from, to: to });
		this._volume = to;
	};

	FakeHowl.prototype.unload = function () {};

	return {
		instances: instances,
		module: {
			Howl: FakeHowl,
			Howler: { mute: function () {} }
		}
	};
}

/**
 * AudioManager import "howler" dưới dạng ESM đã bundle. Cách gọn nhất để test là
 * cho esbuild giữ "howler" external rồi nạp module qua một shim toàn cục.
 */
async function loadAudioManager(stub) {
	globalThis.__fakeHowler = stub.module;
	return helpers.loadClientModuleWithStubs("core/AudioManager.ts", {
		howler: "globalThis.__fakeHowler"
	});
}

test("throttle: ăn coin dồn dập chỉ phát tiếng theo nhịp tối thiểu", async function () {
	var stub = createHowlerStub();
	var module = await loadAudioManager(stub);
	var nowMs = 0;
	globalThis.performance = { now: function () { return nowMs; } };

	var audio = new module.AudioManager("/");
	audio.preloadSfx(["coin"]);

	var coinHowl = stub.instances[stub.instances.length - 1];

	// 20 lần gọi trong CÙNG một mili-giây (ăn cả dây coin).
	for (var index = 0; index < 20; index += 1) {
		audio.play("coin");
	}

	assert.equal(coinHowl.plays, 1, "cùng thời điểm chỉ được phát 1 lần, tránh chồng tiếng méo");

	// Qua khỏi ngưỡng throttle của coin (60ms) thì phát tiếp được.
	nowMs = 100;
	audio.play("coin");
	assert.equal(coinHowl.plays, 2);

	// Chưa đủ ngưỡng thì bỏ qua.
	nowMs = 130;
	audio.play("coin");
	assert.equal(coinHowl.plays, 2, "30ms < 60ms nên phải bỏ qua");

	audio.dispose();
});

test("ducking: hạ nhạc nền khi có đề, trả lại khi xong", async function () {
	var stub = createHowlerStub();
	var module = await loadAudioManager(stub);
	globalThis.performance = { now: function () { return 0; } };

	var audio = new module.AudioManager("/");
	audio.setMusicVolume(0.8);

	// Giả lập đã có gesture đầu tiên để BGM phát được.
	(globalThis.__listeners.pointerdown || []).forEach(function (listener) {
		listener();
	});

	audio.playBgm("bgm-biome1");
	var bgmHowl = stub.instances[stub.instances.length - 1];
	assert.equal(bgmHowl.plays, 1);
	assert.ok(Math.abs(bgmHowl.volume() - 0.8) < 1e-9);

	audio.setDucked(true);
	assert.equal(audio.isDucked, true);
	assert.equal(bgmHowl.fades.length, 1, "phải fade chứ không nhảy volume đột ngột");
	assert.ok(bgmHowl.volume() < 0.8, "ducking phải hạ âm lượng");
	assert.ok(Math.abs(bgmHowl.volume() - 0.8 * 0.4) < 1e-9, "−8dB ≈ ×0.4");

	// Gọi lại cùng trạng thái thì không fade thừa.
	audio.setDucked(true);
	assert.equal(bgmHowl.fades.length, 1);

	audio.setDucked(false);
	assert.ok(Math.abs(bgmHowl.volume() - 0.8) < 1e-9, "hết đề phải trả lại âm lượng cũ");

	audio.dispose();
});

test("volume nhạc và SFX tách riêng, tắt cái này không ảnh hưởng cái kia", async function () {
	var stub = createHowlerStub();
	var module = await loadAudioManager(stub);
	globalThis.performance = { now: function () { return 0; } };
	sharedStore.clear();

	var audio = new module.AudioManager("/");

	audio.setMusicVolume(0);
	audio.setSfxVolume(0.9);

	assert.equal(audio.music, 0, "tắt nhạc");
	assert.equal(audio.effects, 0.9, "SFX vẫn còn");

	audio.setMusicVolume(0.5);
	audio.setSfxVolume(0);
	assert.equal(audio.music, 0.5);
	assert.equal(audio.effects, 0);

	// Giá trị ngoài dải bị kẹp, không được làm hỏng settings.
	audio.setMusicVolume(5);
	assert.equal(audio.music, 1);
	audio.setMusicVolume(-3);
	assert.equal(audio.music, 0);
	audio.setMusicVolume(NaN);
	assert.equal(audio.music, 0);

	audio.dispose();
});

test("cài đặt âm lượng được LƯU vào endlessrunner-settings-v2", async function () {
	var stub = createHowlerStub();
	var module = await loadAudioManager(stub);
	globalThis.performance = { now: function () { return 0; } };
	sharedStore.clear();

	var audio = new module.AudioManager("/");
	audio.setMusicVolume(0.33);
	audio.setSfxVolume(0.77);

	var saved = JSON.parse(sharedStore.get("endlessrunner-settings-v2"));
	assert.ok(Math.abs(saved.musicVolume - 0.33) < 1e-9);
	assert.ok(Math.abs(saved.sfxVolume - 0.77) < 1e-9);

	// Phiên sau đọc lại đúng giá trị đã lưu.
	var next = new module.AudioManager("/");
	assert.ok(Math.abs(next.music - 0.33) < 1e-9);
	assert.ok(Math.abs(next.effects - 0.77) < 1e-9);

	audio.dispose();
	next.dispose();
});

test("chưa có gesture nào thì hoãn BGM (chính sách autoplay iOS)", async function () {
	var stub = createHowlerStub();
	var module = await loadAudioManager(stub);
	globalThis.performance = { now: function () { return 0; } };
	globalThis.__listeners = {};

	var audio = new module.AudioManager("/");
	var before = stub.instances.length;

	audio.playBgm("bgm-menu");
	assert.equal(stub.instances.length, before, "chưa chạm thì chưa được tạo/phát BGM");

	// Người chơi chạm lần đầu → BGM đang chờ được phát.
	(globalThis.__listeners.pointerdown || []).forEach(function (listener) {
		listener();
	});

	assert.equal(stub.instances.length, before + 1, "sau gesture đầu tiên mới phát");
	assert.equal(stub.instances[stub.instances.length - 1].plays, 1);

	audio.dispose();
});
