"use strict";

// P2-7 — NHIỀU TÀI KHOẢN QUẢN TRỊ + TRANG ADMIN CHUYỂN VÀO VITE.
//
// Chạy trên PGlite THẬT (không mock SQL): giá trị của task này nằm ở câu hỏi "mật
// khẩu cũ của giáo viên có còn vào được không", mà mock query chỉ kiểm được rằng
// ta có gọi hàm.
//
// ⚠ CẤU HÌNH TRUYỀN TAY, `databaseUrl` RỖNG TƯỜNG MINH. File `.env` của dự án trỏ
// vào Neon production; không test nào ở đây được phép chạm tới nó.
//
// DoD (tasks-version2.md P2-7): mật khẩu cũ vẫn đăng nhập được sau di trú · tạo/xoá
// tài khoản · tài khoản này không thao tác được thay tài khoản khác · MỌI route
// admin cũ vẫn hoạt động · trang admin giữ đủ chức năng và ra khỏi precache SW.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var bcrypt = require("bcrypt");
var request = require("supertest");
var createApp = require("../server/app").createApp;
var adminUser = require("../server/adminUser");
var adminUserStoreModule = require("../server/adminUserStore");
var createSqlClient = require("../server/sql").createSqlClient;
var applySchema = require("../server/schema").applySchema;
var adminSource = require("../test-helpers/adminSource");

var rootDir = path.resolve(__dirname, "..");

// MỘT PGlite duy nhất cho cả file — mỗi test một `mkdtempSync` từng làm đầy ổ đĩa
// thật 25 GB (ghi ở P1-6). Dọn bảng trước mỗi test thay vì dựng CSDL mới.
var sharedRuntimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "admin-users-"));

/** Mật khẩu admin ĐANG CHẠY TRÊN PRODUCTION, mô phỏng bằng biến môi trường. */
var LEGACY_PASSWORD = "matkhau-cu-cua-co-ha";

var sharedConfig = {
	rootDir: rootDir,
	staticDir: rootDir,
	runtimeDir: sharedRuntimeDir,
	pgDataDir: path.join(sharedRuntimeDir, "pgdata"),
	// TƯỜNG MINH rỗng: không đọc DATABASE_URL của .env trong bất kỳ hoàn cảnh nào.
	databaseUrl: "",
	jwtSecret: "test-secret-key-p2-7",
	adminPasswordHash: bcrypt.hashSync(LEGACY_PASSWORD, 10),
	// Limiter đăng nhập đếm theo IP (đúng — chống dò mật khẩu), mà file này phải
	// đăng nhập bằng nhiều tài khoản thật để kiểm cách ly quyền. Nới CHỈ ở đây;
	// mặc định production vẫn là 5 và không biến môi trường nào đổi được (có test
	// canh ngay bên dưới).
	loginRateLimitMax: 200,
	nodeEnv: "test"
};

var sharedRuntime = createApp(sharedConfig);
var sharedSql = createSqlClient(sharedConfig);

/**
 * Dọn bảng tài khoản.
 *
 * Mặc định GIEO LẠI tài khoản `admin` từ hash cũ — vì `server/app.js` chỉ gieo MỘT
 * LẦN cho mỗi tiến trình (đúng, production khởi động một lần), nên nếu ở đây chỉ
 * DELETE thì mọi test sau sẽ chạy trên một hệ thống không còn tài khoản nào.
 * Truyền `{ seedLegacy: false }` khi muốn kiểm chính cái khoảnh khắc bảng còn rỗng.
 */
async function resetAdminUsers(options) {
	var settings = options || {};

	// applySchema idempotent, và phải tự gọi ở đây vì chuỗi promise của createApp là
	// một chuỗi KHÁC (bẫy đã ghi ở test/dashboard.test.js).
	await applySchema(sharedSql);
	await sharedSql.query("DELETE FROM admin_users", []);

	if (settings.seedLegacy !== false) {
		await adminUserStoreModule
			.createAdminUserStore({ sql: sharedSql })
			.seedLegacyAccount(sharedConfig.adminPasswordHash);
	}
}

// Phiên đăng nhập được MEMO HOÁ theo (tên, mật khẩu): dù đã nới limiter cho file
// này, đăng nhập lại ở mỗi test vẫn là bcrypt.compare thừa và là thói quen sẽ đâm
// vào 429 ở file sau. Một phiên cho mỗi tài khoản, dùng lại.
var sessionCache = new Map();

/** Đăng nhập THẬT, không memo — dùng khi chính lời gọi đăng nhập là điều đang kiểm. */
async function freshLogin(username, password) {
	var agent = request.agent(sharedRuntime.app);
	var response = await agent.post("/api/admin/login").send({ username: username, password: password });

	if (response.status !== 200) {
		throw new Error("đăng nhập thất bại (" + response.status + "): " + JSON.stringify(response.body));
	}

	return agent;
}

function loginAs(username, password) {
	var key = username + " " + password;

	if (sessionCache.has(key) === false) {
		sessionCache.set(key, freshLogin(username, password));
	}

	return sessionCache.get(key);
}

// --- 1. ĐƯỜNG DI TRÚ: MẬT KHẨU CŨ KHÔNG BAO GIỜ BỊ KHOÁ CỬA ------------------

test("mật khẩu cũ trong ADMIN_PASSWORD_HASH vẫn đăng nhập được sau khi có admin_users (DoD 1)", async function () {
	await resetAdminUsers({ seedLegacy: false });

	// Bảng RỖNG — đúng trạng thái ngay sau khi migrate lần đầu.
	var before = await sharedSql.query("SELECT COUNT(*)::int AS total FROM admin_users", []);
	assert.equal(Number(before.rows[0].total), 0);

	// Trang admin V1 (và mọi script cũ) chỉ gửi `{ password }`, KHÔNG có username.
	var response = await request(sharedRuntime.app)
		.post("/api/admin/login")
		.send({ password: LEGACY_PASSWORD })
		.expect(200);

	assert.equal(response.body.authenticated, true, "shape `{authenticated:true}` của V1 phải giữ nguyên");
	assert.equal(response.body.username, adminUser.LEGACY_USERNAME);
	assert.equal(response.body.role, "owner");

	// Và hạt giống di trú đã được gieo: tài khoản `admin` với ĐÚNG hash cũ.
	var after = await sharedSql.query("SELECT username, password_hash, role FROM admin_users", []);
	assert.equal(after.rows.length, 1);
	assert.equal(after.rows[0].username, "admin");
	assert.equal(after.rows[0].password_hash, sharedConfig.adminPasswordHash, "phải mang NGUYÊN hash cũ, không băm lại");
	assert.equal(after.rows[0].role, "owner");
});

test("gieo hạt giống di trú là IDEMPOTENT và KHÔNG ghi đè mật khẩu đã đổi", async function () {
	await resetAdminUsers({ seedLegacy: false });

	var store = adminUserStoreModule.createAdminUserStore({ sql: sharedSql });

	var first = await store.seedLegacyAccount(sharedConfig.adminPasswordHash);
	assert.equal(first.seeded, true);

	// Giả lập "giáo viên đã tự đổi mật khẩu trong trang quản trị".
	var newHash = bcrypt.hashSync("mat-khau-moi-cua-co", 10);
	await sharedSql.query("UPDATE admin_users SET password_hash = $1 WHERE username = 'admin'", [newHash]);

	// Lần khởi động sau: gieo lại KHÔNG được chèn thêm và KHÔNG được ghi đè ngược.
	var second = await store.seedLegacyAccount(sharedConfig.adminPasswordHash);
	assert.equal(second.seeded, false, "không được chèn thêm hàng thứ hai");

	var rows = await sharedSql.query("SELECT COUNT(*)::int AS total FROM admin_users", []);
	assert.equal(Number(rows.rows[0].total), 1);

	var stored = await sharedSql.query("SELECT password_hash FROM admin_users WHERE username = 'admin'", []);
	assert.equal(
		stored.rows[0].password_hash,
		newHash,
		"mật khẩu giáo viên vừa đổi KHÔNG được bị hash trong biến môi trường ghi đè"
	);

	// Và mật khẩu mới đăng nhập được thật.
	await freshLogin("admin", "mat-khau-moi-cua-co");
});

test("mật khẩu môi trường vẫn là chìa dự phòng cho `admin` kể cả khi hash trong bảng đã khác", async function () {
	await resetAdminUsers({ seedLegacy: false });
	await sharedSql.query(
		"INSERT INTO admin_users (username, password_hash, display_name, role) VALUES ('admin',$1,'Quản trị viên','owner')",
		[bcrypt.hashSync("mot-mat-khau-hoan-toan-khac", 10)]
	);

	// Đây là kịch bản "chủ dự án đổi ADMIN_PASSWORD_HASH trên Vercel": nếu bỏ chìa
	// thứ hai thì đổi biến môi trường xong là… không ai vào được nữa.
	await request(sharedRuntime.app).post("/api/admin/login").send({ password: LEGACY_PASSWORD }).expect(200);
});

test("mật khẩu môi trường KHÔNG mở được tài khoản khác `admin`", async function () {
	await resetAdminUsers({ seedLegacy: false });
	await sharedSql.query(
		"INSERT INTO admin_users (username, password_hash, display_name, role) VALUES ('co.ha',$1,'Cô Hà','teacher')",
		[bcrypt.hashSync("matkhau-cua-co-ha", 10)]
	);

	await request(sharedRuntime.app)
		.post("/api/admin/login")
		.send({ username: "co.ha", password: LEGACY_PASSWORD })
		.expect(401);
});

test("sai tên và sai mật khẩu trả về CÙNG một câu — không xác nhận tài khoản nào có thật", async function () {
	await resetAdminUsers();

	var noSuchUser = await request(sharedRuntime.app)
		.post("/api/admin/login")
		.send({ username: "khong.co.ai", password: "sai-be-bet-that" })
		.expect(401);
	var wrongPassword = await request(sharedRuntime.app)
		.post("/api/admin/login")
		.send({ username: "admin", password: "sai-be-bet-that" })
		.expect(401);

	assert.equal(noSuchUser.body.error, wrongPassword.body.error);
});

// --- 2. TẠO / XOÁ TÀI KHOẢN --------------------------------------------------

test("tạo rồi xoá tài khoản quản trị (DoD 2)", async function () {
	await resetAdminUsers();

	var owner = await loginAs("admin", LEGACY_PASSWORD);

	var created = await owner
		.post("/api/admin/users")
		.send({ username: "Co.Ha", displayName: "  Cô   Hà  ", password: "matkhau-8ky", role: "teacher" })
		.expect(200);

	// Chuẩn hoá: hạ chữ thường + gộp khoảng trắng thừa của tên hiển thị.
	assert.equal(created.body.user.username, "co.ha");
	assert.equal(created.body.user.displayName, "Cô Hà");
	assert.equal(created.body.user.role, "teacher");

	var listed = await owner.get("/api/admin/users").expect(200);
	assert.deepEqual(
		listed.body.users.map(function (user) {
			return user.username;
		}),
		["admin", "co.ha"],
		"owner đứng trước, rồi tới tên theo alphabet"
	);
	assert.equal(
		Object.prototype.hasOwnProperty.call(listed.body.users[0], "passwordHash"),
		false,
		"KHÔNG BAO GIỜ trả hash mật khẩu ra client"
	);

	// Tài khoản mới đăng nhập được ngay bằng mật khẩu vừa đặt.
	await freshLogin("co.ha", "matkhau-8ky");

	await owner.delete("/api/admin/users/co.ha").expect(200);

	var afterDelete = await owner.get("/api/admin/users").expect(200);
	assert.equal(afterDelete.body.users.length, 1);
});

test("trùng tên đăng nhập bị từ chối, và tên/mật khẩu không hợp lệ cũng vậy", async function () {
	await resetAdminUsers();

	var owner = await loginAs("admin", LEGACY_PASSWORD);

	await owner.post("/api/admin/users").send({ username: "co.ha", password: "matkhau-8ky" }).expect(200);

	var duplicate = await owner.post("/api/admin/users").send({ username: "co.ha", password: "matkhau-8ky" });
	assert.equal(duplicate.status, 400);
	assert.match(duplicate.body.error, /đã có người dùng rồi/);

	// Mật khẩu ngắn — độ dài là thứ DUY NHẤT thực sự đắt cho người dò.
	var weak = await owner.post("/api/admin/users").send({ username: "thay.nam", password: "1234567" });
	assert.equal(weak.status, 400);
	assert.match(weak.body.error, /ít nhất 8 ký tự/);

	// Tên có dấu / có khoảng trắng: từ chối thay vì "đoán ý" bỏ dấu — tên đăng nhập
	// CHÍNH LÀ `class_codes.owner_id`, đoán sai một lần là lớp thuộc về người khác.
	var badName = await owner.post("/api/admin/users").send({ username: "cô hà", password: "matkhau-8ky" });
	assert.equal(badName.status, 400);
});

test("không tự xoá được mình, và không xoá được tài khoản quản trị chính CUỐI CÙNG", async function () {
	await resetAdminUsers();

	var owner = await loginAs("admin", LEGACY_PASSWORD);

	var selfDelete = await owner.delete("/api/admin/users/admin");
	assert.equal(selfDelete.status, 403);
	assert.match(selfDelete.body.error, /chính tài khoản đang đăng nhập/i);

	// Còn đúng một owner ⇒ ngay cả khi có tài khoản owner thứ hai bị xoá trước thì
	// người cuối cùng vẫn không xoá được (thử qua đường "owner khác xoá owner này").
	await owner.post("/api/admin/users").send({ username: "thay.nam", password: "matkhau-8ky", role: "owner" }).expect(200);

	// `freshLogin` chứ không `loginAs`: tài khoản này ở test NÀY là `owner`, memo hoá
	// nó sẽ làm test sau (nơi `thay.nam` là giáo viên) chạy bằng một token sai vai.
	var second = await freshLogin("thay.nam", "matkhau-8ky");
	await second.delete("/api/admin/users/admin").expect(200);

	var lastOwner = await second.delete("/api/admin/users/thay.nam");
	assert.equal(lastOwner.status, 403, "tự xoá mình vẫn bị chặn trước");

	var stillThere = await sharedSql.query("SELECT COUNT(*)::int AS total FROM admin_users WHERE role='owner'", []);
	assert.equal(Number(stillThere.rows[0].total), 1);
});

test("xoá tài khoản KHÔNG xoá lớp học của tài khoản đó", async function () {
	await resetAdminUsers();
	await sharedSql.query("DELETE FROM class_codes", []);

	var owner = await loginAs("admin", LEGACY_PASSWORD);
	await owner.post("/api/admin/users").send({ username: "co.ha", password: "matkhau-8ky" }).expect(200);

	var teacher = await loginAs("co.ha", "matkhau-8ky");
	await teacher.post("/api/admin/classes").send({ label: "Lớp 6A — cô Hà", expiresInDays: 30 }).expect(200);

	await owner.delete("/api/admin/users/co.ha").expect(200);

	// Lớp vẫn còn, vẫn mang `owner_id = 'co.ha'`: tạo lại đúng tên là nhận lại lớp.
	var classes = await sharedSql.query("SELECT owner_id, label FROM class_codes", []);
	assert.equal(classes.rows.length, 1);
	assert.equal(classes.rows[0].owner_id, "co.ha");
});

// --- 3. MỘT TÀI KHOẢN KHÔNG THAO TÁC ĐƯỢC THAY TÀI KHOẢN KHÁC (DoD 3) --------

test("giáo viên KHÔNG tạo/xoá/liệt kê được tài khoản, và KHÔNG đổi được mật khẩu người khác", async function () {
	await resetAdminUsers();

	var owner = await loginAs("admin", LEGACY_PASSWORD);
	await owner.post("/api/admin/users").send({ username: "co.ha", password: "matkhau-8ky" }).expect(200);
	await owner.post("/api/admin/users").send({ username: "thay.nam", password: "matkhau-8ky" }).expect(200);

	var teacher = await loginAs("co.ha", "matkhau-8ky");

	await teacher.get("/api/admin/users").expect(403);
	await teacher.post("/api/admin/users").send({ username: "tu.tao", password: "matkhau-8ky" }).expect(403);
	await teacher.delete("/api/admin/users/thay.nam").expect(403);
	await teacher.post("/api/admin/users/thay.nam/password").send({ password: "cuop-tai-khoan" }).expect(403);

	// Mật khẩu của `thay.nam` KHÔNG đổi — kiểm bằng đăng nhập thật, không tin 403 suông.
	await freshLogin("thay.nam", "matkhau-8ky");

	// Nhưng đổi mật khẩu CỦA CHÍNH MÌNH thì được.
	await teacher.post("/api/admin/users/co.ha/password").send({ password: "matkhau-moi-cua-ha" }).expect(200);
	await freshLogin("co.ha", "matkhau-moi-cua-ha");
});

test("giáo viên A không nhìn thấy lớp của giáo viên B (quyền sở hữu P2-5 nay là tài khoản thật)", async function () {
	await resetAdminUsers();
	await sharedSql.query("DELETE FROM class_codes", []);

	var owner = await loginAs("admin", LEGACY_PASSWORD);
	await owner.post("/api/admin/users").send({ username: "co.ha", password: "matkhau-8ky" }).expect(200);
	await owner.post("/api/admin/users").send({ username: "thay.nam", password: "matkhau-8ky" }).expect(200);

	var teacherA = await loginAs("co.ha", "matkhau-8ky");
	var teacherB = await loginAs("thay.nam", "matkhau-8ky");

	var created = await teacherA.post("/api/admin/classes").send({ label: "Lớp 6A", expiresInDays: 30 }).expect(200);
	var classId = created.body.class.id;

	var listB = await teacherB.get("/api/admin/classes").expect(200);
	assert.equal(listB.body.classes.length, 0, "lớp của người khác không được lọt vào danh sách");

	// 404 chứ KHÔNG 403 — 403 là câu xác nhận "lớp đó có thật, chỉ không phải của bạn".
	await teacherB.get("/api/admin/classes/" + classId + "/members").expect(404);
	await teacherB.post("/api/admin/classes/" + classId + "/revoke").expect(404);
	await teacherB.delete("/api/admin/classes/" + classId).expect(404);
	await teacherB.get("/api/admin/stats?level=lop6&classId=" + classId).expect(404);

	// Và lớp vẫn còn nguyên sau cả bốn lượt tấn công.
	var listA = await teacherA.get("/api/admin/classes").expect(200);
	assert.equal(listA.body.classes.length, 1);
});

test("bảng quyền `canManage` — liệt kê cả bảng, không chỉ vài nhánh may mắn", function () {
	var owner = { username: "admin", role: "owner" };
	var teacher = { username: "co.ha", role: "teacher" };

	assert.equal(adminUser.canManage(owner, "create", "ai.do").allowed, true);
	assert.equal(adminUser.canManage(owner, "delete", "ai.do").allowed, true);
	assert.equal(adminUser.canManage(owner, "delete", "admin").allowed, false, "owner không tự xoá mình");
	assert.equal(adminUser.canManage(owner, "set-password", "ai.do").allowed, true);
	assert.equal(adminUser.canManage(owner, "set-password", "admin").allowed, true);

	assert.equal(adminUser.canManage(teacher, "create", "ai.do").allowed, false);
	assert.equal(adminUser.canManage(teacher, "delete", "ai.do").allowed, false);
	assert.equal(adminUser.canManage(teacher, "delete", "co.ha").allowed, false, "giáo viên cũng không tự xoá mình");
	assert.equal(adminUser.canManage(teacher, "set-password", "ai.do").allowed, false);
	assert.equal(adminUser.canManage(teacher, "set-password", "co.ha").allowed, true, "chỉ mật khẩu của chính mình");

	// Tên viết hoa/thừa khoảng trắng vẫn phải nhận ra là CHÍNH MÌNH.
	assert.equal(adminUser.canManage(teacher, "set-password", "  CO.HA ").allowed, true);
});

// --- 4. MỌI ROUTE ADMIN CŨ VẪN HOẠT ĐỘNG (DoD 4) -----------------------------

test("mọi route admin cũ vẫn hoạt động sau khi có admin_users", async function () {
	await resetAdminUsers();

	var owner = await loginAs("admin", LEGACY_PASSWORD);

	// Phiên + đăng xuất (shape V1 giữ nguyên, chỉ THÊM field).
	var session = await owner.get("/api/admin/session").expect(200);
	assert.equal(session.body.authenticated, true);
	assert.equal(session.body.username, "admin");
	assert.equal(session.body.role, "owner");

	// Ngân hàng câu hỏi — 5 route settings + replace.
	var bundle = await request(sharedRuntime.app).get("/api/levels/lop6/question-bank").expect(200);
	assert.ok(Array.isArray(bundle.body.questions));

	await owner.put("/api/levels/lop6/questions").send({ questions: bundle.body.questions }).expect(200);
	await owner.put("/api/levels/lop6/settings/point").send({ settings: { easy: 10 } }).expect(200);
	await owner.put("/api/levels/lop6/settings/time").send({ settings: { easy: 12 } }).expect(200);
	await owner.put("/api/levels/lop6/settings/speed").send({ value: 1.2 }).expect(200);
	await owner.put("/api/levels/lop6/settings/quiz-mode").send({ value: "modal" }).expect(200);
	await owner.put("/api/levels/lop6/settings/speed").send({ value: 1 }).expect(200);
	await owner.put("/api/levels/lop6/settings/quiz-mode").send({ value: "gate" }).expect(200);

	// Kiểm duyệt (P1-4).
	await owner.get("/api/admin/scores?limit=50").expect(200);
	await owner.get("/api/admin/blocked-nicknames").expect(200);
	await owner.post("/api/admin/blocked-nicknames").send({ nickname: "tenxau", reason: "test" }).expect(200);
	await owner.delete("/api/admin/blocked-nicknames/tenxau").expect(200);

	// Dashboard (P1-6 + P2-5).
	await owner.get("/api/admin/stats?level=lop6").expect(200);
	var csv = await owner.get("/api/admin/stats.csv?level=lop6").expect(200);
	assert.match(csv.headers["content-type"], /charset=utf-8/);

	// Nhập/xuất Excel (P2-6).
	await owner.get("/api/admin/questions.csv?level=lop6").expect(200);
	var preview = await owner
		.post("/api/admin/questions/import/preview?mode=merge")
		.set("Content-Type", "text/csv")
		.send("khong-phai-csv-hop-le");
	assert.equal(preview.status, 200, "file sai định dạng là câu trả lời 200 + ok:false, không phải 4xx");
	assert.equal(preview.body.ok, false);

	// Lớp học (P2-5).
	await owner.get("/api/admin/classes").expect(200);
});

test("chưa đăng nhập thì mọi route admin (cũ và mới) đều 401", async function () {
	var guest = request(sharedRuntime.app);

	await guest.get("/api/admin/users").expect(401);
	await guest.post("/api/admin/users").send({ username: "x.y", password: "matkhau-8ky" }).expect(401);
	await guest.delete("/api/admin/users/admin").expect(401);
	await guest.post("/api/admin/users/admin/password").send({ password: "matkhau-8ky" }).expect(401);
	await guest.get("/api/admin/stats?level=lop6").expect(401);
	await guest.get("/api/admin/classes").expect(401);
	await guest.get("/api/admin/scores").expect(401);
	await guest.get("/api/admin/questions.csv").expect(401);
	await guest.put("/api/levels/lop6/settings/speed").send({ value: 1 }).expect(401);
});

// --- 5. SCHEMA + KHO ---------------------------------------------------------

test("schema admin_users idempotent và KHÔNG thu thập dữ liệu cá nhân của giáo viên", function () {
	var schema = fs.readFileSync(path.join(rootDir, "server", "schema.js"), "utf8");
	var block = schema.slice(schema.indexOf("CREATE TABLE IF NOT EXISTS admin_users"));
	block = block.slice(0, block.indexOf('")'));

	["username", "password_hash", "display_name", "role", "last_login_at"].forEach(function (column) {
		assert.ok(block.includes(column), "admin_users thiếu cột " + column);
	});

	// Trang này không gửi thư và không khôi phục mật khẩu tự động, nên thu thập
	// email/điện thoại chỉ là thêm dữ liệu để mất.
	["email", "phone", "address", "birth"].forEach(function (column) {
		assert.equal(new RegExp("\\b" + column + "\\b", "i").test(block), false, "admin_users không được có cột " + column);
	});

	assert.ok(schema.includes("CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_username"));
	assert.ok(schema.includes("CREATE TABLE IF NOT EXISTS admin_users ("), "phải idempotent (IF NOT EXISTS)");
});

test("mật khẩu lưu bằng bcrypt, KHÔNG bao giờ lưu nguyên văn", async function () {
	await resetAdminUsers();

	var owner = await loginAs("admin", LEGACY_PASSWORD);
	await owner.post("/api/admin/users").send({ username: "co.ha", password: "matkhau-8ky" }).expect(200);

	var row = await sharedSql.query("SELECT password_hash FROM admin_users WHERE username='co.ha'", []);
	assert.match(row.rows[0].password_hash, /^\$2[aby]\$/, "phải là hash bcrypt");
	assert.equal(row.rows[0].password_hash.includes("matkhau-8ky"), false);
});

test("CHƯA NỐI CSDL (production hôm nay): vẫn đăng nhập được bằng ADMIN_PASSWORD_HASH", async function () {
	// `VERCEL` khác rỗng ⇒ `createSqlClient` trả null ⇒ mọi kho tắt êm. Đây ĐÚNG là
	// trạng thái production trước khi ai đó chạy `npm run migrate`, và là kịch bản
	// khoá cửa nguy hiểm nhất của P2-7: bảng `admin_users` chưa tồn tại.
	var previousVercel = process.env.VERCEL;
	process.env.VERCEL = "1";

	var runtime;

	try {
		runtime = createApp({
			rootDir: rootDir,
			staticDir: rootDir,
			runtimeDir: sharedRuntimeDir,
			databaseUrl: "",
			jwtSecret: "test-secret-key-p2-7",
			adminPasswordHash: sharedConfig.adminPasswordHash,
			loginRateLimitMax: 200,
			nodeEnv: "test"
		});

		var agent = request.agent(runtime.app);
		var login = await agent.post("/api/admin/login").send({ password: LEGACY_PASSWORD }).expect(200);
		assert.equal(login.body.authenticated, true);
		assert.equal(login.body.username, "admin");

		var session = await agent.get("/api/admin/session").expect(200);
		assert.equal(session.body.authenticated, true);
		assert.equal(session.body.multiAccount, false, "chưa có bảng thì trang phải biết để không mời tạo tài khoản");

		// Và route tài khoản báo rõ ràng thay vì ném 500.
		var create = await agent.post("/api/admin/users").send({ username: "co.ha", password: "matkhau-8ky" });
		assert.equal(create.status, 400);
		assert.match(create.body.error, /Chưa nối cơ sở dữ liệu/);
	} finally {
		if (runtime !== undefined) {
			runtime.close();
		}

		if (previousVercel === undefined) {
			delete process.env.VERCEL;
		} else {
			process.env.VERCEL = previousVercel;
		}
	}
});

test("hạn mức đăng nhập mặc định vẫn là 5/phút và KHÔNG biến môi trường nào đổi được", function () {
	var configModule = require("../server/config");
	var previous = process.env.LOGIN_RATE_LIMIT_MAX;
	process.env.LOGIN_RATE_LIMIT_MAX = "9999";

	try {
		assert.equal(configModule.resolveConfig({}).loginRateLimitMax, 5);
	} finally {
		if (previous === undefined) {
			delete process.env.LOGIN_RATE_LIMIT_MAX;
		} else {
			process.env.LOGIN_RATE_LIMIT_MAX = previous;
		}
	}

	var source = fs.readFileSync(path.join(rootDir, "server", "config.js"), "utf8");
	var block = source.slice(source.indexOf("loginRateLimitMax"));
	assert.equal(/process\.env/.test(block.slice(0, 120)), false, "hạn mức đăng nhập không được đọc từ biến môi trường");
});

// --- 6. TRANG ADMIN ĐÃ VÀO VITE ----------------------------------------------

test("trang quản trị là entry point Vite ở ĐÚNG URL /admin.html", function () {
	var viteConfig = fs.readFileSync(path.join(rootDir, "client", "vite.config.mts"), "utf8");

	assert.ok(/admin:\s*resolve\(clientDir,\s*"admin\.html"\)/.test(viteConfig), "admin.html phải là input của Vite");

	// URL `/admin.html` là hợp đồng §7.3.5 và là bookmark giáo viên đang dùng.
	assert.equal(fs.existsSync(adminSource.ADMIN_HTML), true);

	// Và bản legacy ở gốc repo đã đi hẳn — còn nó là bước copy của vercel-build sẽ
	// đè lên file Vite vừa sinh (đúng lỗi Service Worker mà P2-7 sửa).
	assert.equal(fs.existsSync(path.join(rootDir, "admin.html")), false, "không được còn admin.html ở gốc repo");

	var buildScript = fs.readFileSync(path.join(rootDir, "scripts", "vercel-build.js"), "utf8");
	var staticList = buildScript.slice(buildScript.indexOf("var staticFiles = ["));
	staticList = staticList.slice(0, staticList.indexOf("];"));
	assert.equal(staticList.includes('"admin.html"'), false, "vercel-build KHÔNG được copy đè admin.html nữa");
});

test("trang quản trị KHÔNG nằm trong precache của Service Worker", function () {
	var viteConfig = fs.readFileSync(path.join(rootDir, "client", "vite.config.mts"), "utf8");
	var globIgnores = viteConfig.slice(viteConfig.indexOf("globIgnores: ["));
	globIgnores = globIgnores.slice(0, globIgnores.indexOf("],"));

	// Ba mục: trang, JS và CSS của entry admin.
	assert.ok(globIgnores.includes('"admin.html"'));
	assert.ok(globIgnores.includes("assets/admin-*.js"));
	assert.ok(globIgnores.includes("assets/admin-*.css"));
});

test("trang quản trị KHÔNG kéo three.js / asset game vào bundle của nó", function () {
	var source = adminSource.readAdminSource();

	// Không import three, không import scene/entity/fx của game.
	assert.equal(/from ["']three["']/.test(source), false, "trang quản trị không được import three");
	assert.equal(/@\/scenes\//.test(source), false);
	assert.equal(/@\/entities\//.test(source), false);
	assert.equal(/@\/fx\//.test(source), false);

	// Và tầng DUY NHẤT chạm window.QuestionBank vẫn là questionBridge (quy tắc vàng #3).
	assert.equal(/window\.QuestionBank/.test(source), false);
	assert.ok(/@\/integration\/questionBridge/.test(source), "phải đi qua questionBridge");
});

test("trang quản trị giữ ĐỦ chức năng của bản legacy — checklist P2-7", function () {
	var markup = adminSource.readAdminMarkup();
	var source = adminSource.readAdminSource();

	// Mọi `id` mà bản legacy có, bản Vite phải có. Đây là hàng rào chống hồi quy
	// "mất một nút trong lúc hiện đại hoá" — đúng thứ task P2-7 sợ nhất.
	[
		// Đăng nhập + khung trang
		"admin-auth-shell", "admin-auth-form", "admin-password-input", "admin-auth-error",
		"admin-page", "admin-logout-button", "notice",
		// Chọn lớp + KPI
		"level-switcher", "kpi-total", "kpi-remaining", "kpi-answered", "level-meta",
		// Điểm / thời gian / tốc độ / cách hỏi
		"point-settings-grid", "save-points-button",
		"time-settings-grid", "save-times-button",
		"game-speed-setting-input", "save-speed-button",
		"quiz-mode-setting-input", "save-quiz-mode-button",
		// Danh sách đã trả lời
		"reset-answered-button", "answered-summary", "answered-table-body",
		// Form câu hỏi
		"question-form", "question-form-title", "reset-form-button", "question-id", "question-difficulty",
		"question-text", "question-explanation", "answer-A", "answer-B", "answer-C", "answer-D",
		"correct-answer", "question-point", "question-time", "current-level-label",
		"save-question-button", "delete-editing-button",
		// Bảng câu hỏi
		"explanation-coverage", "question-table-body",
		// Nhập/xuất Excel (P2-6)
		"bank-export-level", "bank-export-all", "bank-import-file", "bank-import-mode",
		"bank-preview-button", "bank-apply-button", "bank-import-result",
		// Lớp học (P2-5)
		"class-refresh", "class-label", "class-level", "class-expires", "class-create-button",
		"class-table-body", "class-members",
		// Dashboard (P1-6)
		"stats-refresh", "stats-csv", "stats-class", "stats-from", "stats-to", "stats-summary",
		"stats-runs-chart", "stats-difficulty-chart", "stats-skill-chart", "stats-wrong-body",
		// Kiểm duyệt (P1-4)
		"moderation-refresh", "moderation-table-body", "block-nickname", "block-reason",
		"block-nickname-button", "blocked-list",
		// Tài khoản quản trị (P2-7 — mới)
		"users-refresh", "user-username", "user-display-name", "user-password", "user-role",
		"user-create-button", "users-table-body", "own-password", "own-password-confirm", "own-password-button"
	].forEach(function (id) {
		assert.ok(markup.includes('id="' + id + '"'), "trang quản trị thiếu #" + id);
	});

	// Mọi endpoint bản legacy gọi, bản Vite phải còn gọi.
	[
		"/api/admin/login", "/api/admin/logout", "/api/admin/session",
		"/api/levels/", "settings/quiz-mode",
		"/api/admin/scores", "/api/admin/blocked-nicknames",
		"/api/admin/stats", "/api/admin/stats.csv",
		"/api/admin/questions.csv", "/api/admin/questions/import/preview", "/api/admin/questions/import/apply",
		"/api/admin/classes",
		"/api/admin/users"
	].forEach(function (endpoint) {
		assert.ok(source.includes(endpoint), "trang quản trị không còn gọi " + endpoint);
	});

	// Ba hộp thoại xác nhận KHÔNG được biến mất: cả ba đứng trước một thao tác
	// không hoàn tác được.
	assert.ok(/Xoá vĩnh viễn bản ghi điểm này\?/.test(source));
	assert.ok(/không hoàn tác được/.test(source));
	assert.ok(/Reset danh sách đã trả lời/.test(source));
});
