"use strict";

// P1-6 — DASHBOARD GIÁO VIÊN. Chạy trên PGlite THẬT (không mock SQL): dashboard là
// một loạt truy vấn tổng hợp, và mock query sẽ chỉ kiểm được rằng ta gọi đúng hàm
// chứ không kiểm được con số có đúng không — trong khi "con số có đúng không"
// chính là toàn bộ giá trị của tính năng này.
//
// DoD: chơi 5 ván test → dashboard hiện đúng số; CSV mở trong Excel không vỡ dấu;
// API admin auth cookie như route admin cũ; PGlite test đủ route mới.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");
var bcrypt = require("bcrypt");
var request = require("../test-helpers/loopbackRequest");
var createApp = require("../server/app").createApp;
var pgTempDir = require("../test-helpers/pgTempDir");
var statsStoreModule = require("../server/statsStore");

var rootDir = path.resolve(__dirname, "..");
var createSqlClient = require("../server/sql").createSqlClient;
var applySchema = require("../server/schema").applySchema;

// MỘT PGlite duy nhất cho cả file.
//
// Không dựng CSDL mới cho từng test: PGlite là Postgres biên dịch sang WASM, và
// mở nhiều instance song song trong cùng tiến trình cho ra `ErrnoError 51` ngay
// (server/sql.js đã ghi chú đúng cái bẫy này). Thay vào đó dùng chung một CSDL và
// DỌN BẢNG trước mỗi test — vẫn độc lập, mà không đụng vào chỗ WASM dễ vỡ.
var sharedRuntimeDir = pgTempDir.createTempDir("dashboard-");
var sharedConfig = {
	rootDir: rootDir,
	staticDir: rootDir,
	runtimeDir: sharedRuntimeDir,
	pgDataDir: path.join(sharedRuntimeDir, "pgdata"),
	jwtSecret: "test-secret-key-p1-6",
	adminPasswordHash: bcrypt.hashSync("admin123", 10),
	nodeEnv: "test"
};

var sharedRuntime = createApp(sharedConfig);

// Server HTTP loopback của app dùng chung phải NGHE XONG trước request đầu tiên —
// `test-helpers/loopbackRequest.js` giải thích vì sao phải bind vào đúng 127.0.0.1.
test.before(async function () {
	await request.ready(sharedRuntime.app);
});
var sharedSql = createSqlClient(sharedConfig);

/** Dọn sạch dữ liệu thống kê; schema giữ nguyên. */
async function resetDatabase() {
	// PHẢI tự áp schema, không được chỉ `SELECT 1` rồi tin là xong: `applySchema`
	// của createApp chạy trên một chuỗi promise KHÁC, nên `DELETE` có thể tới trước
	// `CREATE TABLE`. Lúc đó PGlite ném "relation does not exist", và dưới
	// `node --test` nó nổi lên thành `ErrnoError 51` chẳng liên quan gì — mất cả
	// buổi mới lần ra. applySchema là idempotent nên gọi lại vô hại.
	await applySchema(sharedSql);
	await sharedSql.query("DELETE FROM answer_events", []);
	await sharedSql.query("DELETE FROM skill_profiles", []);
}

/** Cùng một app cho mọi test — `close()` là no-op với PGlite (server/sql.js). */
async function makeRuntime() {
	await resetDatabase();
	return sharedRuntime;
}

// Đăng nhập MỘT lần cho cả file: rate-limit đăng nhập admin là 5 lần/phút TÍNH
// THEO IP (đúng như vậy — chống dò mật khẩu thì phải theo IP), nên mỗi test tự
// đăng nhập lại sẽ tự đâm vào giới hạn của chính mình.
var adminAgentPromise = null;

function loginAdmin(runtime) {
	if (adminAgentPromise === null) {
		adminAgentPromise = (async function () {
			var agent = request.agent(runtime.app);
			await agent.post("/api/admin/login").send({ password: "admin123" }).expect(200);
			return agent;
		})();
	}

	return adminAgentPromise;
}

/** Một ván: `pattern` là chuỗi "c" (đúng) / "w" (sai) cho từng câu. */
function runPayload(deviceId, pattern, options) {
	var settings = options || {};

	return {
		deviceId: deviceId,
		level: settings.level || "lop6",
		runId: settings.runId || deviceId + "-run",
		answers: pattern.split("").map(function (mark, index) {
			return {
				questionId: settings.questionIds ? settings.questionIds[index] : "q" + (index + 1),
				outcome: mark === "c" ? "correct" : "wrong",
				answerMs: 5000,
				mode: index % 2 === 0 ? "gate" : "modal",
				difficulty: settings.difficulty || "medium"
			};
		})
	};
}

test("5 ván test → dashboard hiện ĐÚNG số (DoD P1-6)", async function () {
	var runtime = await makeRuntime();
	var testTag = "a";

	try {
		// 5 ván, mỗi ván 4 câu: tổng 20 câu, 4+3+2+1+2 = 12 câu đúng.
		var runs = ["cccc", "ccwc", "cwwc", "cwww", "ccww"];

		for (var index = 0; index < runs.length; index += 1) {
			await request(runtime.app)
				.post("/api/runs/summary")
				.send(runPayload("device-" + testTag + "-" + index, runs[index]))
				.expect(200);
		}

		var agent = await loginAdmin(runtime);
		var stats = (await agent.get("/api/admin/stats?level=lop6").expect(200)).body;

		assert.equal(stats.totals.answers, 20, "5 ván × 4 câu");
		assert.equal(stats.totals.correct, 12);
		assert.equal(stats.totals.devices, 5, "5 máy khác nhau");

		assert.equal(stats.runsByDay.length, 1, "cả 5 ván trong cùng một ngày");
		assert.equal(stats.runsByDay[0].runs, 5);
		assert.equal(stats.runsByDay[0].answers, 20);

		var lop6 = stats.accuracyByLevel.find(function (row) {
			return row.key === "lop6";
		});
		assert.equal(lop6.total, 20);
		assert.equal(lop6.correct, 12);
		assert.ok(Math.abs(lop6.accuracy - 12 / 20) < 1e-9);
	} finally {
		// Không close: app dùng chung cả file.
	}
});

test("top 10 câu sai nhiều nhất xếp đúng thứ tự", async function () {
	var runtime = await makeRuntime();
	var testTag = "b";

	try {
		// q1 sai 4/4 lượt, q2 sai 2/4, q3 đúng hết. q4 chỉ 2 lượt → chưa đủ ngưỡng.
		for (var index = 0; index < 4; index += 1) {
			await request(runtime.app).post("/api/runs/summary").send({
				deviceId: "device-" + testTag + "-" + index,
				level: "lop6",
				runId: "run-" + index,
				answers: [
					{ questionId: "q1", outcome: "wrong", answerMs: 4000, mode: "gate", difficulty: "hard" },
					{ questionId: "q2", outcome: index < 2 ? "wrong" : "correct", answerMs: 4000, mode: "gate", difficulty: "medium" },
					{ questionId: "q3", outcome: "correct", answerMs: 4000, mode: "gate", difficulty: "easy" }
				]
			}).expect(200);
		}

		await request(runtime.app).post("/api/runs/summary").send({
			deviceId: "device-x",
			level: "lop6",
			runId: "run-x",
			answers: [{ questionId: "q4", outcome: "wrong", answerMs: 4000, mode: "gate", difficulty: "hard" }]
		}).expect(200);

		var agent = await loginAdmin(runtime);
		var stats = (await agent.get("/api/admin/stats").expect(200)).body;
		var ids = stats.topWrongQuestions.map(function (row) {
			return row.questionId;
		});

		assert.equal(ids[0], "q1", "câu sai 100% phải đứng đầu");
		assert.ok(ids.indexOf("q2") !== -1);
		assert.equal(
			ids.indexOf("q4"),
			-1,
			"câu mới gặp 1 lượt không được leo lên đầu bảng — 1 em làm sai không phải là 'lớp chưa hiểu'"
		);

		var q1 = stats.topWrongQuestions[0];
		assert.equal(q1.total, 4);
		assert.equal(q1.wrong, 4);
		assert.equal(q1.wrongRate, 1);
	} finally {
		// Không close: app dùng chung cả file.
	}
});

test("timeout tính là SAI trong thống kê (em không làm được thì vẫn là không làm được)", async function () {
	var runtime = await makeRuntime();
	var testTag = "c";

	try {
		for (var index = 0; index < 3; index += 1) {
			await request(runtime.app).post("/api/runs/summary").send({
				deviceId: "device-" + testTag + "-" + index,
				level: "lop6",
				runId: "run-" + index,
				answers: [{ questionId: "q-timeout", outcome: "timeout", answerMs: 10000, mode: "gate", difficulty: "hard" }]
			}).expect(200);
		}

		var agent = await loginAdmin(runtime);
		var stats = (await agent.get("/api/admin/stats").expect(200)).body;

		assert.equal(stats.totals.correct, 0);
		assert.equal(stats.topWrongQuestions[0].questionId, "q-timeout");
		assert.equal(stats.topWrongQuestions[0].wrong, 3);
	} finally {
		// Không close: app dùng chung cả file.
	}
});

test("lọc theo lớp và theo khoảng ngày", async function () {
	var runtime = await makeRuntime();

	try {
		await request(runtime.app).post("/api/runs/summary").send(runPayload("d1", "cc", { level: "lop6" })).expect(200);
		await request(runtime.app).post("/api/runs/summary").send(runPayload("d2", "cw", { level: "lop7" })).expect(200);

		var agent = await loginAdmin(runtime);

		var lop6 = (await agent.get("/api/admin/stats?level=lop6").expect(200)).body;
		assert.equal(lop6.totals.answers, 2);
		assert.equal(lop6.accuracyByLevel.length, 1);

		var all = (await agent.get("/api/admin/stats").expect(200)).body;
		assert.equal(all.totals.answers, 4);
		assert.equal(all.accuracyByLevel.length, 2);

		// Khoảng ngày trong tương lai → không có gì.
		var future = (await agent.get("/api/admin/stats?from=2099-01-01").expect(200)).body;
		assert.equal(future.totals.answers, 0);

		// "Đến ngày hôm nay" phải BAO GỒM hôm nay (giáo viên hiểu như vậy).
		var today = new Date();
		var todayKey =
			today.getFullYear() + "-" +
			String(today.getMonth() + 1).padStart(2, "0") + "-" +
			String(today.getDate()).padStart(2, "0");
		var untilToday = (await agent.get("/api/admin/stats?to=" + todayKey).expect(200)).body;
		assert.equal(untilToday.totals.answers, 4, "'đến hôm nay' mà loại mất hôm nay là bẫy off-by-one kinh điển");
	} finally {
		// Không close: app dùng chung cả file.
	}
});

test("lớp không hợp lệ → 400, không phải 500", async function () {
	var runtime = await makeRuntime();

	try {
		var agent = await loginAdmin(runtime);
		await agent.get("/api/admin/stats?level=lop99").expect(400);
		await request(runtime.app)
			.post("/api/runs/summary")
			.send({ deviceId: "d", level: "lop99", answers: [] })
			.expect(400);
	} finally {
		// Không close: app dùng chung cả file.
	}
});

test("câu lỗi định dạng bị BỎ QUA chứ không làm hỏng cả ván", async function () {
	var runtime = await makeRuntime();

	try {
		var response = await request(runtime.app).post("/api/runs/summary").send({
			deviceId: "device-mixed",
			level: "lop6",
			runId: "run-mixed",
			answers: [
				{ questionId: "ok1", outcome: "correct", answerMs: 3000, mode: "gate", difficulty: "easy" },
				{ questionId: "", outcome: "correct" },
				{ questionId: "bad-outcome", outcome: "banana" },
				null,
				{ questionId: "ok2", outcome: "wrong", answerMs: -5, mode: "khong-co", difficulty: "khong-co" }
			]
		}).expect(200);

		assert.equal(response.body.recorded, 2, "2 dòng hợp lệ được ghi, 3 dòng hỏng bị bỏ");
	} finally {
		// Không close: app dùng chung cả file.
	}
});

test("route admin CẦN cookie đăng nhập như mọi route admin khác", async function () {
	var runtime = await makeRuntime();

	try {
		await request(runtime.app).get("/api/admin/stats").expect(401);
		await request(runtime.app).get("/api/admin/stats.csv").expect(401);

		// Còn route của học sinh thì công khai (không có admin trong phòng máy).
		await request(runtime.app).post("/api/runs/summary").send(runPayload("d9", "c")).expect(200);
	} finally {
		// Không close: app dùng chung cả file.
	}
});

// --- CSV ---------------------------------------------------------------------

test("CSV mở trong Excel KHÔNG vỡ dấu tiếng Việt (DoD P1-6)", async function () {
	var runtime = await makeRuntime();

	try {
		await request(runtime.app).post("/api/runs/summary").send(runPayload("d1", "cw")).expect(200);

		var agent = await loginAdmin(runtime);
		var response = await agent.get("/api/admin/stats.csv").expect(200);

		// BOM UTF-8 là ĐIỀU KIỆN SỐNG CÒN: thiếu nó thì Excel bản Windows đọc file
		// như CP-1252 và "Độ chính xác" thành "Ä�á»™ chÃ­nh xÃ¡c".
		assert.equal(response.text.charCodeAt(0), 0xfeff, "thiếu BOM là dấu tiếng Việt vỡ trong Excel");
		assert.ok(/charset=utf-8/i.test(response.headers["content-type"]));
		assert.ok(/attachment; filename=/.test(response.headers["content-disposition"]));

		// P2-5 — CÁI BẪY TIẾNG VIỆT THỨ HAI, ngang tầm BOM và thiếu từ P1-6 tới giờ:
		// Windows tiếng Việt đặt "List separator" là `;`, nên nháy đúp một file phân
		// cách bằng `,` sẽ dồn HẾT MỌI CỘT VÀO MỘT CỘT. Dòng chỉ thị `sep=,` phải
		// nằm ngay sau BOM — Excel chỉ đọc nó ở dòng đầu tiên.
		assert.equal(
			response.text.slice(1, 1 + statsStoreModule.SEP_DIRECTIVE.length),
			statsStoreModule.SEP_DIRECTIVE,
			"thiếu 'sep=,' là giáo viên mở file ra thấy mọi thứ dồn vào một cột"
		);
		assert.equal(response.text.slice(0, 1 + statsStoreModule.SEP_DIRECTIVE.length + 2).endsWith("\r\n"), true);

		// Chữ có dấu phải còn nguyên vẹn.
		assert.ok(response.text.includes("Độ chính xác theo lớp"));
		assert.ok(response.text.includes("Top câu sai nhiều nhất"));

		// CRLF: Excel bản Windows xuống dòng theo chuẩn này.
		assert.ok(response.text.indexOf("\r\n") !== -1);
	} finally {
		// Không close: app dùng chung cả file.
	}
});

test("CSV thoát dấu phẩy/nháy kép để không lệch cột", function () {
	var csv = statsStoreModule.statsToCsv({
		totals: { answers: 1, correct: 1, devices: 1 },
		runsByDay: [],
		accuracyByLevel: [],
		accuracyByDifficulty: [],
		topWrongQuestions: [
			{ questionId: 'q,có phẩy', level: "lop6", total: 3, wrong: 3, wrongRate: 1 },
			{ questionId: 'q"có nháy', level: "lop6", total: 3, wrong: 1, wrongRate: 1 / 3 }
		]
	});

	assert.ok(csv.includes('"q,có phẩy"'), "ô chứa dấu phẩy phải được bọc nháy kép");
	assert.ok(csv.includes('"q""có nháy"'), "nháy kép trong ô phải được nhân đôi");
	assert.equal(csv.charCodeAt(0), 0xfeff);
	// P2-5: chỉ thị dấu phân cách đứng ngay sau BOM, trước mọi dữ liệu.
	assert.equal(csv.startsWith("﻿" + statsStoreModule.SEP_DIRECTIVE + "\r\n"), true);
});

// --- Hợp đồng: một request cho cả ván ---------------------------------------

test("client gửi ĐÚNG MỘT request cho cả ván, không phải một request mỗi câu", function () {
	var bridge = fs.readFileSync(
		path.join(rootDir, "client", "src", "integration", "questionBridge.ts"),
		"utf8"
	);

	assert.ok(/submitRunSummary/.test(bridge));
	// Payload phải là MẢNG answers — chữ ký hàm nói lên điều đó.
	assert.ok(
		/answers: readonly RunAnswerEvent\[\]/.test(bridge),
		"phải nhận cả mảng đáp án; gửi từng câu là 300 request đồng thời ở phòng máy"
	);
});

test("bảng answer_events có đủ cột và 3 index theo task", function () {
	var schema = fs.readFileSync(path.join(rootDir, "server", "schema.js"), "utf8");

	["device_id", "level", "question_id", "outcome", "answer_ms", "mode", "difficulty", "run_id", "created_at"].forEach(
		function (column) {
			assert.ok(schema.includes(column), "answer_events thiếu cột " + column);
		}
	);

	assert.ok(/idx_answer_events_level/.test(schema));
	assert.ok(/idx_answer_events_question/.test(schema));
	assert.ok(/idx_answer_events_created/.test(schema));
});

test("dashboard KHÔNG dùng thư viện chart nào (task P1-6)", function () {
	// P2-7: trang quản trị đã vào Vite, nguồn nay là client/admin.html + client/src/admin/*.
	var admin = require("../test-helpers/adminSource").readAdminSource();

	assert.ok(/chart-bar/.test(admin), "phải có biểu đồ thanh thuần CSS");
	assert.equal(/chart\.js|d3\.|echarts|highcharts/i.test(admin), false, "không được nhúng thư viện chart");
	assert.ok(/stats\.csv/.test(admin), "phải có nút xuất CSV");
});

test("giới hạn số câu mỗi ván — payload khổng lồ không làm nghẽn CSDL", async function () {
	var runtime = await makeRuntime();

	try {
		var answers = [];

		for (var index = 0; index < statsStoreModule.MAX_ANSWERS_PER_RUN + 40; index += 1) {
			answers.push({
				questionId: "q" + index,
				outcome: "correct",
				answerMs: 1000,
				mode: "gate",
				difficulty: "easy"
			});
		}

		var response = await request(runtime.app)
			.post("/api/runs/summary")
			.send({ deviceId: "device-flood", level: "lop6", runId: "flood", answers: answers })
			.expect(200);

		assert.equal(response.body.recorded, statsStoreModule.MAX_ANSWERS_PER_RUN);
	} finally {
		// Không close: app dùng chung cả file.
	}
});
