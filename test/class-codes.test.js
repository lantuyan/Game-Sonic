"use strict";

// P2-5 — MÃ LỚP HỌC + DASHBOARD LỌC THEO LỚP THẬT.
//
// Chạy trên PGlite THẬT (không mock SQL), đúng lý do đã ghi ở test/dashboard.test.js:
// giá trị của tính năng này nằm ở "con số có đúng lớp không", mà mock query chỉ
// kiểm được rằng ta có gọi hàm.
//
// ⚠ CẤU HÌNH TRUYỀN TAY, `databaseUrl` RỖNG TƯỜNG MINH. File `.env` của dự án trỏ
// vào Neon production; không test nào ở đây được phép chạm tới nó.
//
// DoD (tasks-version2.md P2-5): mã không đoán được · hết hạn/thu hồi có hiệu lực ·
// giáo viên A không xem được lớp của giáo viên B · dashboard lọc đúng lớp · không
// thu thập thêm dữ liệu cá nhân · xoá lớp trả dữ liệu về ẩn danh.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");
var bcrypt = require("bcrypt");
var jwt = require("jsonwebtoken");
var request = require("../test-helpers/loopbackRequest");
var createApp = require("../server/app").createApp;
var pgTempDir = require("../test-helpers/pgTempDir");
var classCode = require("../server/classCode");
var classStoreModule = require("../server/classStore");
var loadClientModule = require("../test-helpers/clientModule").loadClientModule;

var rootDir = path.resolve(__dirname, "..");
var createSqlClient = require("../server/sql").createSqlClient;
var applySchema = require("../server/schema").applySchema;

// MỘT PGlite duy nhất cho cả file — mỗi test một `mkdtempSync` từng làm đầy ổ đĩa
// thật 25 GB (ghi ở P1-6). Dọn bảng trước mỗi test thay vì dựng CSDL mới.
var sharedRuntimeDir = pgTempDir.createTempDir("class-codes-");
var JWT_SECRET = "test-secret-key-p2-5";
var sharedConfig = {
	rootDir: rootDir,
	staticDir: rootDir,
	runtimeDir: sharedRuntimeDir,
	pgDataDir: path.join(sharedRuntimeDir, "pgdata"),
	// TƯỜNG MINH rỗng: không đọc DATABASE_URL của .env trong bất kỳ hoàn cảnh nào.
	databaseUrl: "",
	jwtSecret: JWT_SECRET,
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
var sharedStore = classStoreModule.createClassStore({ sql: sharedSql });

async function resetDatabase() {
	// applySchema idempotent, và phải tự gọi ở đây vì chuỗi promise của createApp là
	// một chuỗi KHÁC (bẫy đã ghi ở test/dashboard.test.js).
	await applySchema(sharedSql);
	await sharedSql.query("DELETE FROM answer_events", []);
	await sharedSql.query("DELETE FROM class_members", []);
	await sharedSql.query("DELETE FROM class_codes", []);
	await sharedSql.query("DELETE FROM skill_profiles", []);
}

async function makeRuntime() {
	await resetDatabase();
	return sharedRuntime;
}

// Đăng nhập MỘT lần cho cả file: login limiter đếm theo IP (đúng — chống dò mật
// khẩu), nên mỗi test tự đăng nhập lại là tự đâm vào 429.
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

/**
 * Phiên của MỘT GIÁO VIÊN KHÁC.
 *
 * Hôm nay hệ thống chỉ có một tài khoản admin, nên cách duy nhất kiểm được "giáo
 * viên A không xem được lớp của giáo viên B" là ký một token với `owner` khác —
 * đúng thứ P2-7 sẽ phát hành thật khi có `admin_users`. Nếu một ngày ai đó gỡ
 * `owner_id` khỏi truy vấn, những test dưới đây đỏ ngay.
 */
function otherTeacherCookie(ownerId) {
	return "admin_token=" + jwt.sign({ role: "admin", owner: ownerId }, JWT_SECRET, { expiresIn: "8h" });
}

/**
 * Bỏ chú thích trước khi soi mã nguồn: những file này GIẢI THÍCH vì sao không làm
 * điều gì đó, nên đọc cả chú thích thì test tự đỏ vì chính lời cảnh báo của mình.
 */
function stripComments(source) {
	return source
		.split("\n")
		.map(function (line) {
			return line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
		})
		.join("\n");
}

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
				mode: "gate",
				difficulty: "medium"
			};
		})
	};
}

// --- 1. MÃ LỚP KHÔNG ĐOÁN ĐƯỢC ----------------------------------------------

test("mã lớp KHÔNG đoán được: 2^40 tổ hợp, 5.000 mã không trùng nhau cái nào (DoD 1)", function () {
	assert.equal(classCode.ALPHABET.length, 32);
	assert.equal(classCode.CODE_LENGTH, 8);
	assert.ok(
		classCode.CODE_ENTROPY_BITS >= 40,
		"không gian mã phải ≥ 2^40 — mã lộ nghĩa là người lạ gắn được máy vào lớp của trẻ con"
	);

	var seen = new Set();
	var histogram = new Map();

	for (var index = 0; index < 5000; index += 1) {
		var code = classCode.generateCode();

		assert.equal(code.length, 8);
		assert.equal(seen.has(code), false, "hai mã trùng nhau trong 5.000 lần sinh là dấu hiệu nguồn ngẫu nhiên hỏng");
		seen.add(code);

		for (var position = 0; position < code.length; position += 1) {
			var char = code.charAt(position);
			assert.ok(classCode.ALPHABET.indexOf(char) !== -1, "ký tự ngoài bảng chữ: " + char);
			histogram.set(char, (histogram.get(char) || 0) + 1);
		}
	}

	// Phủ đều: 40.000 ký tự trên 32 giá trị ⇒ trung bình 1.250 lần mỗi ký tự. Một
	// bảng chữ bị lệch nặng (vd sai lệch modulo) sẽ rơi ra ngoài dải rộng này.
	assert.equal(histogram.size, 32, "phải dùng hết cả bảng chữ");
	histogram.forEach(function (count, char) {
		assert.ok(count > 900 && count < 1600, "ký tự " + char + " xuất hiện lệch: " + count);
	});
});

test("mã lớp không chứa ký tự dễ đọc nhầm I O 0 1", function () {
	["I", "O", "0", "1"].forEach(function (char) {
		assert.equal(classCode.ALPHABET.indexOf(char), -1, "bảng chữ không được chứa " + char);
	});

	// Và chuẩn hoá phải TỪ CHỐI mã có ký tự đó thay vì "đoán ý" đổi O thành 0 —
	// đoán ý chỉ biến một mã sai thành một mã sai khác.
	assert.equal(classCode.normalizeCode("ABCD-2O45"), "");
});

test("mã lớp sinh bằng crypto.randomBytes, KHÔNG phải Math.random (DoD 1)", function () {
	var source = fs.readFileSync(path.join(rootDir, "server", "classCode.js"), "utf8");
	// Bỏ chú thích trước khi soi: chính file đó GIẢI THÍCH vì sao không dùng
	// `Math.random`, nên đọc cả chú thích thì test tự đỏ vì lời cảnh báo của mình.
	var code = source
		.split("\n")
		.map(function (line) {
			return line.replace(/\/\/.*$/, "");
		})
		.join("\n");

	assert.ok(/crypto\.randomBytes/.test(code));
	assert.equal(
		/Math\.random/.test(code),
		false,
		"Math.random là PRNG không mã hoá: quan sát vài mã là đoán được mã kế tiếp"
	);
});

test("chuẩn hoá mã: học sinh gõ kiểu nào cũng vào đúng lớp", function () {
	var code = classCode.generateCode();
	var display = classCode.formatCode(code);

	assert.equal(display.length, 9);
	assert.equal(display.charAt(4), "-");
	assert.equal(classCode.normalizeCode(display), code, "dạng có gạch phải vào được");
	assert.equal(classCode.normalizeCode(display.toLowerCase()), code, "chữ thường phải vào được");
	assert.equal(classCode.normalizeCode("  " + code + "  "), code);
	assert.equal(classCode.normalizeCode(code.slice(0, 4) + " " + code.slice(4)), code, "dấu cách khi chép tay");

	assert.equal(classCode.normalizeCode(""), "");
	assert.equal(classCode.normalizeCode("ABC"), "", "thiếu ký tự → từ chối, không đoán");
	assert.equal(classCode.normalizeCode(null), "");
});

test("hạn dùng BẮT BUỘC và có trần: 1–180 ngày, mặc định 30", function () {
	assert.equal(classCode.normalizeExpiresInDays(null), 30);
	assert.equal(classCode.normalizeExpiresInDays("7"), 7);
	assert.throws(function () {
		classCode.normalizeExpiresInDays(0);
	}, /1–180/);
	assert.throws(function () {
		classCode.normalizeExpiresInDays(365);
	}, /1–180/, "mã sống hơn một năm học là mã đi theo học sinh sang lớp khác");
});

// --- 2. VÒNG ĐỜI MÃ: TẠO → VÀO LỚP → HẾT HẠN → THU HỒI ----------------------

test("giáo viên tạo mã, học sinh nhập một lần là vào lớp", async function () {
	var runtime = await makeRuntime();
	var agent = await loginAdmin(runtime);

	var created = (await agent.post("/api/admin/classes").send({ label: "Lớp 6A", level: "lop6" }).expect(200)).body;

	assert.equal(created.ok, true);
	assert.equal(classCode.normalizeCode(created.class.code), created.class.code);
	assert.equal(created.class.status, "active");
	assert.equal(created.class.memberCount, 0);
	assert.ok(new Date(created.class.expiresAt).getTime() > Date.now(), "mã mới phải còn hạn");

	// Học sinh gõ dạng hiển thị, chữ thường — vẫn phải vào được.
	var joined = (await request(runtime.app).post("/api/classes/join").send({
		deviceId: "may-6a-01",
		code: created.class.codeDisplay.toLowerCase()
	}).expect(200)).body;

	assert.equal(joined.ok, true);
	assert.equal(joined.class.label, "Lớp 6A");
	assert.equal(joined.class.level, "lop6");
	assert.equal(joined.class.code, undefined, "phản hồi cho học sinh KHÔNG được chứa mã lớp");

	var status = (await request(runtime.app).get("/api/players/may-6a-01/class").expect(200)).body;
	assert.equal(status.class.label, "Lớp 6A");
	assert.equal(status.class.members, undefined, "học sinh không bao giờ được đọc danh sách bạn cùng lớp");
});

test("mã HẾT HẠN thì không vào lớp được nữa (DoD 2)", async function () {
	await makeRuntime();

	var created = await sharedStore.createClass("admin", { label: "Lớp hết hạn", expiresInDays: 1 });

	// Đẩy hạn về quá khứ — cách duy nhất kiểm được "hết hạn" mà không phải chờ.
	await sharedSql.query("UPDATE class_codes SET expires_at = now() - INTERVAL '1 minute' WHERE id = $1", [
		created.class.id
	]);

	var joined = await sharedStore.joinByCode("may-het-han", { code: created.class.code });

	assert.equal(joined.ok, false);
	assert.equal(joined.reason, "expired");

	var members = await sharedStore.listMembers("admin", created.class.id);
	assert.equal(members.members.length, 0, "mã hết hạn KHÔNG được tạo thành viên mới");
});

test("THU HỒI mã có hiệu lực ngay, và không đuổi thành viên cũ (DoD 3)", async function () {
	var runtime = await makeRuntime();
	var agent = await loginAdmin(runtime);

	var created = (await agent.post("/api/admin/classes").send({ label: "Lớp 7B" }).expect(200)).body;

	await request(runtime.app).post("/api/classes/join")
		.send({ deviceId: "may-7b-01", code: created.class.code }).expect(200);

	await agent.post("/api/admin/classes/" + created.class.id + "/revoke").expect(200);

	var afterRevoke = (await request(runtime.app).post("/api/classes/join")
		.send({ deviceId: "may-7b-02", code: created.class.code }).expect(200)).body;

	assert.equal(afterRevoke.ok, false);
	assert.equal(afterRevoke.reason, "revoked");

	// Thu hồi là ĐÓNG CỬA VÀO, không phải xoá lớp: em đã ở trong lớp vẫn ở trong lớp.
	var members = (await agent.get("/api/admin/classes/" + created.class.id + "/members").expect(200)).body;
	assert.equal(members.members.length, 1);
	assert.equal(members.members[0].deviceId, "may-7b-01");

	var list = (await agent.get("/api/admin/classes").expect(200)).body;
	var row = list.classes.find(function (item) {
		return item.id === created.class.id;
	});
	assert.equal(row.status, "revoked");
});

test("mã sai / mã không tồn tại → trả lời bình thường kèm lý do, không phải 4xx", async function () {
	await makeRuntime();

	assert.deepEqual(await sharedStore.joinByCode("may-x", { code: "" }), { ok: false, reason: "invalid" });
	assert.deepEqual(await sharedStore.joinByCode("may-x", { code: "khong-phai-ma" }), { ok: false, reason: "invalid" });

	var missing = await sharedStore.joinByCode("may-x", { code: classCode.generateCode() });
	assert.deepEqual(missing, { ok: false, reason: "not-found" });
});

test("nhập mã lớp mới là CHUYỂN lớp, không phải vào thêm lớp thứ hai", async function () {
	await makeRuntime();

	var first = await sharedStore.createClass("admin", { label: "Lớp cũ" });
	var second = await sharedStore.createClass("admin", { label: "Lớp mới" });

	await sharedStore.joinByCode("may-chuyen", { code: first.class.code });
	await sharedStore.joinByCode("may-chuyen", { code: second.class.code });

	var rows = await sharedSql.query("SELECT class_id FROM class_members WHERE device_id = $1", ["may-chuyen"]);
	assert.equal(rows.rows.length, 1, "một máy chỉ thuộc một lớp");
	assert.equal(Number(rows.rows[0].class_id), second.class.id);

	var membership = await sharedStore.getMembership("may-chuyen");
	assert.equal(membership.class.label, "Lớp mới");
});

// --- 3. CÁCH LY GIỮA CÁC GIÁO VIÊN ------------------------------------------

test("giáo viên A KHÔNG xem/sửa được lớp của giáo viên B (DoD 4)", async function () {
	var runtime = await makeRuntime();
	var agent = await loginAdmin(runtime);
	var cookieB = otherTeacherCookie("teacher-b");

	var mine = (await agent.post("/api/admin/classes").send({ label: "Lớp của cô A" }).expect(200)).body;
	await request(runtime.app).post("/api/classes/join")
		.send({ deviceId: "may-cua-co-a", code: mine.class.code }).expect(200);
	await request(runtime.app).post("/api/runs/summary").send(runPayload("may-cua-co-a", "cc")).expect(200);

	// B đăng nhập hợp lệ nhưng KHÔNG thấy lớp của A.
	var listB = (await request(runtime.app).get("/api/admin/classes").set("Cookie", cookieB).expect(200)).body;
	assert.deepEqual(listB.classes, [], "liệt kê lớp phải luôn kèm chủ sở hữu");

	// Mọi đường đụng tới lớp của A đều là 404 — KHÔNG phải 403: 403 là câu xác nhận
	// "lớp này có thật, chỉ là không phải của bạn".
	await request(runtime.app).get("/api/admin/stats?classId=" + mine.class.id).set("Cookie", cookieB).expect(404);
	await request(runtime.app).get("/api/admin/stats.csv?classId=" + mine.class.id).set("Cookie", cookieB).expect(404);
	await request(runtime.app).get("/api/admin/classes/" + mine.class.id + "/members").set("Cookie", cookieB).expect(404);
	await request(runtime.app).post("/api/admin/classes/" + mine.class.id + "/revoke").set("Cookie", cookieB).expect(404);
	await request(runtime.app).delete("/api/admin/classes/" + mine.class.id + "/members/may-cua-co-a").set("Cookie", cookieB).expect(404);
	await request(runtime.app).delete("/api/admin/classes/" + mine.class.id).set("Cookie", cookieB).expect(404);

	// …và không có gì thay đổi sau cả loạt đó.
	var afterAttack = (await agent.get("/api/admin/classes").expect(200)).body;
	assert.equal(afterAttack.classes.length, 1);
	assert.equal(afterAttack.classes[0].status, "active", "lớp của A không bị B thu hồi");
	assert.equal(afterAttack.classes[0].memberCount, 1, "thành viên của A không bị B gỡ");

	var statsA = (await agent.get("/api/admin/stats?classId=" + mine.class.id).expect(200)).body;
	assert.equal(statsA.totals.answers, 2, "số liệu của A còn nguyên");
});

test("route lớp học đòi đăng nhập admin như mọi route admin khác", async function () {
	var runtime = await makeRuntime();

	await request(runtime.app).get("/api/admin/classes").expect(401);
	await request(runtime.app).post("/api/admin/classes").send({ label: "Lớp lậu" }).expect(401);
	await request(runtime.app).delete("/api/admin/classes/1").expect(401);

	// Route của học sinh thì công khai — trong phòng máy không có ai đăng nhập admin.
	await request(runtime.app).post("/api/classes/join").send({ deviceId: "may-cong-khai", code: "ABCD2345" }).expect(200);
});

// --- 4. DASHBOARD LỌC THEO LỚP THẬT -----------------------------------------

test("dashboard lọc ĐÚNG lớp, và máy chưa vào lớp không lọt vào lớp nào (DoD 5)", async function () {
	var runtime = await makeRuntime();
	var agent = await loginAdmin(runtime);

	var classA = (await agent.post("/api/admin/classes").send({ label: "6A", level: "lop6" }).expect(200)).body.class;
	var classB = (await agent.post("/api/admin/classes").send({ label: "6B", level: "lop6" }).expect(200)).body.class;

	await request(runtime.app).post("/api/classes/join").send({ deviceId: "a1", code: classA.code }).expect(200);
	await request(runtime.app).post("/api/classes/join").send({ deviceId: "a2", code: classA.code }).expect(200);
	await request(runtime.app).post("/api/classes/join").send({ deviceId: "b1", code: classB.code }).expect(200);

	// 6A: 4 câu, 3 đúng. 6B: 2 câu, 0 đúng. Một máy không thuộc lớp nào: 3 câu.
	await request(runtime.app).post("/api/runs/summary").send(runPayload("a1", "cc")).expect(200);
	await request(runtime.app).post("/api/runs/summary").send(runPayload("a2", "cw")).expect(200);
	await request(runtime.app).post("/api/runs/summary").send(runPayload("b1", "ww")).expect(200);
	await request(runtime.app).post("/api/runs/summary").send(runPayload("khach-vang-lai", "ccc")).expect(200);

	var statsA = (await agent.get("/api/admin/stats?classId=" + classA.id).expect(200)).body;
	assert.equal(statsA.totals.answers, 4);
	assert.equal(statsA.totals.correct, 3);
	assert.equal(statsA.totals.devices, 2);

	var statsB = (await agent.get("/api/admin/stats?classId=" + classB.id).expect(200)).body;
	assert.equal(statsB.totals.answers, 2);
	assert.equal(statsB.totals.correct, 0);

	// Không lọc = toàn trường, gồm cả máy chưa vào lớp nào.
	var statsAll = (await agent.get("/api/admin/stats").expect(200)).body;
	assert.equal(statsAll.totals.answers, 9);
	assert.equal(statsAll.totals.devices, 4);
});

test("vào lớp KHÔNG kéo theo lịch sử học tập trước đó (DoD 5)", async function () {
	var runtime = await makeRuntime();
	var agent = await loginAdmin(runtime);

	var lop = (await agent.post("/api/admin/classes").send({ label: "8C" }).expect(200)).body.class;

	// Chơi TRƯỚC khi vào lớp…
	await request(runtime.app).post("/api/runs/summary")
		.send(runPayload("may-truoc-sau", "ccc", { runId: "truoc" })).expect(200);
	// …rồi mới nhập mã…
	await request(runtime.app).post("/api/classes/join").send({ deviceId: "may-truoc-sau", code: lop.code }).expect(200);
	// …rồi chơi tiếp.
	await request(runtime.app).post("/api/runs/summary")
		.send(runPayload("may-truoc-sau", "cw", { runId: "sau" })).expect(200);

	var stats = (await agent.get("/api/admin/stats?classId=" + lop.id).expect(200)).body;

	assert.equal(
		stats.totals.answers,
		2,
		"nhập mã lớp hôm nay KHÔNG được mở hồi tố toàn bộ lịch sử học tập của máy đó cho giáo viên"
	);

	var all = (await agent.get("/api/admin/stats").expect(200)).body;
	assert.equal(all.totals.answers, 5, "dữ liệu cũ vẫn còn, chỉ là không thuộc lớp nào");
});

test("classId không hợp lệ / không tồn tại → 4xx, không phải 500 và không lộ lớp người khác", async function () {
	var runtime = await makeRuntime();
	var agent = await loginAdmin(runtime);

	await agent.get("/api/admin/stats?classId=khong-phai-so").expect(400);
	await agent.get("/api/admin/stats?classId=999999").expect(404);
});

// --- 5. QUYỀN RIÊNG TƯ: GỠ, XOÁ, RỜI LỚP ------------------------------------

test("XOÁ LỚP trả dữ liệu về ẩn danh, không xoá dữ liệu học tập (DoD 7)", async function () {
	var runtime = await makeRuntime();
	var agent = await loginAdmin(runtime);

	var lop = (await agent.post("/api/admin/classes").send({ label: "Lớp sắp xoá" }).expect(200)).body.class;

	await request(runtime.app).post("/api/classes/join").send({ deviceId: "may-xoa-lop", code: lop.code }).expect(200);
	await request(runtime.app).post("/api/runs/summary").send(runPayload("may-xoa-lop", "ccw")).expect(200);

	await agent.delete("/api/admin/classes/" + lop.id).expect(200);

	var linked = await sharedSql.query("SELECT COUNT(*)::int AS total FROM answer_events WHERE class_id IS NOT NULL", []);
	assert.equal(linked.rows[0].total, 0, "xoá lớp phải cắt liên kết lớp của mọi dòng dữ liệu");

	var members = await sharedSql.query("SELECT COUNT(*)::int AS total FROM class_members", []);
	assert.equal(members.rows[0].total, 0);

	var all = (await agent.get("/api/admin/stats").expect(200)).body;
	assert.equal(all.totals.answers, 3, "dữ liệu HỌC TẬP không bị xoá — chỉ mất liên kết tới lớp");

	// Lớp đã xoá thì không còn tra được nữa.
	await agent.get("/api/admin/stats?classId=" + lop.id).expect(404);
});

test("GỠ một máy khỏi lớp cũng gỡ liên kết dữ liệu máy đó đã ghi cho lớp", async function () {
	var runtime = await makeRuntime();
	var agent = await loginAdmin(runtime);

	var lop = (await agent.post("/api/admin/classes").send({ label: "Lớp bị lộ mã" }).expect(200)).body.class;

	await request(runtime.app).post("/api/classes/join").send({ deviceId: "hoc-sinh-that", code: lop.code }).expect(200);
	await request(runtime.app).post("/api/classes/join").send({ deviceId: "nguoi-la", code: lop.code }).expect(200);
	await request(runtime.app).post("/api/runs/summary").send(runPayload("hoc-sinh-that", "cc")).expect(200);
	await request(runtime.app).post("/api/runs/summary").send(runPayload("nguoi-la", "wwww")).expect(200);

	var before = (await agent.get("/api/admin/stats?classId=" + lop.id).expect(200)).body;
	assert.equal(before.totals.answers, 6);

	await agent.delete("/api/admin/classes/" + lop.id + "/members/nguoi-la").expect(200);

	var after = (await agent.get("/api/admin/stats?classId=" + lop.id).expect(200)).body;
	assert.equal(after.totals.answers, 2, "gỡ người lạ phải lấy được cả phần dữ liệu họ đã bơm vào lớp");
	assert.equal(after.totals.devices, 1);

	// Gỡ một máy không có trong lớp → 404, và không đụng gì.
	await agent.delete("/api/admin/classes/" + lop.id + "/members/may-khong-co-that").expect(404);
});

test("học sinh TỰ RỜI LỚP được; rời lớp chỉ dừng gắn dữ liệu từ nay về sau", async function () {
	var runtime = await makeRuntime();
	var agent = await loginAdmin(runtime);

	var lop = (await agent.post("/api/admin/classes").send({ label: "Lớp rời" }).expect(200)).body.class;

	await request(runtime.app).post("/api/classes/join").send({ deviceId: "may-roi-lop", code: lop.code }).expect(200);
	await request(runtime.app).post("/api/runs/summary")
		.send(runPayload("may-roi-lop", "cc", { runId: "trong-lop" })).expect(200);

	var left = (await request(runtime.app).delete("/api/players/may-roi-lop/class").expect(200)).body;
	assert.equal(left.left, 1);

	var status = (await request(runtime.app).get("/api/players/may-roi-lop/class").expect(200)).body;
	assert.equal(status.class, null);

	await request(runtime.app).post("/api/runs/summary")
		.send(runPayload("may-roi-lop", "ww", { runId: "ngoai-lop" })).expect(200);

	var stats = (await agent.get("/api/admin/stats?classId=" + lop.id).expect(200)).body;
	assert.equal(stats.totals.answers, 2, "ván sau khi rời lớp không còn thuộc lớp");
	assert.equal(stats.totals.correct, 2);
});

// --- 6. KHÔNG THU THẬP THÊM DỮ LIỆU CÁ NHÂN ----------------------------------

test("schema lớp học KHÔNG có một trường dữ liệu cá nhân nào của trẻ (DoD 6)", function () {
	var schema = fs.readFileSync(path.join(rootDir, "server", "schema.js"), "utf8");
	var classMembersBlock = schema.slice(schema.indexOf("CREATE TABLE IF NOT EXISTS class_members"));
	classMembersBlock = classMembersBlock.slice(0, classMembersBlock.indexOf('")'));

	["device_id", "class_id", "joined_at"].forEach(function (column) {
		assert.ok(classMembersBlock.includes(column), "class_members thiếu cột " + column);
	});

	// Danh sách cấm — canh cho tương lai, không phải cho hiện tại. Ai thêm một cột
	// kiểu "họ tên thật" vào bảng lớp học sẽ làm test này đỏ và phải đọc
	// docs/v2/P2-5-PRIVACY.md trước khi đi tiếp.
	var forbidden = [
		"full_name", "real_name", "ho_ten", "hoten", "student_name",
		"birth", "birthday", "ngay_sinh", "dob",
		"email", "phone", "address", "parent", "avatar", "photo"
	];
	// Chặn đúng KHỐI P2-5, không phải "từ P2-5 tới hết file": P2-7 thêm bảng
	// `admin_users` ở cuối, và bảng đó là của GIÁO VIÊN chứ không phải của trẻ em —
	// DoD 6 nói về dữ liệu cá nhân của HỌC SINH. (admin_users cũng cố ý không có
	// email/điện thoại, nhưng đó là quyết định của P2-7 và có test riêng ở đó.)
	var classBlock = schema.slice(schema.indexOf("P2-5 · lớp học"));
	var nextSectionIndex = classBlock.indexOf("P2-7 ·");

	if (nextSectionIndex !== -1) {
		classBlock = classBlock.slice(0, nextSectionIndex);
	}

	forbidden.forEach(function (column) {
		assert.equal(
			new RegExp("\\b" + column + "\\b", "i").test(classBlock),
			false,
			"bảng lớp học không được có trường dữ liệu cá nhân: " + column
		);
	});
});

test("mã lớp chỉ mở cửa GHI: không route công khai nào nhận classId", function () {
	var source = fs.readFileSync(path.join(rootDir, "server", "app.js"), "utf8");
	var publicRoutes = source.split("\n").filter(function (line) {
		return /app\.(get|post|delete|put)\("\/api\//.test(line) && /classId/.test(line);
	});

	assert.deepEqual(publicRoutes, [], "không route nào được nhận classId ngay trên dòng khai báo");

	// Hai route đọc số liệu theo lớp phải nằm sau requireAdminAuth.
	assert.ok(/app\.get\("\/api\/admin\/stats", auth\.requireAdminAuth/.test(source));
	assert.ok(/app\.get\("\/api\/admin\/stats\.csv", auth\.requireAdminAuth/.test(source));
});

test("route lớp học của học sinh đếm rate-limit theo deviceId, KHÔNG theo IP", async function () {
	var runtime = await makeRuntime();
	var blocked = false;

	// Bẫy NAT phòng máy: cả lớp đi qua một IP. Đếm theo IP thì em thứ hai gõ mã đã
	// bị chặn oan vì em thứ nhất gõ nhầm vài lần.
	for (var index = 0; index < 20; index += 1) {
		var response = await request(runtime.app).post("/api/classes/join")
			.send({ deviceId: "may-gõ-nhieu", code: "ABCD2345" });

		if (response.status === 429) {
			blocked = true;
			break;
		}
	}

	assert.equal(blocked, true, "một máy thử quá nhiều mã thì phải bị chặn");

	// Máy THỨ HAI cùng IP vẫn phải đi được.
	await request(runtime.app).post("/api/classes/join")
		.send({ deviceId: "may-khac-cung-ip", code: "ABCD2345" }).expect(200);
});

// --- 7. TẮT ÊM KHI CHƯA CÓ CSDL ---------------------------------------------

test("KHÔNG CÓ CSDL → mọi route lớp học `disabled: true`, không route nào 500 (DoD 11)", async function () {
	var disabled = classStoreModule.createClassStore({ sql: null });

	assert.equal((await disabled.createClass("admin", { label: "Lớp 6A" })).disabled, true);
	assert.deepEqual((await disabled.listClasses("admin")).classes, []);
	assert.equal(await disabled.getOwnedClass("admin", 1), null);
	assert.equal((await disabled.joinByCode("may-1", { code: "ABCD2345" })).disabled, true);
	assert.equal((await disabled.getMembership("may-1")).class, null);
	assert.equal((await disabled.leaveClass("may-1")).disabled, true);
});

// --- 8. PHÍA HỌC SINH (client) ----------------------------------------------

test("ô nhập mã của học sinh: gõ kiểu nào cũng ra đúng dạng server hiểu", async function () {
	var classCodeClient = await loadClientModule("systems/classCode.ts");

	assert.equal(classCodeClient.normalizeClassCodeInput("abcd-2345"), "ABCD2345");
	assert.equal(classCodeClient.normalizeClassCodeInput("abcd 2345"), "ABCD2345");
	assert.equal(classCodeClient.normalizeClassCodeInput("ABCD2345XYZ"), "ABCD2345", "cắt ở 8 ký tự, không cho gõ tràn");
	assert.equal(classCodeClient.formatClassCodeInput("abcd2"), "ABCD-2");
	assert.equal(classCodeClient.formatClassCodeInput("ab"), "AB", "chưa đủ 4 ký tự thì chưa chèn gạch");
	assert.equal(classCodeClient.isCompleteClassCode("abcd-2345"), true);
	assert.equal(classCodeClient.isCompleteClassCode("abcd-23"), false);

	// Client CHỈ kiểm độ dài, không chép bảng chữ của server xuống: hai bản trôi
	// khỏi nhau là client chặn oan đúng những mã server nhận.
	assert.equal(classCodeClient.isCompleteClassCode("IIII-OOOO"), true);
});

test("mọi lý do bị từ chối đều có câu tiếng Việt cho trẻ con đọc", async function () {
	var classCodeClient = await loadClientModule("systems/classCode.ts");

	["invalid", "not-found", "expired", "revoked", "disabled", "network", "cai-gi-do"].forEach(function (reason) {
		var message = classCodeClient.describeJoinFailure(reason);

		assert.ok(message.length > 10, "lý do " + reason + " chưa có câu trả lời tử tế");
		assert.equal(/error|fail|invalid|404/i.test(message), false, "không được lộ mã lỗi kỹ thuật cho học sinh");
	});

	assert.notEqual(
		classCodeClient.describeJoinFailure("expired"),
		classCodeClient.describeJoinFailure("not-found"),
		"hết hạn và gõ sai là hai việc khác nhau — nói chung một câu là bắt em gõ lại vô ích"
	);
});

test("client KHÔNG thêm khoá localStorage mới cho lớp học, chỉ đệm tên lớp", function () {
	var membership = stripComments(fs.readFileSync(
		path.join(rootDir, "client", "src", "systems", "ClassMembership.ts"),
		"utf8"
	));

	assert.equal(/writeJson|writeRaw|localStorage/.test(membership), false, "phải đi qua SaveData, không tự ghi thẳng");
	assert.ok(/classLabel/.test(membership));

	var keys = fs.readFileSync(path.join(rootDir, "client", "src", "core", "storageKeys.ts"), "utf8");
	assert.equal(/class/i.test(keys), false, "P2-5 không được thêm khoá localStorage nào");
});

test("lỗi kiểm tra đầu vào là REJECT chứ không throw đồng bộ", async function () {
	await makeRuntime();

	await assert.rejects(function () {
		return sharedStore.createClass("admin", { label: "   " });
	}, /Tên lớp/);

	await assert.rejects(function () {
		return sharedStore.createClass("admin", { label: "Lớp 6A", level: "lop99" });
	});

	await assert.rejects(function () {
		return sharedStore.joinByCode("", { code: "ABCD2345" });
	}, /deviceId/);
});
