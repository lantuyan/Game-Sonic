"use strict";

// P2-8 — MÙA 2 CỦA BẢNG XẾP HẠNG (plan §11 câu 5, rủi ro R10).
//
// Điều phải chứng minh, theo đúng thứ tự quan trọng:
//   1. KHÔNG MẤT MỘT DÒNG DỮ LIỆU NÀO — điểm Mùa 1 vẫn tra được sau khi mở Mùa 2;
//   2. ngày ranh giới đọc từ CẤU HÌNH, không phải hằng số chôn trong mã;
//   3. chưa cấu hình ngày ⇒ hành vi y hệt trước P2-8 (bật lên không làm gãy gì);
//   4. hợp đồng §7.3.2 của endpoint #3 giữ nguyên, phần mùa chỉ là field THÊM.

var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("path");
var bcrypt = require("bcrypt");
var request = require("../test-helpers/loopbackRequest");
var createApp = require("../server/app").createApp;
var pgTempDir = require("../test-helpers/pgTempDir");
var createSqlClient = require("../server/sql").createSqlClient;
var configModule = require("../server/config");
var season = require("../server/season");

// ⚠ MỘT thư mục dữ liệu dùng chung cho CẢ FILE.
//
// Mỗi `mkdtempSync` riêng nghĩa là một cluster PGlite (Postgres biên dịch WASM) vài
// chục MB nằm lại trong thư mục tạm; chạy `npm test` vài lượt trong một buổi là đầy
// ổ đĩa thật — đã xảy ra. `server/sql.js` cache client theo `pgDataDir`, nên dùng
// chung đường dẫn là dùng chung đúng một instance.
var sharedTempDir = pgTempDir.createTempDir("season-");
var sharedPgDataDir = path.join(sharedTempDir, "pgdata");

process.on("unhandledRejection", function (error) {
	// Tiếng ồn lúc PGlite đóng, không xảy ra với Neon. Chỉ nuốt đúng hai dạng đó.
	var name = error && error.constructor ? error.constructor.name : "";
	var message = error ? String(error.message || "") : "";

	if (name === "ErrnoError" || message.indexOf("PGlite is closed") !== -1) {
		return;
	}

	throw error;
});

/**
 * App dùng chung CSDL PGlite, chỉ khác mốc mùa.
 *
 * `databaseUrl: ""` TƯỜNG MINH — không đọc `DATABASE_URL`, không đọc `.env`, tuyệt
 * đối không chạm CSDL production.
 */
// `async` vì server HTTP loopback phải nghe xong trước request đầu tiên — lý do
// đầy đủ nằm ở đầu `test-helpers/loopbackRequest.js`.
async function createSeasonApp(seasonStart) {
	var config = {
		rootDir: path.resolve(__dirname, ".."),
		staticDir: path.resolve(__dirname, ".."),
		runtimeDir: sharedTempDir,
		databasePath: path.join(sharedTempDir, "test.sqlite"),
		databaseUrl: "",
		pgDataDir: sharedPgDataDir,
		jwtSecret: "test-secret-key",
		adminPasswordHash: bcrypt.hashSync("admin123", 10),
		nodeEnv: "test",
		leaderboardSeason2Start: seasonStart == null ? "" : seasonStart
	};

	var runtime = createApp(config);

	await request.ready(runtime.app);

	return { config: config, runtime: runtime };
}

/** Client SQL dùng chung (đã được cache theo `pgDataDir`) để lùi ngày bản ghi. */
function sharedSql() {
	return createSqlClient({ databaseUrl: "", pgDataDir: sharedPgDataDir });
}

function submitScore(app, deviceId, nickname, score) {
	return request(app)
		.post("/api/scores")
		.send({
			deviceId: deviceId,
			nickname: nickname,
			level: "lop6",
			score: score,
			correctCount: 5,
			wrongCount: 1,
			timeoutCount: 0,
			durationMs: 300000
		})
		.expect(200);
}

// --- 1. Luật mùa là số học thuần, kiểm không cần server ------------------------

test("parseSeasonStart: rỗng = chưa mở mùa; ngày trần = 00:00 giờ Việt Nam", function () {
	assert.equal(season.parseSeasonStart(""), null);
	assert.equal(season.parseSeasonStart(null), null);
	assert.equal(season.parseSeasonStart("   "), null);

	// 00:00 ngày 15/08/2026 giờ Việt Nam = 17:00 ngày 14/08 giờ UTC.
	// Nếu ai đó "đơn giản hoá" thành `new Date("2026-08-15")` thì mốc nhảy sang
	// 07:00 sáng giờ Việt Nam — cắt bảng xếp hạng vào giữa tiết đầu tiên.
	assert.equal(season.parseSeasonStart("2026-08-15").toISOString(), "2026-08-14T17:00:00.000Z");

	// ISO đầy đủ thì tôn trọng nguyên văn.
	assert.equal(season.parseSeasonStart("2026-08-15T18:30:00+07:00").toISOString(), "2026-08-15T11:30:00.000Z");
});

test("parseSeasonStart: ngày gõ sai thì NÉM LỖI chứ không âm thầm bỏ qua", function () {
	assert.throws(function () {
		season.parseSeasonStart("15/08/2026");
	}, /LEADERBOARD_SEASON2_START/);

	assert.throws(function () {
		season.parseSeasonStart("hôm nào đó");
	}, /LEADERBOARD_SEASON2_START/);
});

test("validateConfig chặn ngày ranh giới hỏng ngay lúc khởi động", function () {
	var base = { jwtSecret: "x", adminPasswordHash: "y" };

	assert.doesNotThrow(function () {
		configModule.validateConfig(Object.assign({}, base, { leaderboardSeason2Start: "" }));
	});

	assert.doesNotThrow(function () {
		configModule.validateConfig(Object.assign({}, base, { leaderboardSeason2Start: "2026-08-15" }));
	});

	assert.throws(function () {
		configModule.validateConfig(Object.assign({}, base, { leaderboardSeason2Start: "không-phải-ngày" }));
	}, /LEADERBOARD_SEASON2_START/);
});

test("seasonRange nửa mở: không mùa nào đánh rơi, không mùa nào đếm hai lần", function () {
	var boundary = season.parseSeasonStart("2026-08-15");

	var one = season.seasonRange(season.SEASON_1, boundary);
	var two = season.seasonRange(season.SEASON_2, boundary);

	assert.equal(one.from, null);
	assert.equal(one.to.getTime(), boundary.getTime(), "Mùa 1 kết thúc ĐÚNG tại mốc (không bao gồm)");
	assert.equal(two.from.getTime(), boundary.getTime(), "Mùa 2 bắt đầu ĐÚNG tại mốc (bao gồm)");
	assert.equal(two.to, null);

	var all = season.seasonRange(season.SEASON_ALL, boundary);
	assert.equal(all.from, null);
	assert.equal(all.to, null);
});

test("chưa cấu hình mốc ⇒ chỉ có MỘT mùa và mọi lựa chọn quy về 'Tất cả'", function () {
	assert.equal(season.listSeasons(null).length, 1);
	assert.equal(season.currentSeasonId(null), season.SEASON_ALL);
	assert.equal(season.normalizeSeasonId("1", null), season.SEASON_ALL);
	assert.equal(season.normalizeSeasonId("2", null), season.SEASON_ALL);

	var range = season.seasonRange(season.SEASON_2, null);
	assert.equal(range.from, null, "chưa mở mùa thì không được lọc gì hết");
});

test("normalizeSeasonId: giá trị lạ rơi về mùa đang chạy, không báo lỗi", function () {
	var boundary = season.parseSeasonStart("2026-08-15");

	assert.equal(season.normalizeSeasonId(undefined, boundary), season.SEASON_2);
	assert.equal(season.normalizeSeasonId("", boundary), season.SEASON_2);
	assert.equal(season.normalizeSeasonId("banana", boundary), season.SEASON_2);
	assert.equal(season.normalizeSeasonId("1", boundary), season.SEASON_1);
	assert.equal(season.normalizeSeasonId("all", boundary), season.SEASON_ALL);
});

test("nhãn mùa hiển thị ngày theo giờ Việt Nam", function () {
	var seasons = season.listSeasons(season.parseSeasonStart("2026-08-15"));

	assert.equal(seasons[0].label, "Mùa 2");
	assert.ok(seasons[0].description.indexOf("15/08/2026") !== -1, seasons[0].description);
	assert.equal(seasons[1].label, "Mùa 1");
	assert.ok(seasons[1].description.indexOf("15/08/2026") !== -1, seasons[1].description);
});

// --- 2. Luồng HTTP thật -------------------------------------------------------

test("chưa cấu hình mốc: endpoint #3 giữ nguyên hợp đồng, chỉ có bảng 'Tất cả'", async function () {
	var context = await createSeasonApp(null);

	try {
		await submitScore(context.runtime.app, "season-dev-legacy", "Bạn Cũ", 1234);

		var response = await request(context.runtime.app)
			.get("/api/levels/lop6/leaderboard?deviceId=season-dev-legacy")
			.expect(200);

		// Hợp đồng §7.3.2 — 3 field cũ nguyên vẹn.
		assert.equal(response.body.level, "lop6");
		assert.ok(Array.isArray(response.body.entries));
		assert.ok(response.body.entries.length >= 1);
		assert.equal(typeof response.body.me, "object");

		// Field THÊM: chỉ một mùa ⇒ giao diện tự ẩn phần chọn mùa.
		assert.equal(response.body.season.id, "all");
		assert.equal(response.body.seasons.length, 1);
	} finally {
		await context.runtime.close();
	}
});

test("mở Mùa 2: điểm Mùa 1 KHÔNG mất, chỉ nằm ở tab khác", async function () {
	var setup = await createSeasonApp(null);
	var sql = sharedSql();

	try {
		// Hai bản ghi "thời Mùa 1": nộp bình thường rồi lùi ngày về quá khứ — đúng
		// hình dạng dữ liệu thật đang nằm trên production hôm nay.
		await submitScore(setup.runtime.app, "season-dev-old-1", "Mùa Một A", 4200);
		await submitScore(setup.runtime.app, "season-dev-old-2", "Mùa Một B", 3100);
		await sql.query(
			"UPDATE scores SET created_at = TIMESTAMPTZ '2026-01-01T00:00:00+07:00' WHERE device_id IN ($1,$2)",
			["season-dev-old-1", "season-dev-old-2"]
		);
	} finally {
		await setup.runtime.close();
	}

	// Ngày phát hành V2 được chốt: mốc nằm GIỮA dữ liệu cũ và dữ liệu mới.
	var context = await createSeasonApp("2026-06-01");

	try {
		await submitScore(context.runtime.app, "season-dev-new-1", "Mùa Hai A", 38000);

		var beforeCount = await sql.query("SELECT COUNT(*)::int AS n FROM scores WHERE level = $1", ["lop6"]);

		// (a) Mặc định = mùa đang chạy: chỉ thấy điểm thang mới.
		var current = await request(context.runtime.app)
			.get("/api/levels/lop6/leaderboard")
			.expect(200);

		var currentNames = current.body.entries.map(function (entry) { return entry.nickname; });

		assert.equal(current.body.season.id, "2");
		assert.equal(current.body.seasons.length, 3, "phải chào đủ Mùa 2 / Mùa 1 / Tất cả");
		assert.ok(currentNames.indexOf("Mùa Hai A") !== -1);
		assert.equal(currentNames.indexOf("Mùa Một A"), -1, "điểm thang cũ không được lẫn vào Mùa 2");

		// (b) Mùa 1 VẪN TRA ĐƯỢC — đây là điều kiện tiên quyết của cả task.
		var old = await request(context.runtime.app)
			.get("/api/levels/lop6/leaderboard?season=1")
			.expect(200);

		var oldNames = old.body.entries.map(function (entry) { return entry.nickname; });

		assert.equal(old.body.season.id, "1");
		assert.ok(oldNames.indexOf("Mùa Một A") !== -1, "mất điểm Mùa 1 là mất dữ liệu của học sinh");
		assert.ok(oldNames.indexOf("Mùa Một B") !== -1);
		assert.equal(oldNames.indexOf("Mùa Hai A"), -1);
		assert.equal(old.body.entries[0].nickname, "Mùa Một A", "Mùa 1 vẫn xếp hạng đúng trong thang của nó");

		// (c) Gộp cả hai vẫn xem được.
		var all = await request(context.runtime.app)
			.get("/api/levels/lop6/leaderboard?season=all")
			.expect(200);

		var allNames = all.body.entries.map(function (entry) { return entry.nickname; });

		assert.ok(allNames.indexOf("Mùa Một A") !== -1 && allNames.indexOf("Mùa Hai A") !== -1);

		// (d) Không một dòng nào bị xoá trong suốt quá trình.
		var afterCount = await sql.query("SELECT COUNT(*)::int AS n FROM scores WHERE level = $1", ["lop6"]);
		assert.equal(afterCount.rows[0].n, beforeCount.rows[0].n, "mở mùa mới KHÔNG được xoá dòng nào");
		assert.ok(afterCount.rows[0].n >= 3);
	} finally {
		await context.runtime.close();
	}
});

test("ngày ranh giới đến từ CẤU HÌNH: đổi ngày là đổi cách chia, không sửa mã", async function () {
	// Cùng một CSDL, cùng những bản ghi — chỉ khác một chuỗi cấu hình.
	var early = await createSeasonApp("2020-01-01");

	try {
		var everything = await request(early.runtime.app)
			.get("/api/levels/lop6/leaderboard?season=2")
			.expect(200);

		var late = await createSeasonApp("2099-01-01");

		try {
			var nothingYet = await request(late.runtime.app)
				.get("/api/levels/lop6/leaderboard?season=2")
				.expect(200);

			assert.ok(everything.body.entries.length > 0, "mốc năm 2020 ⇒ mọi điểm đều thuộc Mùa 2");
			assert.equal(nothingYet.body.entries.length, 0, "mốc năm 2099 ⇒ chưa ai có điểm Mùa 2");

			// …và cùng lúc đó Mùa 1 của cấu hình thứ hai giữ TOÀN BỘ dữ liệu.
			var allInSeasonOne = await request(late.runtime.app)
				.get("/api/levels/lop6/leaderboard?season=1")
				.expect(200);

			assert.equal(allInSeasonOne.body.entries.length, everything.body.entries.length);

			// Mô tả mùa mang đúng ngày của cấu hình → giao diện in ra được.
			assert.ok(nothingYet.body.season.description.indexOf("01/01/2099") !== -1);
			assert.ok(everything.body.season.description.indexOf("01/01/2020") !== -1);
		} finally {
			await late.runtime.close();
		}
	} finally {
		await early.runtime.close();
	}
});

test("tham số season gõ sai không làm trắng bảng — rơi về mùa đang chạy", async function () {
	var context = await createSeasonApp("2026-06-01");

	try {
		var response = await request(context.runtime.app)
			.get("/api/levels/lop6/leaderboard?season=mùa-nào-đó")
			.expect(200);

		assert.equal(response.body.season.id, "2");
	} finally {
		await context.runtime.close();
	}
});

// --- 3. Giao diện phải NÓI RÕ đang xem mùa nào --------------------------------

/**
 * DOM giả tối thiểu (không thêm phụ thuộc `jsdom` — quy tắc "0 phụ thuộc mới").
 * Đủ cho `LeaderboardScreen` khi danh sách RỖNG: nhánh vẽ từng hàng dùng
 * `innerHTML` + `querySelector`, đã kiểm bằng mắt trên trình duyệt.
 */
function installFakeDom() {
	var store = new Map();

	function createElement(tagName) {
		var element = {
			tagName: tagName,
			className: "",
			textContent: "",
			innerHTML: "",
			hidden: false,
			type: "",
			dataset: {},
			children: [],
			attributes: {},
			appendChild: function (child) {
				element.children.push(child);
				return child;
			},
			append: function () {
				for (var index = 0; index < arguments.length; index += 1) {
					element.children.push(arguments[index]);
				}
			},
			replaceChildren: function () {
				element.children = Array.prototype.slice.call(arguments);
			},
			setAttribute: function (name, value) {
				element.attributes[name] = value;
			},
			getAttribute: function (name) {
				return element.attributes[name];
			},
			addEventListener: function (type, handler) {
				if (type === "click") {
					element.onClick = handler;
				}
			},
			querySelector: function () {
				return null;
			},
			querySelectorAll: function () {
				return [];
			}
		};

		return element;
	}

	globalThis.window = {
		addEventListener: function () {},
		removeEventListener: function () {},
		localStorage: {
			getItem: function (key) { return store.has(key) ? store.get(key) : null; },
			setItem: function (key, value) { store.set(key, String(value)); },
			removeItem: function (key) { store.delete(key); }
		}
	};
	globalThis.localStorage = globalThis.window.localStorage;
	globalThis.document = {
		createElement: createElement,
		querySelector: function () { return null; },
		querySelectorAll: function () { return []; },
		addEventListener: function () {},
		body: createElement("body")
	};
}

function flattenTree(node, output) {
	output.push(node);

	var children = node.children || [];

	for (var index = 0; index < children.length; index += 1) {
		flattenTree(children[index], output);
	}

	return output;
}

test("màn Bảng xếp hạng nói rõ đang xem mùa nào và đổi mùa được", async function () {
	installFakeDom();

	var loadClientModule = require("../test-helpers/clientModule").loadClientModule;
	var MenuScreens = await loadClientModule("ui/screens/MenuScreens.ts");

	function makeSeason(id, label, description, current) {
		return { id: id, label: label, description: description, startAt: null, endAt: null, current: current };
	}

	var page = {
		entries: [],
		season: makeSeason("2", "Mùa 2", "Từ 15/08/2026 — thang điểm mới", true),
		seasons: [
			makeSeason("2", "Mùa 2", "Từ 15/08/2026 — thang điểm mới", true),
			makeSeason("1", "Mùa 1", "Trước 15/08/2026 — thang điểm cũ", false),
			makeSeason("all", "Tất cả", "Gộp cả hai mùa (thang điểm khác nhau)", false)
		]
	};

	var asked = [];
	var screen = new MenuScreens.LeaderboardScreen({
		onBack: function () {},
		loadPage: function (level, seasonId) {
			asked.push({ level: level, season: seasonId });
			return Promise.resolve(page);
		},
		getDeviceId: function () { return null; }
	});

	screen.onShow({ level: "lop6" });
	await new Promise(function (resolve) { setTimeout(resolve, 20); });

	var nodes = flattenTree(screen.element, []);
	var note = nodes.filter(function (node) { return node.className === "leaderboard__season-note"; })[0];
	var seasonBar = nodes.filter(function (node) {
		return String(node.className).indexOf("leaderboard__seasons") !== -1;
	})[0];

	assert.equal(note.hidden, false, "có 2 mùa mà không nói đang xem mùa nào là bảng nói dối");
	assert.ok(note.textContent.indexOf("Mùa 2") !== -1, note.textContent);
	assert.ok(note.textContent.indexOf("15/08/2026") !== -1, "phải in cả ngày ranh giới: " + note.textContent);

	assert.deepEqual(
		seasonBar.children.map(function (tab) { return tab.textContent; }),
		["Mùa 2", "Mùa 1", "Tất cả"]
	);
	assert.equal(seasonBar.children[0].dataset.selected, "true");
	assert.equal(seasonBar.children[1].dataset.selected, "false");

	// Bấm "Mùa 1" phải hỏi lại server ĐÚNG mùa đó.
	seasonBar.children[1].onClick();
	await new Promise(function (resolve) { setTimeout(resolve, 20); });

	assert.deepEqual(asked, [
		{ level: "lop6", season: undefined },
		{ level: "lop6", season: "1" }
	]);
});

test("chỉ một mùa thì màn hình KHÔNG bày ra khái niệm mùa", async function () {
	installFakeDom();

	var loadClientModule = require("../test-helpers/clientModule").loadClientModule;
	var MenuScreens = await loadClientModule("ui/screens/MenuScreens.ts");

	var screen = new MenuScreens.LeaderboardScreen({
		onBack: function () {},
		loadPage: function () {
			return Promise.resolve({
				entries: [],
				season: { id: "all", label: "Tất cả", description: "Toàn bộ điểm từ trước tới nay", startAt: null, endAt: null, current: true },
				seasons: [{ id: "all", label: "Tất cả", description: "Toàn bộ điểm từ trước tới nay", startAt: null, endAt: null, current: true }]
			});
		},
		getDeviceId: function () { return null; }
	});

	screen.onShow({ level: "lop6" });
	await new Promise(function (resolve) { setTimeout(resolve, 20); });

	var nodes = flattenTree(screen.element, []);
	var note = nodes.filter(function (node) { return node.className === "leaderboard__season-note"; })[0];
	var seasonBar = nodes.filter(function (node) {
		return String(node.className).indexOf("leaderboard__seasons") !== -1;
	})[0];

	assert.equal(note.hidden, true);
	assert.equal(seasonBar.hidden, true);
});

test("hạng trả về sau khi nộp điểm được tính TRONG mùa đang chạy", async function () {
	var context = await createSeasonApp("2026-06-01");

	try {
		// Ở Mùa 1 có bản ghi 4.200 điểm. Một ván Mùa 2 được 100 điểm mà bị đem so
		// với thang cũ thì màn Game Over sẽ báo hạng 2+ và học sinh không hiểu vì sao.
		var response = await submitScore(context.runtime.app, "season-dev-rank", "Hạng Mùa Hai", 100);

		assert.equal(response.body.score, 100);
		assert.ok(response.body.rank >= 1);
		assert.equal(response.body.best, 100, "kỷ lục cá nhân cũng tính trong mùa đang chạy");

		var board = await request(context.runtime.app)
			.get("/api/levels/lop6/leaderboard?deviceId=season-dev-rank")
			.expect(200);

		assert.equal(board.body.me.rank, response.body.rank, "hạng lúc nộp và hạng trên bảng phải khớp");
	} finally {
		await context.runtime.close();
	}
});
