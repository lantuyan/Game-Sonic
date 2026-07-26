"use strict";

// P0-9 — máy trạng thái màn hình và cờ FTUE.
//
// Phần hình (CSS, tương phản, kích thước chạm) đã kiểm trực tiếp trên trình duyệt
// và ghi vào checklist; ở đây kiểm phần LOGIC điều hướng, thứ dễ vỡ âm thầm nhất.

var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("../test-helpers/clientModule");
var loadClientModule = helpers.loadClientModule;

var sharedStore = new Map();

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

/** Phần tử DOM giả tối thiểu: ScreenManager chỉ cần `hidden` và `dataset`. */
function fakeElement() {
	return { hidden: false, dataset: {} };
}

function fakeScreen(name, log) {
	return {
		name: name,
		element: fakeElement(),
		onShow: function () {
			log.push("show:" + name);
		},
		onHide: function () {
			log.push("hide:" + name);
		}
	};
}

test("chỉ MỘT màn hiện tại một thời điểm", async function () {
	var ScreenManager = (await loadClientModule("ui/Screens.ts")).ScreenManager;
	var root = fakeElement();
	var manager = new ScreenManager(root);
	var log = [];

	var home = fakeScreen("home", log);
	var level = fakeScreen("level", log);
	manager.register(home);
	manager.register(level);

	assert.equal(home.element.hidden, true, "đăng ký xong phải ẩn hết");
	assert.equal(level.element.hidden, true);

	manager.show("home");
	assert.equal(home.element.hidden, false);
	assert.equal(level.element.hidden, true);
	assert.equal(root.dataset.screen, "home", "data-screen để CSS/QA biết đang ở màn nào");

	manager.show("level");
	assert.equal(home.element.hidden, true, "màn cũ phải ẩn đi");
	assert.equal(level.element.hidden, false);
	assert.deepEqual(log, ["show:home", "hide:home", "show:level"]);
});

test("show lại chính màn đang mở thì không ẩn/hiện lặp, chỉ gọi onShow", async function () {
	var ScreenManager = (await loadClientModule("ui/Screens.ts")).ScreenManager;
	var manager = new ScreenManager(fakeElement());
	var log = [];
	var home = fakeScreen("home", log);
	manager.register(home);

	manager.show("home");
	manager.show("home", { refreshed: true });

	assert.deepEqual(log, ["show:home", "show:home"], "không được phát 'hide' cho chính nó");
	assert.equal(home.element.hidden, false);
});

test("back() quay về đúng màn trước", async function () {
	var ScreenManager = (await loadClientModule("ui/Screens.ts")).ScreenManager;
	var manager = new ScreenManager(fakeElement());
	var log = [];

	manager.register(fakeScreen("home", log));
	manager.register(fakeScreen("level", log));
	manager.register(fakeScreen("character", log));

	manager.show("home");
	manager.show("level");
	manager.show("character");

	manager.back();
	assert.equal(manager.current, "level");

	manager.back();
	assert.equal(manager.current, "home");
});

test("hideAll() dùng khi vào ván — không màn nào che gameplay", async function () {
	var ScreenManager = (await loadClientModule("ui/Screens.ts")).ScreenManager;
	var root = fakeElement();
	var manager = new ScreenManager(root);
	var log = [];
	var home = fakeScreen("home", log);
	manager.register(home);

	manager.show("home");
	manager.hideAll();

	assert.equal(home.element.hidden, true);
	assert.equal(manager.current, null);
	assert.equal(root.dataset.screen, undefined, "phải xoá data-screen khi vào gameplay");
});

test("show màn chưa đăng ký thì cảnh báo chứ không ném lỗi", async function () {
	var ScreenManager = (await loadClientModule("ui/Screens.ts")).ScreenManager;
	var manager = new ScreenManager(fakeElement());
	var warned = 0;
	var originalWarn = console.warn;
	console.warn = function () {
		warned += 1;
	};

	try {
		manager.show("khong-ton-tai");
		assert.equal(warned, 1);
		assert.equal(manager.current, null);
	} finally {
		console.warn = originalWarn;
	}
});

test("cờ FTUE dùng đúng khóa endlessrunner-ftue-v2", async function () {
	sharedStore.clear();
	var menus = await loadClientModule("ui/screens/MenuScreens.ts");

	assert.equal(menus.hasSeenTutorial(), false, "người chơi mới phải thấy hướng dẫn");

	menus.markTutorialSeen();
	assert.equal(menus.hasSeenTutorial(), true);
	assert.equal(sharedStore.get("endlessrunner-ftue-v2"), "seen");

	// "Xem lại hướng dẫn" ở S11 phải bật lại được.
	menus.resetTutorial();
	assert.equal(menus.hasSeenTutorial(), false);
});

test("hằng số màn hình khớp hợp đồng: 3 lớp, biệt danh ≤24 ký tự", async function () {
	var menus = await loadClientModule("ui/screens/MenuScreens.ts");

	assert.deepEqual(
		menus.LEVELS.map(function (level) {
			return level.id;
		}),
		["lop6", "lop7", "lop8"],
		"id lớp là hợp đồng API, không được đổi"
	);

	assert.equal(menus.NICKNAME_MAX_LENGTH, 24, "hợp đồng §7.3.2: biệt danh tối đa 24 ký tự");
});
