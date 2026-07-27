"use strict";

// P2-3 — PHÍA CLIENT: hộp thư đi + đồng bộ ví lên server.
//
// Câu hỏi mà cả file này tồn tại để trả lời: **rớt mạng giữa chừng thì có mất xu
// không?** Ở phòng máy trường, wifi rớt là chuyện xảy ra hàng ngày, và nó xảy ra
// đúng lúc học sinh vừa kết thúc một ván tốt.
//
// Vì vậy test không dùng transport "giả vờ thành công": nó dựng một SERVER GIẢ có
// đúng ngữ nghĩa quan trọng của server thật (trùng `ref` là no-op, tiêu quá số dư
// bị từ chối, thứ tự được tôn trọng), rồi bật/tắt mạng giữa chừng và đếm xu ở hai
// đầu. Một transport chỉ biết `resolve()` sẽ để lọt đúng những lỗi nguy hiểm nhất.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");
var helpers = require("../test-helpers/clientModule");

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
	return helpers.loadClientBundle({
		outbox: "systems/coinOutbox.ts",
		EconomySync: "systems/EconomySync.ts",
		ledger: "systems/economyLedger.ts",
		SaveData: "core/SaveData.ts",
		keys: "core/storageKeys.ts",
		Unlocks: "systems/Unlocks.ts",
		Missions: "systems/Missions.ts",
		shopPrices: "systems/shopPrices.ts"
	});
}

function reset(mods, coins) {
	store.clear();
	mods.ledger.setCoinLedgerSink(null);
	mods.SaveData.saveWallet(Object.assign({}, mods.SaveData.DEFAULT_WALLET, { coins: coins || 0 }));
}

// --- Server giả ---------------------------------------------------------------

/**
 * Bản sao ngữ nghĩa của `server/economyStore.js` ở mức đủ để kiểm phía client:
 * sổ cái append-only theo `ref`, số dư = tổng sổ, tiêu quá số dư bị từ chối.
 * `online = false` mô phỏng rớt mạng (transport NÉM, đúng như `postJson`).
 */
function createFakeServer(options) {
	var settings = options || {};
	var ledger = new Map();
	var owned = new Set();
	var prices = { mage: 300, rogue: 500, barbarian: 800, "skin-gold": 150 };
	var server = {
		online: settings.online !== false,
		disabled: settings.disabled === true,
		migrateCalls: 0,
		entryCalls: 0,
		purchaseCalls: 0
	};

	function balance() {
		var total = 0;
		ledger.forEach(function (amount) {
			total += amount;
		});
		return total;
	}

	function requireOnline() {
		if (server.online === false) {
			throw new Error("HTTP 503");
		}
	}

	function post(ref, amount) {
		if (ledger.has(ref) === true) {
			return true;
		}

		if (balance() + amount < 0) {
			return false;
		}

		ledger.set(ref, amount);
		return true;
	}

	server.balance = balance;
	server.owned = owned;
	server.ledgerSize = function () {
		return ledger.size;
	};

	server.transport = {
		migrate: function (deviceId, body) {
			requireOnline();
			server.migrateCalls += 1;

			if (server.disabled === true) {
				return Promise.resolve({ disabled: true });
			}

			post("migrate:local-v2", body.coins);
			body.items.forEach(function (id) {
				owned.add(id);
			});

			return Promise.resolve({ migrated: true, applied: true, coins: balance() });
		},
		sendEntries: function (deviceId, entries) {
			requireOnline();
			server.entryCalls += 1;

			if (server.disabled === true) {
				return Promise.resolve({ disabled: true });
			}

			var results = entries.map(function (entry) {
				return { ref: entry.ref, accepted: post(entry.ref, entry.amount) };
			});

			return Promise.resolve({ results: results, coins: balance() });
		},
		sendPurchase: function (deviceId, entry) {
			requireOnline();
			server.purchaseCalls += 1;

			if (server.disabled === true) {
				return Promise.resolve({ disabled: true });
			}

			var itemId = entry.purchase.itemId;

			if (owned.has(itemId) === true) {
				return Promise.resolve({ ok: false, reason: "already-owned", coins: balance() });
			}

			var price = entry.purchase.source === "achievement" ? 0 : (prices[itemId] || 0);

			if (post(entry.ref, -price) === false) {
				return Promise.resolve({ ok: false, reason: "not-enough-coins", coins: balance() });
			}

			owned.add(itemId);
			return Promise.resolve({ ok: true, coins: balance() });
		},
		getCatalog: function () {
			requireOnline();
			return Promise.resolve([{ id: "mage", slot: "character", label: "Pháp sư", price: 300 }]);
		}
	};

	return server;
}

function makeSync(mods, server, deviceId) {
	var counter = 0;

	return new mods.EconomySync.EconomySync({
		transport: server.transport,
		resolveDeviceId: function () {
			return Promise.resolve(deviceId === undefined ? "dev-test" : deviceId);
		},
		now: function () {
			counter += 1;
			return 1700000000000 + counter;
		},
		random: function () {
			return 0.5;
		}
	});
}

// --- Luật thuần của hàng đợi --------------------------------------------------

test("hàng đợi giữ ĐÚNG THỨ TỰ và chạm trần thì bỏ bút toán CŨ NHẤT", async function () {
	var mods = await loadModules();
	var state = mods.outbox.DEFAULT_OUTBOX;

	for (var index = 0; index < mods.outbox.OUTBOX_LIMIT + 5; index += 1) {
		state = mods.outbox.enqueue(state, { ref: "r" + index, kind: "run", amount: 1 });
	}

	assert.equal(state.entries.length, mods.outbox.OUTBOX_LIMIT);
	assert.equal(state.entries[0].ref, "r5", "phải bỏ đầu hàng đợi, giữ bút toán mới nhất");
	assert.equal(state.sequence, mods.outbox.OUTBOX_LIMIT + 5);
});

test("nextBatch KHÔNG gom lẫn bút toán thường với món mua — thứ tự là bất khả xâm phạm", async function () {
	var mods = await loadModules();
	var state = mods.outbox.DEFAULT_OUTBOX;

	state = mods.outbox.enqueue(state, { ref: "a", kind: "run", amount: 100 });
	state = mods.outbox.enqueue(state, { ref: "b", kind: "mission", amount: 50 });
	state = mods.outbox.enqueue(state, { ref: "c", kind: "purchase", amount: -150, purchase: { itemId: "mage", source: "coins" } });
	state = mods.outbox.enqueue(state, { ref: "d", kind: "run", amount: 20 });

	var first = mods.outbox.nextBatch(state);
	assert.equal(first.kind, "entries");
	assert.deepEqual(first.entries.map(function (e) { return e.ref; }), ["a", "b"]);

	var afterFirst = mods.outbox.applyAcks(state, [{ ref: "a", accepted: true }, { ref: "b", accepted: true }]);
	var second = mods.outbox.nextBatch(afterFirst);
	assert.equal(second.kind, "purchase");
	assert.equal(second.entry.ref, "c");
});

test("applyAcks GIỮ LẠI bút toán đến trong lúc request đang bay", async function () {
	var mods = await loadModules();
	var state = mods.outbox.DEFAULT_OUTBOX;

	state = mods.outbox.enqueue(state, { ref: "sent", kind: "run", amount: 100 });
	// Ván khác kết thúc giữa lúc request đang bay.
	state = mods.outbox.enqueue(state, { ref: "late", kind: "run", amount: 40 });

	var after = mods.outbox.applyAcks(state, [{ ref: "sent", accepted: true }]);

	// "Dọn cho gọn" bằng cách xoá cả hàng đợi sau mỗi lần đẩy thành công là cách
	// làm mất xu tinh vi nhất của thiết kế này — canh ở đây.
	assert.deepEqual(after.entries.map(function (e) { return e.ref; }), ["late"]);
	assert.equal(after.dropped, 0);
});

test("bút toán bị server TỪ CHỐI thì bỏ khỏi hàng đợi và đếm vào `dropped` (không tắc hàng đợi)", async function () {
	var mods = await loadModules();
	var state = mods.outbox.enqueue(mods.outbox.DEFAULT_OUTBOX, { ref: "x", kind: "revive", amount: -500 });
	var after = mods.outbox.applyAcks(state, [{ ref: "x", accepted: false }]);

	assert.equal(after.entries.length, 0);
	assert.equal(after.dropped, 1);
});

test("makeRef sinh khoá khác nhau khi bộ đếm quay lại (nhiễu ngẫu nhiên cứu)", async function () {
	var mods = await loadModules();
	var noises = ["aaaa", "bbbb"];
	var refs = noises.map(function (noise) {
		return mods.outbox.makeRef("run", 1700000000000, 7, noise);
	});

	assert.notEqual(refs[0], refs[1], "bộ đếm trùng mà ref cũng trùng là mất xu thật");
});

test("normalizeOutbox lọc rác thay vì làm sập game", async function () {
	var mods = await loadModules();
	var state = mods.outbox.normalizeOutbox({
		entries: [
			{ ref: "ok", kind: "run", amount: 10 },
			{ ref: "", kind: "run", amount: 10 },
			{ kind: "run", amount: 10 },
			{ ref: "nan", kind: "run", amount: "nhiều" },
			null,
			"chuỗi lạ"
		],
		sequence: -3,
		dropped: "x"
	});

	assert.deepEqual(state.entries.map(function (e) { return e.ref; }), ["ok"]);
	assert.equal(state.sequence, 0);
	assert.equal(state.dropped, 0);
});

// --- Di trú một chiều ---------------------------------------------------------

test("DI TRÚ chỉ gọi MỘT LẦN, và cờ chỉ bật SAU khi server xác nhận", async function () {
	var mods = await loadModules();
	reset(mods, 1240);

	var server = createFakeServer({});
	var sync = makeSync(mods, server);

	await sync.start(["mage", "skin-gold"]);
	assert.equal(server.migrateCalls, 1);
	assert.equal(server.balance(), 1240);
	assert.equal(mods.SaveData.loadWallet().migratedToServer, true);
	assert.equal(mods.SaveData.loadWallet().coins, 1240, "VÍ LOCAL không được đụng vào");

	// Phiên sau (instance mới, cùng localStorage) — không gọi lại.
	var sync2 = makeSync(mods, server);
	await sync2.start(["mage", "skin-gold"]);
	assert.equal(server.migrateCalls, 1, "cờ local phải chặn lời gọi thứ hai");
});

test("DI TRÚ RỚT MẠNG: cờ KHÔNG bật, ví local nguyên vẹn, lần sau di trú lại đúng một bút toán", async function () {
	var mods = await loadModules();
	reset(mods, 900);

	var server = createFakeServer({ online: false });
	var sync = makeSync(mods, server);

	await sync.start([]);
	assert.equal(mods.SaveData.loadWallet().migratedToServer, false, "chưa xác nhận thì KHÔNG được đánh dấu xong");
	assert.equal(mods.SaveData.loadWallet().coins, 900, "ví local phải nguyên vẹn");
	assert.equal(server.balance(), 0);

	// Mạng về.
	server.online = true;
	await makeSync(mods, server).start([]);

	assert.equal(server.balance(), 900);
	assert.equal(mods.SaveData.loadWallet().migratedToServer, true);

	// Và nếu cờ local mất (xoá localStorage một phần), server VẪN không nhân đôi.
	mods.SaveData.saveWallet(Object.assign({}, mods.SaveData.loadWallet(), { migratedToServer: false }));
	await makeSync(mods, server).start([]);
	assert.equal(server.balance(), 900, "khoá tự nhiên phía server là lớp bảo vệ thứ hai");
});

test("server chưa bật CSDL (`disabled`) → KHÔNG đánh dấu đã di trú", async function () {
	var mods = await loadModules();
	reset(mods, 500);

	var server = createFakeServer({ disabled: true });
	await makeSync(mods, server).start([]);

	assert.equal(mods.SaveData.loadWallet().migratedToServer, false);
});

// --- Rớt mạng giữa chừng ------------------------------------------------------

test("MẤT KẾT NỐI GIỮA CHỪNG KHÔNG MẤT XU (DoD 7)", async function () {
	var mods = await loadModules();
	reset(mods, 0);

	var server = createFakeServer({});
	var sync = makeSync(mods, server);

	// Di trú xong lúc còn mạng.
	await sync.start([]);
	assert.equal(server.balance(), 0);

	// Mạng RỚT. Em ấy chơi 3 ván và làm xong nhiệm vụ.
	server.online = false;
	sync.record("run", 120, "ván 1");
	sync.record("run", 95, "ván 2");
	sync.record("mission", 60, "nhiệm vụ");
	await sync.flush();

	assert.equal(sync.pending.length, 3, "bút toán phải NẰM LẠI hàng đợi");
	assert.equal(server.balance(), 0, "server chưa biết gì — đúng như thực tế");

	// Mạng VỀ. Instance mới (đóng tab rồi mở lại) đọc hàng đợi từ localStorage.
	server.online = true;
	var sync2 = makeSync(mods, server);
	assert.equal(sync2.pending.length, 3, "hàng đợi phải sống qua lần tải lại trang");

	await sync2.flush();

	assert.equal(server.balance(), 275, "không thiếu một xu");
	assert.equal(sync2.pending.length, 0);

	// Và đẩy lại lần nữa cũng KHÔNG cộng thêm.
	await sync2.flush();
	assert.equal(server.balance(), 275, "không thừa một xu");
});

test("SERVER ĐÃ NHẬN NHƯNG PHẢN HỒI RỚT: gửi lại KHÔNG nhân đôi xu", async function () {
	var mods = await loadModules();
	reset(mods, 0);

	var server = createFakeServer({});

	// Kịch bản nguy hiểm nhất và cũng hay gặp nhất: request tới nơi, server ghi sổ
	// xong, rồi phản hồi rớt trên đường về. Client tin là thất bại và gửi lại.
	// Nếu `ref` không phải khoá tự nhiên thì đây chính là chỗ xu tự nhân đôi.
	var swallowResponse = true;
	var lossyTransport = {
		migrate: server.transport.migrate,
		getCatalog: server.transport.getCatalog,
		sendPurchase: server.transport.sendPurchase,
		sendEntries: async function (deviceId, entries) {
			var response = await server.transport.sendEntries(deviceId, entries);

			if (swallowResponse === true) {
				throw new Error("HTTP 503");
			}

			return response;
		}
	};

	var sync = new mods.EconomySync.EconomySync({
		transport: lossyTransport,
		resolveDeviceId: function () {
			return Promise.resolve("dev-lossy");
		},
		now: function () {
			return 1700000000000;
		},
		random: function () {
			return 0.5;
		}
	});

	await sync.start([]);
	sync.record("run", 200);
	await sync.flush();

	assert.equal(server.balance(), 200, "server ĐÃ ghi sổ");
	assert.equal(sync.pending.length, 1, "client vẫn giữ bút toán vì tưởng thất bại");

	// Client gửi lại ĐÚNG bút toán đó (cùng `ref`).
	swallowResponse = false;
	await sync.flush();

	assert.equal(server.balance(), 200, "gửi lại phải là no-op — không được thành 400");
	assert.equal(server.ledgerSize(), 2, "một bút toán di trú + một bút toán ván chơi");
	assert.equal(sync.pending.length, 0);
});

test("mua khi server báo THIẾU XU: bút toán bị bỏ, đếm vào `dropped`, hàng đợi không tắc", async function () {
	var mods = await loadModules();
	reset(mods, 0);

	var server = createFakeServer({});
	var sync = makeSync(mods, server);
	await sync.start([]);

	// Client (ví local) tưởng đủ tiền, server thì chưa nhận được xu nào.
	sync.recordPurchase("barbarian", 800, "coins");
	sync.record("run", 30);
	await sync.flush();

	assert.equal(sync.droppedCount, 1);
	assert.equal(sync.pending.length, 0, "một dòng độc KHÔNG được làm tắc hàng đợi");
	assert.equal(server.balance(), 30, "bút toán phía sau vẫn phải qua");
});

test("mua món ĐÃ SỞ HỮU là câu trả lời thành công với hàng đợi", async function () {
	var mods = await loadModules();
	reset(mods, 0);

	var server = createFakeServer({});
	var sync = makeSync(mods, server);
	await sync.start(["mage"]);

	sync.recordPurchase("mage", 300, "coins");
	await sync.flush();

	assert.equal(sync.pending.length, 0);
	assert.equal(sync.droppedCount, 0, "'đã sở hữu' không phải là mất xu");
});

test("THỨ TỰ replay: 'nhận 150 rồi mua 150' đi qua được dù server bắt đầu từ 0", async function () {
	var mods = await loadModules();
	reset(mods, 0);

	var server = createFakeServer({ online: false });
	var sync = makeSync(mods, server);
	await sync.start([]);

	sync.record("run", 150);
	sync.recordPurchase("skin-gold", 150, "coins");
	await sync.flush();
	assert.equal(sync.pending.length, 2);

	server.online = true;
	await sync.flush();

	assert.equal(server.balance(), 0, "150 vào rồi 150 ra");
	assert.equal(server.owned.has("skin-gold"), true);
	assert.equal(sync.droppedCount, 0, "sai thứ tự thì món này bị từ chối oan");
});

// --- Đối chiếu bảng giá -------------------------------------------------------

test("compareCatalog im lặng khi hai bảng khớp, và chỉ ra ĐÚNG món lệch", async function () {
	var mods = await loadModules();
	var server = [
		{ id: "mage", price: 300 },
		{ id: "rogue", price: 500 }
	];

	assert.deepEqual(mods.shopPrices.compareCatalog(server, server), []);

	// Máy đang chạy bản client cũ trong cache Service Worker: giá đã đổi ở server.
	var stale = mods.shopPrices.compareCatalog(server, [
		{ id: "mage", price: 250 },
		{ id: "rogue", price: 500 }
	]);
	assert.deepEqual(stale, [{ id: "mage", localPrice: 250, serverPrice: 300 }]);
});

test("compareCatalog phát hiện cả món chỉ có ở MỘT bên", async function () {
	var mods = await loadModules();

	var onlyServer = mods.shopPrices.compareCatalog([{ id: "moi", price: 100 }], []);
	assert.deepEqual(onlyServer, [{ id: "moi", localPrice: null, serverPrice: 100 }]);

	var onlyLocal = mods.shopPrices.compareCatalog([], [{ id: "cu", price: 100 }]);
	assert.deepEqual(onlyLocal, [{ id: "cu", localPrice: 100, serverPrice: null }]);
});

// --- Kỷ luật một-đường-đi -----------------------------------------------------

test("EconomySync KHÔNG ghi ví ngoài việc bật cờ đã-di-trú (canh mã nguồn)", async function () {
	var source = fs.readFileSync(path.join(rootDir, "client", "src", "systems", "EconomySync.ts"), "utf8");
	var calls = source.match(/saveWallet\s*\(/g) || [];

	// Đúng MỘT lời gọi. Thêm lời gọi thứ hai nghĩa là file này bắt đầu quyết định
	// số dư của người chơi — và đó là lúc "đồng bộ" biến thành "ghi đè".
	assert.equal(calls.length, 1, "chỉ được ghi ví đúng một chỗ");
	assert.ok(source.indexOf("migratedToServer: true") !== -1);
	assert.equal(/coins:\s*[^}]*result\.coins/.test(source), false, "KHÔNG được kéo số dư server đè lên ví local");
});

test("Unlocks vẫn là nơi duy nhất trừ xu, và báo sổ cái trong CÙNG lời gọi", async function () {
	var mods = await loadModules();
	reset(mods, 1000);

	var recorded = [];
	mods.ledger.setCoinLedgerSink({
		record: function (kind, amount) {
			recorded.push({ kind: kind, amount: amount });
		},
		recordPurchase: function (itemId, paidCoins, source) {
			recorded.push({ itemId: itemId, paidCoins: paidCoins, source: source });
		}
	});

	var unlocks = new mods.Unlocks.Unlocks();
	var result = unlocks.purchase("mage");

	assert.equal(result.ok, true);
	assert.equal(mods.SaveData.loadWallet().coins, 700);
	assert.deepEqual(recorded, [{ itemId: "mage", paidCoins: 300, source: "coins" }]);

	// Mua hụt thì KHÔNG được ghi sổ.
	recorded.length = 0;
	var failed = unlocks.purchase("barbarian");
	assert.equal(failed.ok, false);
	assert.equal(recorded.length, 0, "mua hụt mà vẫn ghi sổ là tạo ra xu từ hư không");
});

test("mua ngoại hình và hồi sinh cũng đi qua sổ cái", async function () {
	var mods = await loadModules();
	reset(mods, 1000);

	var recorded = [];
	mods.ledger.setCoinLedgerSink({
		record: function (kind, amount) {
			recorded.push([kind, amount]);
		},
		recordPurchase: function (itemId, paidCoins, source) {
			recorded.push([itemId, paidCoins, source]);
		}
	});

	var unlocks = new mods.Unlocks.Unlocks();
	unlocks.purchaseCosmetic("skin-gold");
	unlocks.consumeRevival(50);

	assert.deepEqual(recorded, [["skin-gold", 150, "coins"], ["revive", -50]]);
	assert.equal(mods.SaveData.loadWallet().coins, 800);
});

test("chưa cắm sổ cái thì mọi thứ chạy y như trước P2-3", async function () {
	var mods = await loadModules();
	reset(mods, 1000);

	// `setCoinLedgerSink(null)` đã chạy trong `reset` — đây là trạng thái của mọi
	// test cũ, và của chính game lúc chưa kịp khởi động EconomySync.
	var unlocks = new mods.Unlocks.Unlocks();
	assert.equal(unlocks.purchase("mage").ok, true);
	assert.equal(mods.SaveData.loadWallet().coins, 700);
});
