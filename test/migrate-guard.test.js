"use strict";

// P2-5 (việc phụ 1) — RÀO CHẮN CHO `npm run migrate`.
//
// Lỗi được sửa ở đây có sẵn từ trước và đã được ghi lại ở mục P2-3: script đọc
// `.env` nên `npm run migrate` gõ ở máy dev chạy THẲNG vào Neon production, không
// hỏi lại, không có chế độ thử. Một agent trước đã lỡ làm thật.
//
// ⚠ Không test nào ở đây được phép mở kết nối tới CSDL nào. Các test chạy script
// thật đều truyền `DATABASE_URL` GIẢ và kiểm rằng script dừng TRƯỚC khi kết nối —
// nếu rào chắn hỏng, script sẽ cố nối tới host không tồn tại và test sẽ thấy một
// thông báo khác hẳn (đó cũng là một cách phát hiện).

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");
var { execFileSync } = require("child_process");
var migrateGuard = require("../server/migrateGuard");
var schemaModule = require("../server/schema");

var rootDir = path.resolve(__dirname, "..");
var SCRIPT = path.join(rootDir, "scripts", "migrate-neon.js");
var FAKE_NEON = "postgresql://user:pass@ep-khong-co-that-123456.ap-southeast-1.aws.neon.tech/toanrunner?sslmode=require";

/** Chạy script thật trong một tiến trình riêng, môi trường do ta kiểm soát hoàn toàn. */
function runScript(args, env) {
	try {
		var stdout = execFileSync(process.execPath, [SCRIPT].concat(args || []), {
			cwd: rootDir,
			encoding: "utf8",
			env: Object.assign({}, process.env, env || {}),
			stdio: ["ignore", "pipe", "pipe"]
		});

		return { code: 0, out: stdout };
	} catch (error) {
		return {
			code: error.status == null ? 1 : error.status,
			out: String(error.stdout || "") + String(error.stderr || "")
		};
	}
}

// --- Luật thuần ---------------------------------------------------------------

test("đích localhost / PGlite KHÔNG cần xác nhận", function () {
	["", "postgresql://user:pass@localhost:5432/db", "postgres://u@127.0.0.1/db", "postgres://u@[::1]:5432/db"]
		.forEach(function (url) {
			var plan = migrateGuard.resolveMigrationPlan({ argv: [], env: {}, databaseUrl: url });

			assert.equal(plan.allowed, true, url + " phải chạy được ngay");
			assert.equal(plan.requiresConfirmation, false);
			assert.equal(plan.willConnect, true);
		});
});

test("đích KHÔNG phải localhost thì bắt buộc cờ xác nhận (DoD 8)", function () {
	var plan = migrateGuard.resolveMigrationPlan({ argv: [], env: {}, databaseUrl: FAKE_NEON });

	assert.equal(plan.allowed, false);
	assert.equal(plan.willConnect, false, "bị chặn thì KHÔNG được mở kết nối nào");
	assert.equal(plan.requiresConfirmation, true);
	assert.ok(/--dry-run/.test(plan.message), "phải chỉ ngay cách xem trước an toàn");
	assert.ok(/--yes-production/.test(plan.message), "và cách chạy thật nếu thật sự muốn");
	assert.ok(/neon\.tech/.test(plan.message), "phải in host để người đọc biết mình sắp đụng vào đâu");
});

test("có cờ --yes-production (hoặc biến môi trường) thì chạy thật", function () {
	var byFlag = migrateGuard.resolveMigrationPlan({
		argv: ["--yes-production"],
		env: {},
		databaseUrl: FAKE_NEON
	});
	assert.equal(byFlag.allowed, true);
	assert.equal(byFlag.willConnect, true);

	var byEnv = migrateGuard.resolveMigrationPlan({
		argv: [],
		env: { MIGRATE_CONFIRM: "yes-production" },
		databaseUrl: FAKE_NEON
	});
	assert.equal(byEnv.allowed, true);

	// Giá trị gần đúng KHÔNG được tính là xác nhận.
	var almost = migrateGuard.resolveMigrationPlan({
		argv: [],
		env: { MIGRATE_CONFIRM: "yes" },
		databaseUrl: FAKE_NEON
	});
	assert.equal(almost.allowed, false);
});

test("--dry-run luôn được phép và KHÔNG BAO GIỜ kết nối", function () {
	[FAKE_NEON, "", "postgres://u@localhost/db"].forEach(function (url) {
		var plan = migrateGuard.resolveMigrationPlan({ argv: ["--dry-run"], env: {}, databaseUrl: url });

		assert.equal(plan.allowed, true);
		assert.equal(plan.dryRun, true);
		assert.equal(plan.willConnect, false);
	});
});

test("chuỗi kết nối đọc không nổi thì coi là TỪ XA, không phải 'chắc là máy mình'", function () {
	var plan = migrateGuard.resolveMigrationPlan({ argv: [], env: {}, databaseUrl: "cai-gi-day" });

	assert.equal(plan.target.local, false, "đoán sai theo hướng 'chắc là local' đúng là cách tai nạn xảy ra");
	assert.equal(plan.allowed, false);
});

test("host lạ mang chữ 'localhost' trong tên miền KHÔNG được coi là local", function () {
	// `localhost.evil.com` là một tên miền thật, trỏ đi đâu cũng được.
	var plan = migrateGuard.resolveMigrationPlan({
		argv: [],
		env: {},
		databaseUrl: "postgresql://u:p@localhost.evil.com/db"
	});

	assert.equal(plan.target.local, false);
	assert.equal(plan.allowed, false);
});

// --- Script thật ---------------------------------------------------------------

test("`npm run migrate` vào CSDL từ xa mà thiếu cờ → DỪNG, thoát khác 0, không chạm CSDL (DoD 8)", function () {
	var result = runScript([], { DATABASE_URL: FAKE_NEON });

	assert.notEqual(result.code, 0, "phải thoát với mã lỗi để CI/script gọi nó biết là đã dừng");
	assert.ok(/DỪNG LẠI/.test(result.out));
	assert.ok(/--yes-production/.test(result.out));
	assert.equal(/Đã áp schema/.test(result.out), false, "không được chạy một câu lệnh nào");
	assert.equal(
		/ENOTFOUND|getaddrinfo|fetch failed/i.test(result.out),
		false,
		"không được thử phân giải tên miền — tức là chưa hề mở kết nối"
	);
});

test("`npm run migrate -- --dry-run` in ra đúng danh sách câu lệnh và không kết nối (DoD 8)", function () {
	var result = runScript(["--dry-run"], { DATABASE_URL: FAKE_NEON });

	assert.equal(result.code, 0);
	assert.ok(/CHẠY THỬ/.test(result.out));
	assert.ok(new RegExp("Sẽ chạy " + schemaModule.STATEMENTS.length + " câu lệnh").test(result.out));

	// Vài câu tiêu biểu của MỌI phase phải có mặt — chế độ thử mà in thiếu thì nó
	// đang nói dối về việc sắp làm gì.
	["CREATE TABLE IF NOT EXISTS questions", "CREATE TABLE IF NOT EXISTS answer_events",
		"CREATE TABLE IF NOT EXISTS coin_ledger", "CREATE TABLE IF NOT EXISTS class_codes",
		"CREATE TABLE IF NOT EXISTS class_members"].forEach(function (statement) {
		assert.ok(result.out.includes(statement), "chế độ thử thiếu câu lệnh: " + statement);
	});

	assert.equal(/Đã áp schema/.test(result.out), false);
	assert.equal(/ENOTFOUND|getaddrinfo|fetch failed/i.test(result.out), false);
});

test("rào chắn chạy TRƯỚC khi tạo SQL client (thứ tự trong mã nguồn)", function () {
	var source = fs.readFileSync(SCRIPT, "utf8");
	var guardIndex = source.indexOf("resolveMigrationPlan(");
	var clientIndex = source.indexOf("createSqlClient(config)");

	assert.ok(guardIndex !== -1 && clientIndex !== -1);
	assert.ok(
		guardIndex < clientIndex,
		"kiểm rồi mới nối, chứ không phải nối rồi mới nghĩ lại — đây là toàn bộ điểm của rào chắn"
	);
});
