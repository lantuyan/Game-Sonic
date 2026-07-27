"use strict";

// Nền kinh tế server-side (P2-3): ví · sổ cái xu · quyền sở hữu.
//
// ĐÂY LÀ MÃ ĐỘNG VÀO TIỀN CỦA NGƯỜI CHƠI. Ba bất biến, mọi thay đổi phải giữ:
//
//   1. `coin_ledger` là APPEND-ONLY. File này không có một câu `UPDATE coin_ledger`
//      hay `DELETE FROM coin_ledger` nào, và có test đọc mã nguồn canh điều đó.
//   2. Số dư KHÔNG được cộng dồn kiểu `coins = coins + delta`. Mỗi lần ghi sổ,
//      bảng `wallet` được TÍNH LẠI bằng `SUM(amount)` trên chính sổ cái, trong
//      CÙNG transaction. Nhờ vậy bộ đệm không thể trôi khỏi sổ — kể cả khi một
//      request chết giữa chừng.
//   3. Mọi bút toán mang một `ref` do client sinh, có `UNIQUE (device_id, ref)` +
//      `ON CONFLICT DO NOTHING`. Gửi lại cùng `ref` là **no-op**. Đứt mạng rồi
//      gửi lại là chuyện BÌNH THƯỜNG ở phòng máy trường, phải vô hại theo thiết
//      kế chứ không nhờ may mắn. Cùng khuôn `seedIfEmpty` của questionStore.js.
//
// Điều kiện đủ xu được kiểm NGAY TRONG CÂU SQL (`... WHERE balance + amount >= 0`)
// chứ không phải "đọc số dư rồi mới ghi": hai request cùng lúc của một máy sẽ cùng
// đọc ra số dư cũ và cùng tiêu, còn câu điều kiện thì không.
//
// Cái file này CỐ Ý KHÔNG làm: thẩm định mốc thành tích. Q6 (plan §3) đã chốt tiến
// trình là local-trust; server GHI NHẬN nguồn gốc (`source = 'achievement'`) để
// admin nhìn ra, chứ không giả vờ kiểm được thứ chỉ có trên máy người chơi. Thứ
// server thật sự bảo vệ là XU — tài nguyên khan hiếm duy nhất — và nó bảo vệ bằng
// cách chỉ tin bảng giá của chính mình (`server/shopCatalog.js`).

var shopCatalog = require("./shopCatalog");

var MAX_DEVICE_ID_LENGTH = 64;
var MAX_REF_LENGTH = 100;
var MAX_REASON_LENGTH = 120;
/** Trần số dư — chặn client hỏng ghi những con số vô nghĩa vào sổ. */
var MAX_COINS = 100000000;
/** Trần một bút toán. Một ván tốt nhất cũng chỉ vài trăm xu. */
var MAX_ENTRY_AMOUNT = 1000000;
/** Một lần đẩy outbox tối đa bấy nhiêu bút toán. */
var MAX_ENTRIES_PER_REQUEST = 50;
var MAX_ITEMS_PER_MIGRATION = 100;

/** Khoá tự nhiên CỐ ĐỊNH của bút toán di trú. Đây là thứ khiến di trú chạy lại vô hại. */
var MIGRATION_REF = "migrate:local-v2";

var ENTRY_KINDS = ["run", "mission", "streak", "revive", "purchase", "migrate", "adjust"];
var UNLOCK_SOURCES = ["coins", "achievement", "migrate"];

function badRequest(message) {
	var error = new Error(message);
	error.statusCode = 400;
	return error;
}

function requireDeviceId(value) {
	var deviceId = String(value == null ? "" : value).trim();

	if (deviceId === "" || deviceId.length > MAX_DEVICE_ID_LENGTH) {
		throw badRequest("A valid deviceId is required.");
	}

	return deviceId;
}

function requireRef(value) {
	var ref = String(value == null ? "" : value).trim();

	if (ref === "" || ref.length > MAX_REF_LENGTH) {
		throw badRequest("A valid ref is required.");
	}

	return ref;
}

function requireKind(value) {
	var kind = String(value == null ? "" : value).trim();

	if (ENTRY_KINDS.indexOf(kind) === -1) {
		throw badRequest("Field \"kind\" must be one of: " + ENTRY_KINDS.join(", ") + ".");
	}

	return kind;
}

/** Số nguyên có dấu, trong dải cho phép. Số lẻ bị cắt xuống — xu không có phần thập phân. */
function requireAmount(value) {
	var amount = Number(value);

	if (isFinite(amount) === false) {
		throw badRequest("Field \"amount\" must be a number.");
	}

	amount = Math.trunc(amount);

	if (Math.abs(amount) > MAX_ENTRY_AMOUNT) {
		throw badRequest("Field \"amount\" is out of range.");
	}

	return amount;
}

function optionalText(value, maxLength) {
	if (value == null) {
		return null;
	}

	var text = String(value).trim();
	return text === "" ? null : text.slice(0, maxLength);
}

/** Số dư hiện tại suy từ sổ cái, dùng làm mệnh đề con trong câu điều kiện. */
var BALANCE_SUBQUERY = "(SELECT COALESCE(SUM(amount), 0) FROM coin_ledger WHERE device_id = $1::text)";

/**
 * Ghi một bút toán CÓ ĐIỀU KIỆN.
 *
 * Điều kiện nằm trong chính câu SQL nên không có khe hở giữa lúc đọc số dư và lúc
 * ghi. `ON CONFLICT DO NOTHING` lo phần gửi lại. Hai cơ chế độc lập, cùng một câu.
 */
function conditionalLedgerInsert(deviceId, ref, kind, amount, reason, extraCondition, extraParams) {
	return {
		text:
			"INSERT INTO coin_ledger (device_id, ref, kind, amount, reason) " +
			"SELECT $1::text, $2::text, $3::text, $4::bigint, $5::text " +
			"WHERE " + BALANCE_SUBQUERY + " + $4::bigint BETWEEN 0 AND " + MAX_COINS +
			(extraCondition != null ? " AND " + extraCondition : "") + " " +
			"ON CONFLICT (device_id, ref) DO NOTHING RETURNING id",
		params: [deviceId, ref, kind, amount, reason].concat(extraParams || [])
	};
}

/** Bút toán này đã nằm trong sổ chưa (dù vừa ghi hay đã có từ lần trước). */
function ledgerExists(deviceId, ref) {
	return {
		text: "SELECT amount FROM coin_ledger WHERE device_id = $1::text AND ref = $2::text",
		params: [deviceId, ref]
	};
}

/**
 * TÍNH LẠI số dư từ sổ cái — không phải cộng dồn.
 *
 * Đây là câu quan trọng nhất file này. Vì `coins` luôn bằng `SUM(amount)` chứ
 * không bằng "giá trị cũ + delta", bộ đệm không có cách nào lệch khỏi sổ: một
 * request chết nửa chừng chỉ để lại sổ chưa có dòng mới, chứ không để lại số dư sai.
 */
function recomputeWallet(deviceId) {
	return {
		text:
			"INSERT INTO wallet (device_id, coins, updated_at) " +
			"SELECT $1::text, COALESCE(SUM(amount), 0), now() FROM coin_ledger WHERE device_id = $1::text " +
			"ON CONFLICT (device_id) DO UPDATE SET coins = EXCLUDED.coins, updated_at = now()",
		params: [deviceId]
	};
}

function selectWallet(deviceId) {
	return {
		text: "SELECT coins FROM wallet WHERE device_id = $1::text",
		params: [deviceId]
	};
}

function coinsFrom(result) {
	var row = result != null && result.rows ? result.rows[0] : null;
	return row != null && row.coins != null ? Number(row.coins) : 0;
}

/**
 * Không có CSDL (dev chưa nối Neon, hoặc Vercel chưa cấu hình) → TẮT ÊM, đúng
 * khuôn `createDisabledPlayerStore`. Game vẫn chơi trọn vẹn bằng ví local; phần
 * server chỉ đơn giản là chưa bật. Không route nào được ném 500 vì chuyện này.
 */
function createDisabledEconomyStore() {
	function disabledProfile(deviceId) {
		return {
			deviceId: deviceId,
			nickname: null,
			wallet: { coins: 0 },
			ledger: { entries: 0, balance: 0, lastAt: null },
			unlocks: [],
			bestScoreByLevel: {},
			migrated: false,
			disabled: true
		};
	}

	return {
		disabled: true,
		getProfile: function (deviceId) {
			return Promise.resolve(disabledProfile(String(deviceId == null ? "" : deviceId)));
		},
		migrateLocalWallet: function (deviceId) {
			return Promise.resolve({
				deviceId: String(deviceId == null ? "" : deviceId),
				migrated: false,
				applied: false,
				coins: 0,
				items: 0,
				disabled: true
			});
		},
		recordEntries: function (deviceId) {
			return Promise.resolve({
				deviceId: String(deviceId == null ? "" : deviceId),
				results: [],
				coins: 0,
				disabled: true
			});
		},
		purchase: function (deviceId, payload) {
			var itemId = payload != null ? String(payload.itemId == null ? "" : payload.itemId) : "";
			return Promise.resolve({ ok: false, reason: "disabled", itemId: itemId, coins: 0, disabled: true });
		}
	};
}

function createEconomyStore(options) {
	var sql = options && options.sql ? options.sql : null;

	if (sql == null) {
		return createDisabledEconomyStore();
	}

	var applySchema = require("./schema").applySchema;
	var readyPromise = applySchema(sql);

	function ready() {
		return readyPromise;
	}

	function run(text, params) {
		return ready().then(function () {
			return sql.query(text, params || []);
		});
	}

	// --- Hồ sơ người chơi -----------------------------------------------------

	/**
	 * Trả về CẢ số dư bộ đệm (`wallet.coins`) LẪN số dư suy từ sổ (`ledger.balance`).
	 *
	 * Cố ý trả cả hai: nếu một ngày nào đó chúng lệch nhau thì thứ phát hiện ra
	 * phải là chính API này, chứ không phải một phụ huynh đếm xu hộ con.
	 */
	function getProfile(deviceId) {
		var id = requireDeviceId(deviceId);

		return ready().then(function () {
			return Promise.all([
				sql.query("SELECT coins FROM wallet WHERE device_id = $1", [id]),
				sql.query(
					"SELECT COUNT(*)::int AS entries, COALESCE(SUM(amount), 0) AS balance, MAX(created_at) AS last_at " +
					"FROM coin_ledger WHERE device_id = $1",
					[id]
				),
				sql.query(
					"SELECT item_id, slot, source, paid_coins, created_at FROM unlocks " +
					"WHERE device_id = $1 ORDER BY created_at ASC, item_id ASC",
					[id]
				),
				sql.query("SELECT nickname FROM players WHERE device_id = $1", [id]),
				sql.query("SELECT level, MAX(score) AS best FROM scores WHERE device_id = $1 GROUP BY level", [id]),
				sql.query("SELECT 1 FROM coin_ledger WHERE device_id = $1 AND ref = $2", [id, MIGRATION_REF])
			]);
		}).then(function (parts) {
			var ledgerRow = parts[1].rows[0] || {};
			var bestScoreByLevel = {};

			parts[4].rows.forEach(function (row) {
				bestScoreByLevel[row.level] = Number(row.best);
			});

			return {
				deviceId: id,
				nickname: parts[3].rows[0] != null ? parts[3].rows[0].nickname : null,
				wallet: { coins: coinsFrom(parts[0]) },
				ledger: {
					entries: Number(ledgerRow.entries || 0),
					balance: Number(ledgerRow.balance || 0),
					lastAt: ledgerRow.last_at != null ? ledgerRow.last_at : null
				},
				unlocks: parts[2].rows.map(function (row) {
					return {
						itemId: row.item_id,
						slot: row.slot,
						source: row.source,
						paidCoins: Number(row.paid_coins),
						createdAt: row.created_at
					};
				}),
				bestScoreByLevel: bestScoreByLevel,
				migrated: parts[5].rows.length > 0
			};
		});
	}

	// --- Di trú MỘT CHIỀU local → server --------------------------------------

	/**
	 * Đẩy ví local lên server ĐÚNG MỘT LẦN.
	 *
	 * Bảo đảm nằm ở `ref = MIGRATION_REF` cố định + `ON CONFLICT DO NOTHING`, KHÔNG
	 * nằm ở cờ `migratedToServer` phía client. Cờ đó chỉ là tối ưu để khỏi gọi lại;
	 * nếu nó mất (xoá localStorage, đổi máy, ghi hỏng) thì lần gọi sau vẫn không
	 * nhân đôi một xu nào.
	 *
	 * Chỉ ghi bút toán, KHÔNG đụng gì tới dữ liệu local — việc "xoá ví local" không
	 * tồn tại trong thiết kế này, chính là để không có kịch bản nào làm bốc hơi xu.
	 */
	function migrateLocalWallet(deviceId, payload) {
		var id = requireDeviceId(deviceId);
		var data = payload || {};
		var coins = Number(data.coins);

		if (isFinite(coins) === false || coins < 0) {
			throw badRequest("Field \"coins\" must be a non-negative number.");
		}

		coins = Math.min(Math.trunc(coins), MAX_COINS);

		// Món lạ bị BỎ QUA chứ không làm hỏng cả lần di trú: bản client cũ/mới có
		// thể lệch nhau một món, mà mất cả ví vì chuyện đó là không chấp nhận được.
		var rawItems = Array.isArray(data.items) ? data.items.slice(0, MAX_ITEMS_PER_MIGRATION) : [];
		var items = [];

		rawItems.forEach(function (entry) {
			var itemId = typeof entry === "string" ? entry : (entry != null ? entry.itemId : null);
			var item = shopCatalog.getCatalogItem(itemId);

			if (item != null && item.price > 0 && items.indexOf(item) === -1) {
				items.push(item);
			}
		});

		return ready().then(function () {
			var statements = [
				conditionalLedgerInsert(id, MIGRATION_REF, "migrate", coins, "Chuyển ví từ máy lên máy chủ")
			];

			items.forEach(function (item) {
				statements.push({
					text:
						"INSERT INTO unlocks (device_id, item_id, slot, source, paid_coins, ref) " +
						"VALUES ($1,$2,$3,'migrate',0,$4) ON CONFLICT (device_id, item_id) DO NOTHING",
					params: [id, item.id, item.slot, MIGRATION_REF]
				});
			});

			statements.push(recomputeWallet(id));
			statements.push(selectWallet(id));
			statements.push(ledgerExists(id, MIGRATION_REF));

			return sql.batch(statements);
		}).then(function (results) {
			var appliedNow = results[0].rows.length > 0;
			var walletResult = results[results.length - 2];
			var migrationRow = results[results.length - 1].rows[0];

			return {
				deviceId: id,
				// `migrated` = sổ cái ĐÃ CÓ bút toán di trú (lần này hoặc lần trước).
				// Client chỉ được đặt cờ khi thấy true — đó là "server xác nhận đã nhận".
				migrated: migrationRow != null,
				// `applied` = bút toán được ghi TRONG LẦN GỌI NÀY. False ở lần chạy lại.
				applied: appliedNow,
				coins: coinsFrom(walletResult),
				items: items.length
			};
		});
	}

	// --- Sổ cái: nhận / tiêu xu -----------------------------------------------

	/**
	 * Ghi một mẻ bút toán (một lần đẩy outbox = một request).
	 *
	 * Bút toán bị từ chối KHÔNG làm hỏng cả mẻ — mỗi dòng có kết quả riêng. Lý do
	 * giống `recordRunSummary` của P1-6: 400 cả mẻ thì em đó mất sạch, mà thứ hỏng
	 * chỉ là một dòng.
	 *
	 * Thứ tự trong mẻ được TÔN TRỌNG (chạy tuần tự trong một transaction), nên
	 * outbox replay đúng thứ tự "nhận 150 rồi tiêu 150" luôn thành công, dù lúc bắt
	 * đầu số dư trên server là 0.
	 */
	function recordEntries(deviceId, payload) {
		var id = requireDeviceId(deviceId);
		var data = payload || {};
		var rawEntries = Array.isArray(data.entries) ? data.entries : [];

		if (rawEntries.length === 0) {
			throw badRequest("Field \"entries\" must be a non-empty array.");
		}

		if (rawEntries.length > MAX_ENTRIES_PER_REQUEST) {
			throw badRequest("Too many entries in one request (max " + MAX_ENTRIES_PER_REQUEST + ").");
		}

		var entries = rawEntries.map(function (entry) {
			var item = entry != null && typeof entry === "object" ? entry : {};

			return {
				ref: requireRef(item.ref),
				kind: requireKind(item.kind),
				amount: requireAmount(item.amount),
				reason: optionalText(item.reason, MAX_REASON_LENGTH)
			};
		});

		return ready().then(function () {
			var statements = [];

			entries.forEach(function (entry) {
				statements.push(conditionalLedgerInsert(id, entry.ref, entry.kind, entry.amount, entry.reason));
				statements.push(ledgerExists(id, entry.ref));
			});

			statements.push(recomputeWallet(id));
			statements.push(selectWallet(id));

			return sql.batch(statements);
		}).then(function (results) {
			var walletResult = results[results.length - 1];

			return {
				deviceId: id,
				results: entries.map(function (entry, index) {
					var insertResult = results[index * 2];
					var existsResult = results[index * 2 + 1];
					var inLedger = existsResult.rows.length > 0;

					return {
						ref: entry.ref,
						// `accepted` bao gồm cả lần gửi lại: bút toán ĐÃ nằm trong sổ nghĩa
						// là client có thể yên tâm bỏ nó khỏi outbox.
						accepted: inLedger,
						applied: insertResult.rows.length > 0,
						reason: inLedger
							? null
							: (entry.amount < 0 ? "not-enough-coins" : "balance-cap")
					};
				}),
				coins: coinsFrom(walletResult)
			};
		});
	}

	// --- Mua hàng --------------------------------------------------------------

	/**
	 * Mua một món trong catalog.
	 *
	 * GIÁ LẤY TỪ `server/shopCatalog.js`, không bao giờ từ body — đây là toàn bộ lý
	 * do bảng giá được đưa lên server. Trừ xu và ghi quyền sở hữu nằm trong CÙNG
	 * một transaction, nên không có trạng thái "đã trừ tiền mà chưa có đồ".
	 */
	function purchase(deviceId, payload) {
		var id = requireDeviceId(deviceId);
		var data = payload || {};
		var ref = requireRef(data.ref);
		var item = shopCatalog.getCatalogItem(data.itemId);

		if (item == null) {
			throw badRequest("Unknown shop item.");
		}

		var source = String(data.source == null ? "coins" : data.source);

		if (UNLOCK_SOURCES.indexOf(source) === -1) {
			throw badRequest("Field \"source\" must be one of: " + UNLOCK_SOURCES.join(", ") + ".");
		}

		// Mốc thành tích (Q6 local-trust) và món miễn phí đều KHÔNG tốn xu; món trả
		// tiền thì lấy đúng giá catalog.
		var price = source === "coins" ? item.price : 0;

		return ready().then(function () {
			return sql.batch([
				// (0) Sở hữu TRƯỚC giao dịch — để phân biệt "đã có rồi" với "không đủ xu".
				{
					text: "SELECT source FROM unlocks WHERE device_id = $1::text AND item_id = $2::text",
					params: [id, item.id]
				},
				// (1) Trừ xu — chỉ khi đủ tiền VÀ chưa sở hữu. Điều kiện "chưa sở hữu"
				// chặn kịch bản trừ tiền lần hai cho món đã có từ đường khác (di trú,
				// mốc thành tích) với một `ref` mới.
				conditionalLedgerInsert(
					id,
					ref,
					"purchase",
					-price,
					item.label,
					"NOT EXISTS (SELECT 1 FROM unlocks WHERE device_id = $1::text AND item_id = $6::text)",
					[item.id]
				),
				// (2) Bút toán đã vào sổ chưa (lần này hoặc lần gửi lại trước đó).
				ledgerExists(id, ref),
				// (3) Ghi quyền sở hữu — CHỈ KHI bút toán có trong sổ. Không có bước này
				// thì một lần mua bị từ chối vì thiếu xu vẫn phát đồ.
				{
					text:
						"INSERT INTO unlocks (device_id, item_id, slot, source, paid_coins, ref) " +
						"SELECT $1::text, $2::text, $3::text, $4::text, $5::int, $6::text " +
						"WHERE EXISTS (SELECT 1 FROM coin_ledger WHERE device_id = $1::text AND ref = $6::text) " +
						"ON CONFLICT (device_id, item_id) DO NOTHING",
					params: [id, item.id, item.slot, source, price, ref]
				},
				recomputeWallet(id),
				selectWallet(id)
			]);
		}).then(function (results) {
			var ownedBefore = results[0].rows.length > 0;
			var inLedger = results[2].rows.length > 0;
			var coins = coinsFrom(results[5]);

			if (inLedger === false) {
				return {
					ok: false,
					reason: ownedBefore === true ? "already-owned" : "not-enough-coins",
					itemId: item.id,
					price: price,
					coins: coins
				};
			}

			return {
				ok: true,
				itemId: item.id,
				slot: item.slot,
				source: source,
				// Giá THỰC SỰ bị trừ trong lần gọi này; lần gửi lại là 0 vì sổ không
				// nhận thêm dòng nào.
				paidCoins: results[1].rows.length > 0 ? price : 0,
				price: price,
				replayed: results[1].rows.length === 0,
				coins: coins
			};
		});
	}

	/**
	 * Cùng lý do như `questionStore.guard`: giao diện nửa-đồng-bộ-nửa-bất-đồng-bộ là
	 * cái bẫy kinh điển. Ở đây nó còn nặng hơn — người gọi dùng `.catch()` mà lỗi
	 * lại throw đồng bộ thì một request tiêu xu hỏng sẽ nổ ra ngoài mọi lớp xử lý.
	 */
	function guard(fn) {
		return function () {
			var args = arguments;

			return Promise.resolve().then(function () {
				return fn.apply(null, args);
			});
		};
	}

	return {
		disabled: false,
		ready: ready,
		getProfile: guard(getProfile),
		migrateLocalWallet: guard(migrateLocalWallet),
		recordEntries: guard(recordEntries),
		purchase: guard(purchase),
		/** Chỉ dùng cho test/kiểm toán: số dư tính lại từ sổ, không qua bộ đệm. */
		ledgerBalance: guard(function (deviceId) {
			var id = requireDeviceId(deviceId);

			return run("SELECT COALESCE(SUM(amount), 0) AS balance FROM coin_ledger WHERE device_id = $1", [id])
				.then(function (result) {
					return Number(result.rows[0].balance);
				});
		})
	};
}

module.exports = {
	createEconomyStore: createEconomyStore,
	MIGRATION_REF: MIGRATION_REF,
	ENTRY_KINDS: ENTRY_KINDS,
	UNLOCK_SOURCES: UNLOCK_SOURCES,
	MAX_ENTRIES_PER_REQUEST: MAX_ENTRIES_PER_REQUEST,
	MAX_COINS: MAX_COINS
};
