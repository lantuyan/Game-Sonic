"use strict";

// P2-3 — NỀN KINH TẾ SERVER-SIDE (ví · sổ cái · quyền sở hữu).
//
// Đây là bộ test canh TIỀN CỦA NGƯỜI CHƠI, nên nó chạy trên PGlite THẬT chứ không
// mock SQL: toàn bộ giá trị của thiết kế nằm trong mấy câu SQL có điều kiện
// (`... WHERE balance + amount >= 0`, `ON CONFLICT DO NOTHING`), mà mock query chỉ
// kiểm được rằng ta có gọi hàm, không kiểm được rằng con số ra đúng.
//
// ⚠ MỘT PGlite DUY NHẤT cho cả file (`sharedRuntimeDir`). KHÔNG thêm `mkdtempSync`
// mới cho từng test: mỗi instance PGlite là một cluster Postgres vài chục MB, và
// một phiên trước của dự án này đã làm đầy ổ đĩa thật 25 GB đúng theo cách đó.
// Dọn BẢNG trước mỗi test là đủ để độc lập.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var bcrypt = require("bcrypt");
var request = require("supertest");
var createApp = require("../server/app").createApp;
var createSqlClient = require("../server/sql").createSqlClient;
var applySchema = require("../server/schema").applySchema;
var economyStoreModule = require("../server/economyStore");
var shopCatalog = require("../server/shopCatalog");
var helpers = require("../test-helpers/clientModule");

var rootDir = path.resolve(__dirname, "..");
var sharedRuntimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "economy-"));
var sharedConfig = {
	rootDir: rootDir,
	staticDir: rootDir,
	runtimeDir: sharedRuntimeDir,
	pgDataDir: path.join(sharedRuntimeDir, "pgdata"),
	jwtSecret: "test-secret-key-p2-3",
	adminPasswordHash: bcrypt.hashSync("admin123", 10),
	nodeEnv: "test"
};

var sharedRuntime = createApp(sharedConfig);
var sharedSql = createSqlClient(sharedConfig);
var store = economyStoreModule.createEconomyStore({ sql: sharedSql });

/**
 * Dọn dữ liệu kinh tế; schema giữ nguyên.
 *
 * PHẢI tự gọi `applySchema` chứ không chỉ tin `createApp` đã chạy: chuỗi promise
 * của createApp là chuỗi KHÁC, nên `DELETE` có thể tới trước `CREATE TABLE` và
 * PGlite ném "relation does not exist" — bài học đã ghi ở test/dashboard.test.js.
 */
async function resetEconomy() {
	await applySchema(sharedSql);
	await sharedSql.query("DELETE FROM coin_ledger", []);
	await sharedSql.query("DELETE FROM wallet", []);
	await sharedSql.query("DELETE FROM unlocks", []);
}

/** Số dư tính lại TỪ SỔ CÁI — không đi qua bộ đệm `wallet`. */
async function ledgerSum(deviceId) {
	var result = await sharedSql.query(
		"SELECT COALESCE(SUM(amount), 0) AS balance FROM coin_ledger WHERE device_id = $1",
		[deviceId]
	);
	return Number(result.rows[0].balance);
}

async function cachedWallet(deviceId) {
	var result = await sharedSql.query("SELECT coins FROM wallet WHERE device_id = $1", [deviceId]);
	return result.rows.length > 0 ? Number(result.rows[0].coins) : 0;
}

/** Bất biến số 2 của `economyStore.js`: bộ đệm KHÔNG BAO GIỜ được lệch khỏi sổ. */
async function assertWalletMatchesLedger(deviceId, message) {
	var fromLedger = await ledgerSum(deviceId);
	var fromCache = await cachedWallet(deviceId);
	assert.equal(fromCache, fromLedger, (message || "") + " — bộ đệm ví phải khớp sổ cái");
	return fromLedger;
}

// --- Di trú một chiều local → server -----------------------------------------

test("DI TRÚ CHẠY HAI LẦN KHÔNG NHÂN ĐÔI XU (DoD 2)", async function () {
	await resetEconomy();

	var first = await store.migrateLocalWallet("dev-migrate", { coins: 1240, items: ["skin-gold", "mage"] });
	assert.equal(first.applied, true, "lần đầu phải ghi bút toán");
	assert.equal(first.migrated, true);
	assert.equal(first.coins, 1240);

	// Chạy lại HAI lần nữa — đúng kịch bản "client thử lại vì tưởng lần trước rớt".
	var second = await store.migrateLocalWallet("dev-migrate", { coins: 1240, items: ["skin-gold", "mage"] });
	var third = await store.migrateLocalWallet("dev-migrate", { coins: 1240, items: ["skin-gold", "mage"] });

	assert.equal(second.applied, false, "lần hai KHÔNG được ghi thêm bút toán");
	assert.equal(third.applied, false);
	assert.equal(second.coins, 1240, "số dư không đổi");
	assert.equal(third.coins, 1240);

	var rows = await sharedSql.query(
		"SELECT COUNT(*)::int AS total FROM coin_ledger WHERE device_id = $1 AND ref = $2",
		["dev-migrate", economyStoreModule.MIGRATION_REF]
	);
	assert.equal(rows.rows[0].total, 1, "bút toán di trú phải tồn tại ĐÚNG một dòng");

	await assertWalletMatchesLedger("dev-migrate", "sau 3 lần di trú");
});

test("di trú lần hai với số dư KHÁC cũng không ghi đè — khoá tự nhiên thắng", async function () {
	await resetEconomy();

	await store.migrateLocalWallet("dev-conflict", { coins: 800, items: [] });
	// Máy khác (hoặc localStorage bị sửa) khai 999999 xu. Sổ đã có bút toán di trú
	// nên con số mới KHÔNG có đường vào — đây là ý nghĩa thật của "một chiều, một lần".
	var again = await store.migrateLocalWallet("dev-conflict", { coins: 999999, items: [] });

	assert.equal(again.applied, false);
	assert.equal(again.coins, 800);
	assert.equal(await ledgerSum("dev-conflict"), 800);
});

test("di trú bỏ qua món lạ thay vì làm hỏng cả lần di trú", async function () {
	await resetEconomy();

	var result = await store.migrateLocalWallet("dev-junk", {
		coins: 100,
		items: ["skin-gold", "khong-co-mon-nay", "", null, "trail-none"]
	});

	// `trail-none` giá 0 → không ghi sở hữu (ai cũng có sẵn); món lạ bị bỏ.
	assert.equal(result.items, 1);
	assert.equal(result.coins, 100);

	var profile = await store.getProfile("dev-junk");
	assert.deepEqual(
		profile.unlocks.map(function (row) { return row.itemId; }),
		["skin-gold"]
	);
});

test("di trú từ chối số âm (ném lỗi 400, không phải throw đồng bộ)", async function () {
	await resetEconomy();

	// `assert.rejects` chỉ bắt được nếu hàm REJECT — `guard()` trong economyStore.js
	// tồn tại chính vì điều này (cùng bẫy đã ghi ở questionStore.js).
	await assert.rejects(
		function () { return store.migrateLocalWallet("dev-neg", { coins: -5 }); },
		/non-negative/
	);
});

// --- Sổ cái append-only + số dư suy từ sổ ------------------------------------

test("SỐ DƯ LUÔN KHỚP SỔ CÁI sau một chuỗi thao tác dài (DoD 3)", async function () {
	await resetEconomy();

	await store.migrateLocalWallet("dev-sum", { coins: 500, items: [] });
	await store.recordEntries("dev-sum", {
		entries: [
			{ ref: "a1", kind: "run", amount: 120 },
			{ ref: "a2", kind: "mission", amount: 60 },
			{ ref: "a3", kind: "revive", amount: -80 }
		]
	});
	await store.purchase("dev-sum", { ref: "b1", itemId: "skin-gold" });
	await store.recordEntries("dev-sum", { entries: [{ ref: "a4", kind: "run", amount: 45 }] });

	var balance = await assertWalletMatchesLedger("dev-sum", "chuỗi 6 bút toán");
	assert.equal(balance, 500 + 120 + 60 - 80 - 150 + 45);

	var profile = await store.getProfile("dev-sum");
	// API tự phơi CẢ HAI con số để lệch (nếu có) lộ ra ở đây chứ không ở chỗ khác.
	assert.equal(profile.wallet.coins, profile.ledger.balance);
	assert.equal(profile.ledger.entries, 6);
});

/** Bỏ chú thích trước khi soi mã: chính chú thích của file cũng nhắc tới các câu bị cấm. */
function stripComments(text) {
	return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("SỔ CÁI LÀ APPEND-ONLY — mã nguồn không có UPDATE/DELETE trên coin_ledger (DoD 4)", function () {
	var source = stripComments(fs.readFileSync(path.join(rootDir, "server", "economyStore.js"), "utf8"));

	assert.equal(/UPDATE\s+coin_ledger/i.test(source), false, "không được có UPDATE coin_ledger");
	assert.equal(/DELETE\s+FROM\s+coin_ledger/i.test(source), false, "không được có DELETE FROM coin_ledger");
	// Bộ đệm ví phải được TÍNH LẠI bằng SUM, không phải cộng dồn `coins = coins + …`.
	assert.equal(/coins\s*=\s*wallet\.coins\s*\+/i.test(source), false, "ví không được cộng dồn");
	assert.ok(
		source.indexOf("COALESCE(SUM(amount), 0), now() FROM coin_ledger") !== -1,
		"ví phải được tính lại từ SUM trên sổ cái"
	);
});

test("gửi lại cùng ref là NO-OP, kể cả trong cùng một mẻ", async function () {
	await resetEconomy();

	var first = await store.recordEntries("dev-dup", {
		entries: [
			{ ref: "same", kind: "run", amount: 200 },
			{ ref: "same", kind: "run", amount: 200 }
		]
	});

	assert.equal(first.coins, 200, "hai dòng cùng ref chỉ được tính một lần");
	assert.equal(first.results[0].applied, true);
	assert.equal(first.results[1].applied, false);
	assert.equal(first.results[1].accepted, true, "trùng ref vẫn là 'đã nhận' — client bỏ khỏi hàng đợi được");

	// Gửi lại trong một REQUEST khác (đúng kịch bản đứt mạng rồi thử lại).
	var second = await store.recordEntries("dev-dup", { entries: [{ ref: "same", kind: "run", amount: 200 }] });
	assert.equal(second.coins, 200);
	await assertWalletMatchesLedger("dev-dup", "sau khi gửi lại");
});

test("bút toán âm quá số dư bị từ chối, các bút toán khác trong mẻ vẫn được nhận", async function () {
	await resetEconomy();

	var result = await store.recordEntries("dev-partial", {
		entries: [
			{ ref: "p1", kind: "run", amount: 100 },
			{ ref: "p2", kind: "revive", amount: -500 },
			{ ref: "p3", kind: "mission", amount: 30 }
		]
	});

	assert.equal(result.results[0].accepted, true);
	assert.equal(result.results[1].accepted, false, "tiêu quá số dư phải bị từ chối");
	assert.equal(result.results[1].reason, "not-enough-coins");
	assert.equal(result.results[2].accepted, true, "một dòng hỏng KHÔNG được làm hỏng cả mẻ");
	assert.equal(result.coins, 130);
});

test("THỨ TỰ trong mẻ được tôn trọng: 'nhận 150 rồi tiêu 150' thành công dù số dư ban đầu là 0", async function () {
	await resetEconomy();

	// Đây chính là kịch bản outbox replay sau khi rớt mạng: server chưa biết gì về
	// 150 xu em ấy nhặt được, nhưng hai bút toán tới cùng nhau và ĐÚNG THỨ TỰ.
	var result = await store.recordEntries("dev-order", {
		entries: [
			{ ref: "o1", kind: "run", amount: 150 },
			{ ref: "o2", kind: "purchase", amount: -150 }
		]
	});

	assert.equal(result.results[0].accepted, true);
	assert.equal(result.results[1].accepted, true, "thứ tự sai thì dòng này bị từ chối oan");
	assert.equal(result.coins, 0);
});

test("kind/ref/amount sai bị từ chối bằng reject, không throw đồng bộ", async function () {
	await resetEconomy();

	await assert.rejects(function () {
		return store.recordEntries("dev-bad", { entries: [{ ref: "x", kind: "hack", amount: 10 }] });
	}, /kind/);

	await assert.rejects(function () {
		return store.recordEntries("dev-bad", { entries: [{ ref: "", kind: "run", amount: 10 }] });
	}, /ref/);

	await assert.rejects(function () {
		return store.recordEntries("dev-bad", { entries: [{ ref: "y", kind: "run", amount: 99999999 }] });
	}, /out of range/);

	await assert.rejects(function () {
		return store.recordEntries("dev-bad", { entries: [] });
	}, /non-empty/);
});

// --- Mua hàng ----------------------------------------------------------------

test("MUA KHI KHÔNG ĐỦ XU BỊ TỪ CHỐI, và KHÔNG phát đồ (DoD 5 + 6)", async function () {
	await resetEconomy();

	await store.migrateLocalWallet("dev-poor", { coins: 100, items: [] });
	var result = await store.purchase("dev-poor", { ref: "buy-1", itemId: "barbarian" });

	assert.equal(result.ok, false);
	assert.equal(result.reason, "not-enough-coins");
	assert.equal(result.coins, 100, "số dư không được đụng vào");

	var profile = await store.getProfile("dev-poor");
	assert.equal(profile.unlocks.length, 0, "từ chối rồi mà vẫn phát đồ là lỗi tệ nhất có thể");
	await assertWalletMatchesLedger("dev-poor", "sau lần mua bị từ chối");
});

test("GIÁ LẤY TỪ CATALOG SERVER, không phải từ body (DoD 5)", async function () {
	await resetEconomy();

	await store.migrateLocalWallet("dev-price", { coins: 1000, items: [] });
	// Client gian lận khai giá 1 xu cho món 800 xu.
	var result = await store.purchase("dev-price", {
		ref: "buy-cheat",
		itemId: "barbarian",
		price: 1,
		paidCoins: 1,
		amount: -1
	});

	assert.equal(result.ok, true);
	assert.equal(result.paidCoins, 800, "phải trừ đúng giá catalog");
	assert.equal(result.coins, 200);
});

test("mua lại cùng ref KHÔNG trừ lần hai (DoD 6)", async function () {
	await resetEconomy();

	await store.migrateLocalWallet("dev-replay", { coins: 1000, items: [] });
	var first = await store.purchase("dev-replay", { ref: "buy-r", itemId: "rogue" });
	var again = await store.purchase("dev-replay", { ref: "buy-r", itemId: "rogue" });

	assert.equal(first.paidCoins, 500);
	assert.equal(again.ok, true);
	assert.equal(again.replayed, true);
	assert.equal(again.paidCoins, 0, "lần gửi lại không được trừ thêm xu");
	assert.equal(again.coins, 500);
	await assertWalletMatchesLedger("dev-replay", "sau khi mua lại cùng ref");
});

test("món ĐÃ SỞ HỮU không bị trừ tiền lần hai dù ref mới", async function () {
	await resetEconomy();

	// Món đã có từ đường di trú — không được trừ tiền khi client lỡ gửi lệnh mua.
	await store.migrateLocalWallet("dev-owned", { coins: 1000, items: ["mage"] });
	var result = await store.purchase("dev-owned", { ref: "buy-new-ref", itemId: "mage" });

	assert.equal(result.ok, false);
	assert.equal(result.reason, "already-owned");
	assert.equal(result.coins, 1000, "số dư phải nguyên vẹn");
});

test("mở khoá bằng mốc thành tích: ghi sở hữu, KHÔNG trừ xu, và có dấu vết `source`", async function () {
	await resetEconomy();

	await store.migrateLocalWallet("dev-ach", { coins: 50, items: [] });
	var result = await store.purchase("dev-ach", { ref: "ach-1", itemId: "mage", source: "achievement" });

	assert.equal(result.ok, true);
	assert.equal(result.paidCoins, 0);
	assert.equal(result.coins, 50);

	var profile = await store.getProfile("dev-ach");
	assert.equal(profile.unlocks[0].itemId, "mage");
	// Dấu vết để admin phân biệt món MUA với món nhận nhờ mốc — Q6 local-trust nghĩa
	// là server ghi nhận chứ không thẩm định, và điều đó phải nhìn thấy được.
	assert.equal(profile.unlocks[0].source, "achievement");
});

test("món lạ / source lạ bị từ chối", async function () {
	await resetEconomy();

	await assert.rejects(function () {
		return store.purchase("dev-x", { ref: "r", itemId: "sonic-vang" });
	}, /Unknown shop item/);

	await assert.rejects(function () {
		return store.purchase("dev-x", { ref: "r", itemId: "mage", source: "free-money" });
	}, /source/);
});

// --- Catalog -----------------------------------------------------------------

test("CATALOG SERVER KHỚP TỪNG ID/Ô/GIÁ VỚI BẢNG GIÁ CLIENT (DoD 11)", async function () {
	// Hai bảng chạy song song thì sớm muộn cũng trôi khỏi nhau. Đây là chỗ duy nhất
	// phát hiện được điều đó trước khi một em bị trừ 800 xu cho món client ghi 300.
	var mods = await helpers.loadClientBundle({
		unlockRules: "systems/unlockRules.ts",
		cosmeticRules: "systems/cosmeticRules.ts"
	});

	var expected = [];

	mods.unlockRules.UNLOCK_RULES.forEach(function (rule) {
		expected.push({ id: rule.characterId, slot: "character", price: rule.price });
	});

	mods.cosmeticRules.COSMETICS.forEach(function (item) {
		expected.push({ id: item.id, slot: item.slot, price: item.price });
	});

	var actual = shopCatalog.listCatalog().map(function (item) {
		return { id: item.id, slot: item.slot, price: item.price };
	});

	function byId(a, b) {
		return a.id < b.id ? -1 : 1;
	}

	assert.deepEqual(actual.slice().sort(byId), expected.slice().sort(byId));
});

// --- Route HTTP --------------------------------------------------------------

test("5 route mới trả đúng shape, và ví local đi trọn một vòng qua HTTP", async function () {
	await resetEconomy();

	var agent = request(sharedRuntime.app);

	var catalog = await agent.get("/api/shop/catalog").expect(200);
	assert.ok(Array.isArray(catalog.body.items));
	assert.equal(catalog.body.items.length, shopCatalog.CATALOG.length);

	var migrated = await agent
		.post("/api/players/http-1/wallet/migrate")
		.send({ coins: 700, items: ["skin-gold"] })
		.expect(200);
	assert.equal(migrated.body.migrated, true);
	assert.equal(migrated.body.coins, 700);

	var entries = await agent
		.post("/api/players/http-1/wallet/entries")
		.send({ entries: [{ ref: "http-a", kind: "run", amount: 130 }] })
		.expect(200);
	assert.equal(entries.body.coins, 830);

	var bought = await agent
		.post("/api/players/http-1/purchases")
		.send({ ref: "http-b", itemId: "rogue" })
		.expect(200);
	assert.equal(bought.body.ok, true);
	assert.equal(bought.body.coins, 330);

	var profile = await agent.get("/api/players/http-1/profile").expect(200);
	assert.equal(profile.body.deviceId, "http-1");
	assert.equal(profile.body.wallet.coins, 330);
	assert.equal(profile.body.ledger.balance, 330);
	assert.equal(profile.body.migrated, true);
	assert.deepEqual(
		profile.body.unlocks.map(function (row) { return row.itemId; }).sort(),
		["rogue", "skin-gold"]
	);
});

test("không đủ xu trả 200 kèm lý do (không phải lỗi giao thức)", async function () {
	await resetEconomy();

	var response = await request(sharedRuntime.app)
		.post("/api/players/http-poor/purchases")
		.send({ ref: "x", itemId: "barbarian" })
		.expect(200);

	assert.equal(response.body.ok, false);
	assert.equal(response.body.reason, "not-enough-coins");
	assert.equal(response.body.coins, 0);
});

test("đầu vào hỏng trả 400 kèm thông điệp, KHÔNG phải 500", async function () {
	await resetEconomy();

	var agent = request(sharedRuntime.app);

	await agent.post("/api/players/http-bad/wallet/migrate").send({ coins: "abc" }).expect(400);
	await agent.post("/api/players/http-bad/wallet/entries").send({ entries: [{ ref: "r", kind: "z", amount: 1 }] }).expect(400);
	await agent.post("/api/players/http-bad/purchases").send({ ref: "r", itemId: "khong-ton-tai" }).expect(400);
});

test("RATE-LIMIT ĐẾM THEO deviceId, KHÔNG theo IP (DoD 9)", async function () {
	await resetEconomy();

	// Cả phòng máy trường đi qua MỘT IP sau NAT. Nếu limiter đếm theo IP thì em thứ
	// hai bị chặn vì em thứ nhất chơi nhiều — đây là test canh đúng chỗ đó.
	//
	// App RIÊNG để bộ đếm sạch, nhưng DÙNG LẠI `pgDataDir` (server/sql.js cache
	// client theo thư mục) nên KHÔNG có cluster PGlite thứ hai nào được tạo ra.
	var runtime = createApp(sharedConfig);
	var agent = request(runtime.app);
	var blocked = false;

	for (var index = 0; index < 65; index += 1) {
		var response = await agent.get("/api/players/lop-6a-may-01/profile");

		if (response.status === 429) {
			blocked = true;
			break;
		}
	}

	assert.equal(blocked, true, "một máy gọi quá nhiều thì phải bị chặn");

	// Máy THỨ HAI cùng IP vẫn phải đi được — nếu test này đỏ, cả lớp bị chặn oan.
	await agent.get("/api/players/lop-6a-may-02/profile").expect(200);
});

// --- Tắt êm khi chưa có CSDL --------------------------------------------------

test("KHÔNG CÓ CSDL → mọi route kinh tế `disabled: true`, không route nào 500 (DoD 8)", async function () {
	var disabled = economyStoreModule.createEconomyStore({ sql: null });

	var profile = await disabled.getProfile("dev-off");
	assert.equal(profile.disabled, true);
	assert.equal(profile.wallet.coins, 0);
	assert.deepEqual(profile.unlocks, []);

	var migrated = await disabled.migrateLocalWallet("dev-off", { coins: 500, items: ["mage"] });
	assert.equal(migrated.disabled, true);
	assert.equal(migrated.migrated, false, "chưa bật CSDL thì KHÔNG được báo là đã di trú");

	var entries = await disabled.recordEntries("dev-off", { entries: [{ ref: "r", kind: "run", amount: 10 }] });
	assert.equal(entries.disabled, true);

	var bought = await disabled.purchase("dev-off", { ref: "r", itemId: "mage" });
	assert.equal(bought.disabled, true);
	assert.equal(bought.ok, false);
});

// --- Schema idempotent --------------------------------------------------------

test("applySchema chạy lại KHÔNG ghi đè dữ liệu và KHÔNG nhân đôi dòng (DoD 1)", async function () {
	await resetEconomy();

	await store.migrateLocalWallet("dev-schema", { coins: 333, items: ["mage"] });

	// `npm run migrate` chạy hai lần liên tiếp = đúng chuỗi này.
	await applySchema(sharedSql);
	await applySchema(sharedSql);

	assert.equal(await ledgerSum("dev-schema"), 333);

	var unlocks = await sharedSql.query("SELECT COUNT(*)::int AS total FROM unlocks WHERE device_id = $1", ["dev-schema"]);
	assert.equal(unlocks.rows[0].total, 1);

	// Ba bảng của P2-3 phải tồn tại thật (chứ không chỉ "không lỗi").
	var tables = await sharedSql.query(
		"SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('wallet','coin_ledger','unlocks')",
		[]
	);
	assert.equal(tables.rows.length, 3);
});
