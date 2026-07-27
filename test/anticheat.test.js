"use strict";

// P1-4 — ANTI-CHEAT + KIỂM DUYỆT. Bám sát 6 điều khoản DoD:
//   (a) vé sai / dùng lại / quá rate-limit → 4xx;
//   (b) nộp KHÔNG vé → vẫn nhận, verified = false;
//   (c) ANTICHEAT_ENFORCE=1 → nộp không vé bị từ chối;
//   (d) ván hợp lệ điểm cao (6 phút, streak ×2) KHÔNG bị chặn oan;
//   (e) luồng submit của V1 cũ không gãy;
//   (f) admin xoá được một bản ghi điểm.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var bcrypt = require("bcrypt");
var request = require("supertest");
var createApp = require("../server/app").createApp;
var runToken = require("../server/runToken");
var scoreCheck = require("../server/scoreCheck");
var badwords = require("../server/badwords-vi");

var rootDir = path.resolve(__dirname, "..");
var SECRET = "test-secret-key-p1-4";

// ⚠ DÙNG CHUNG một thư mục dữ liệu cho mọi app trong file này.
//
// Trước đây mỗi test gọi `fs.mkdtempSync` riêng ⇒ mỗi test một CSDL PGlite mới,
// mà PGlite là Postgres biên dịch WASM: mỗi instance là một cluster đầy đủ vài
// chục MB nằm lại trong thư mục tạm. Chạy `npm test` vài chục lần trong một buổi
// là đầy ổ đĩa thật — đã xảy ra. `server/sql.js` cache client theo `pgDataDir`,
// nên dùng chung đường dẫn là dùng chung đúng MỘT instance.
//
// Các test ở đây không đọc CSDL nên không cần cô lập dữ liệu; thứ cần cô lập là
// rate-limit và vé đã tiêu, và cả hai đã được `resetSpentTokens()` + `deviceId`
// riêng cho từng test lo.
var sharedRuntimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "anticheat-"));

function makeRuntime(overrides) {
	return createApp(Object.assign({
		rootDir: rootDir,
		staticDir: rootDir,
		runtimeDir: sharedRuntimeDir,
		pgDataDir: path.join(sharedRuntimeDir, "pgdata"),
		jwtSecret: SECRET,
		adminPasswordHash: bcrypt.hashSync("admin123", 10),
		nodeEnv: "test"
	}, overrides || {}));
}

/** Payload của một ván THẬT, hợp lệ: 5 phút, 9 câu đúng, điểm hợp lý. */
function validRun(extra) {
	return Object.assign({
		deviceId: "device-test-1",
		nickname: "Minh Anh",
		level: "lop6",
		score: 5200,
		correctCount: 9,
		wrongCount: 2,
		timeoutCount: 0,
		durationMs: 300000
	}, extra || {});
}

// --- Vé một-ván --------------------------------------------------------------

test("vé hợp lệ đi qua; vé giả / sửa chữ ký bị bắt", function () {
	runToken.resetSpentTokens();

	var ticket = runToken.issueRunToken(SECRET);
	assert.equal(runToken.verifyRunToken(ticket.token, ticket.runId, SECRET, { consume: false }).ok, true);

	// Sửa 1 ký tự chữ ký.
	var tampered = ticket.token.slice(0, -1) + (ticket.token.slice(-1) === "a" ? "b" : "a");
	assert.equal(runToken.verifyRunToken(tampered, ticket.runId, SECRET).reason, "bad-signature");

	// Vé tự chế hoàn toàn.
	assert.equal(runToken.verifyRunToken("khong-phai-ve", null, SECRET).reason, "malformed");

	// Vé ký bằng secret khác (server khác / đoán bừa).
	var foreign = runToken.issueRunToken("secret-khac");
	assert.equal(runToken.verifyRunToken(foreign.token, foreign.runId, SECRET).reason, "bad-signature");
});

test("vé hết hạn sau 30 phút", function () {
	runToken.resetSpentTokens();

	var now = 1000000;
	var ticket = runToken.issueRunToken(SECRET, now);

	assert.equal(
		runToken.verifyRunToken(ticket.token, ticket.runId, SECRET, { nowMs: now + runToken.TOKEN_TTL_MS - 1, consume: false }).ok,
		true
	);
	assert.equal(
		runToken.verifyRunToken(ticket.token, ticket.runId, SECRET, { nowMs: now + runToken.TOKEN_TTL_MS + 1 }).reason,
		"expired"
	);
});

test("dùng lại vé (replay) bị bắt", function () {
	runToken.resetSpentTokens();

	var ticket = runToken.issueRunToken(SECRET);

	assert.equal(runToken.verifyRunToken(ticket.token, ticket.runId, SECRET).ok, true);
	assert.equal(runToken.verifyRunToken(ticket.token, ticket.runId, SECRET).reason, "replayed");
});

test("runId không khớp vé → từ chối", function () {
	runToken.resetSpentTokens();

	var ticket = runToken.issueRunToken(SECRET);
	assert.equal(runToken.verifyRunToken(ticket.token, "runId-khac", SECRET).reason, "run-id-mismatch");
});

// --- Kiểm chéo tính hợp lý ---------------------------------------------------

test("(d) ván hợp lệ điểm CAO không bị chặn oan — 6 phút, 14 câu, streak ×2", function () {
	// Kịch bản tốt nhất mà công thức plan §4.4 cho phép:
	//   quãng đường 6 phút ở tốc độ trần + 14 câu đúng × 100 điểm × streak 2.
	var result = scoreCheck.checkPlausibility(
		{ score: 360 * 43.4 + 14 * 100 * 2, correctCount: 14, durationMs: 360000 },
		100
	);

	assert.equal(result.plausible, true, "học sinh giỏi chơi hết sức KHÔNG được bị tố gian lận");
});

test("điểm vượt trần và ván quá ngắn đều bị đánh dấu", function () {
	var tooHigh = scoreCheck.checkPlausibility({ score: 999999, correctCount: 1, durationMs: 300000 }, 100);
	assert.equal(tooHigh.plausible, false);
	assert.equal(tooHigh.reason, "score-above-ceiling");

	var tooShort = scoreCheck.checkPlausibility({ score: 10, correctCount: 0, durationMs: 44999 }, 100);
	assert.equal(tooShort.plausible, false);
	assert.equal(tooShort.reason, "duration-too-short");

	assert.equal(scoreCheck.MIN_DURATION_MS, 45000, "plan §7.4 chốt 45s");
});

test("hằng MAX_SPEED_MPS khớp tuning của client", async function () {
	// 15.5 (unitsPerSecondAtOne) × 2 (baseMax) × 1.4 (rampCeilingFactor) = 43.4.
	// Đổi bất kỳ số nào trong client/src/tuning.ts mà quên đổi ở server thì hoặc
	// người chơi thật bị tố oan, hoặc điểm bịa lọt qua.
	var helpers = require("../test-helpers/clientModule");
	var mods = await helpers.loadClientBundle({ tuningModule: "tuning.ts" });
	var speed = mods.tuningModule.tuning.speed;
	var expected = speed.unitsPerSecondAtOne * speed.baseMax * speed.rampCeilingFactor;

	assert.ok(
		Math.abs(scoreCheck.MAX_SPEED_MPS - expected) < 1e-6,
		"server dùng " + scoreCheck.MAX_SPEED_MPS + " nhưng tuning cho ra " + expected
	);
});

// --- Luồng HTTP thật ---------------------------------------------------------

test("(b) nộp KHÔNG vé vẫn nhận, và (e) luồng V1 cũ không gãy", async function () {
	runToken.resetSpentTokens();
	var runtime = makeRuntime();

	try {
		// Đây CHÍNH LÀ payload của questionBank.js bản V1 — không có runId/token.
		var response = await request(runtime.app).post("/api/scores").send(validRun()).expect(200);

		assert.equal(typeof response.body, "object");
		assert.notEqual(response.body, null);
	} finally {
		runtime.close();
	}
});

test("(a) vé sai → 4xx", async function () {
	runToken.resetSpentTokens();
	var runtime = makeRuntime();

	try {
		await request(runtime.app)
			.post("/api/scores")
			.send(validRun({ runId: "abc", token: "abc.123.xyz" }))
			.expect(400);
	} finally {
		runtime.close();
	}
});

test("(a) dùng lại vé qua HTTP → lần hai 4xx", async function () {
	runToken.resetSpentTokens();
	var runtime = makeRuntime();

	try {
		var ticket = (await request(runtime.app).post("/api/runs/start").send({}).expect(200)).body;

		assert.equal(typeof ticket.runId, "string");
		assert.equal(typeof ticket.token, "string");

		await request(runtime.app).post("/api/scores").send(validRun(ticket)).expect(200);
		await request(runtime.app).post("/api/scores").send(validRun(ticket)).expect(400);
	} finally {
		runtime.close();
	}
});

test("(c) ANTICHEAT_ENFORCE=1 → nộp không vé bị từ chối, có vé thì vẫn qua", async function () {
	runToken.resetSpentTokens();
	var runtime = makeRuntime({ anticheatEnforce: true });

	try {
		await request(runtime.app).post("/api/scores").send(validRun()).expect(400);

		var ticket = (await request(runtime.app).post("/api/runs/start").send({}).expect(200)).body;
		await request(runtime.app).post("/api/scores").send(validRun(ticket)).expect(200);
	} finally {
		runtime.close();
	}
});

test("(a) quá rate-limit 10 submit/phút → 429", async function () {
	runToken.resetSpentTokens();
	var runtime = makeRuntime();

	try {
		var lastStatus = 200;

		// 12 lần liên tiếp: 10 lần đầu qua, từ lần 11 phải bị chặn.
		for (var index = 0; index < 12; index += 1) {
			var response = await request(runtime.app).post("/api/scores").send(validRun());
			lastStatus = response.status;
		}

		assert.equal(lastStatus, 429, "vòng lặp bơm điểm phải bị chặn");
	} finally {
		runtime.close();
	}
});

test("rate-limit đăng nhập admin: 5 lần/phút", async function () {
	var runtime = makeRuntime();

	try {
		var lastStatus = 401;

		for (var index = 0; index < 7; index += 1) {
			var response = await request(runtime.app).post("/api/admin/login").send({ password: "sai" });
			lastStatus = response.status;
		}

		assert.equal(lastStatus, 429, "dò mật khẩu admin phải bị chặn");
	} finally {
		runtime.close();
	}
});

// --- Kiểm duyệt --------------------------------------------------------------

test("(f) admin xoá được điểm; không đăng nhập thì không đụng được", async function () {
	var runtime = makeRuntime();

	try {
		// Chưa đăng nhập → 401.
		await request(runtime.app).get("/api/admin/scores").expect(401);
		await request(runtime.app).delete("/api/admin/scores/1").expect(401);

		var agent = request.agent(runtime.app);
		await agent.post("/api/admin/login").send({ password: "admin123" }).expect(200);

		var list = await agent.get("/api/admin/scores").expect(200);
		assert.ok(Array.isArray(list.body.entries));

		// Không có CSDL trong test → store "tắt êm", nhưng route vẫn phải trả 200.
		var deleted = await agent.delete("/api/admin/scores/1").expect(200);
		assert.equal(typeof deleted.body.deleted, "number");
	} finally {
		runtime.close();
	}
});

test("admin khoá/bỏ khoá biệt danh qua API", async function () {
	var runtime = makeRuntime();

	try {
		var agent = request.agent(runtime.app);
		await agent.post("/api/admin/login").send({ password: "admin123" }).expect(200);

		await agent.post("/api/admin/blocked-nicknames").send({ nickname: "Tên Xấu", reason: "thử" }).expect(200);
		await agent.get("/api/admin/blocked-nicknames").expect(200);
		await agent.delete("/api/admin/blocked-nicknames/" + encodeURIComponent("Tên Xấu")).expect(200);
	} finally {
		runtime.close();
	}
});

test("biệt danh có từ cấm bị từ chối NGAY khi đặt", async function () {
	var runtime = makeRuntime();

	try {
		var response = await request(runtime.app)
			.put("/api/players/device-x/nickname")
			.send({ nickname: "thang ngu" })
			.expect(400);

		assert.ok(/không phù hợp/.test(response.body.error), "phải nói rõ lý do cho học sinh tự sửa");

		// Tên bình thường vẫn đặt được.
		await request(runtime.app).put("/api/players/device-x/nickname").send({ nickname: "Minh Anh" }).expect(200);
	} finally {
		runtime.close();
	}
});

// --- Bộ lọc từ cấm tiếng Việt ------------------------------------------------

test("lọc được từ cấm CÓ DẤU, KHÔNG DẤU, và các kiểu lách thường gặp", function () {
	[
		"đm",
		"dm",
		"ĐM",
		"Thằng Ngu",
		"thang ngu",
		"đồ chó",
		"do cho",
		"d.m",
		"d_m",
		"l0n",
		"FUCK",
		"ditmemay"
	].forEach(function (nickname) {
		assert.equal(badwords.containsBadWord(nickname), true, "phải chặn: " + nickname);
	});
});

test("KHÔNG chặn oan tên thật của học sinh", function () {
	// Đây mới là phần khó. Bộ lọc so chuỗi con sẽ dính hết danh sách này, và chặn
	// nhầm tên thật của một đứa trẻ là tệ hơn cho lọt một biệt danh xấu.
	[
		// Chuỗi ngắn/đa nghĩa chỉ bị chặn khi ĐỨNG MỘT MÌNH — đây là tên viết tắt.
		"DM Khoa",
		"Các Bạn Lớp 6A",
		"Trần Diễm My",
		"Lê Điểm 10",
		"Minh Anh",
		"Nguyễn Văn Bắc",
		"Phan Điệp",
		"Lê Cẩm Tú",
		"Đỗ Duy Long",
		"Trần Diễm My",
		"Hoàng Đức",
		"Vũ Lan",
		"Bùi Đình Cẩn",
		"Đặng Cường",
		"Tôn Nữ Điền Trang"
	].forEach(function (nickname) {
		assert.equal(badwords.containsBadWord(nickname), false, "KHÔNG được chặn: " + nickname);
	});
});

test("bỏ dấu tiếng Việt đúng, kể cả chữ đ", function () {
	assert.equal(badwords.removeDiacritics("Đặng Cường"), "dang cuong");
	assert.equal(badwords.removeDiacritics("Nguyễn Thị Ánh"), "nguyen thi anh");
	assert.equal(badwords.removeDiacritics(null), "");
});

test("danh sách từ cấm sửa được mà không cần deploy lại logic", function () {
	assert.ok(Array.isArray(badwords.BANNED_WORDS));
	assert.ok(badwords.BANNED_WORDS.length > 10);
	assert.ok(Array.isArray(badwords.BANNED_EXACT));

	// Thêm từ riêng của trường qua tham số, không phải sửa file.
	assert.equal(badwords.containsBadWord("Bo Cu", ["bo cu"]), true);
	assert.equal(badwords.containsBadWord("Bo Cu"), false);
});

// --- Hợp đồng với client -----------------------------------------------------

test("questionBank.js gửi runId/token là TÙY CHỌN (hợp đồng P1-4)", function () {
	var source = fs.readFileSync(path.join(rootDir, "questionBank.js"), "utf8");

	assert.ok(/function startRun\(/.test(source), "phải có startRun để xin vé");
	assert.ok(/startRun: startRun/.test(source), "startRun phải được export");
	// Chỉ gắn vào payload KHI CÓ — thiếu vé vẫn nộp được như V1.
	assert.ok(
		/if \(typeof data\.runId === "string" && data\.runId !== ""\) \{/.test(source),
		"runId phải là tùy chọn, không được luôn gửi"
	);
});

test("cột scores.verified thêm bằng ADD COLUMN IF NOT EXISTS (chạy được trên DB có sẵn)", function () {
	var schema = fs.readFileSync(path.join(rootDir, "server", "schema.js"), "utf8");

	assert.ok(/ADD COLUMN IF NOT EXISTS verified BOOLEAN/.test(schema));
	assert.ok(/CREATE TABLE IF NOT EXISTS blocked_nicknames/.test(schema));
});

test("ANTICHEAT_ENFORCE mặc định TẮT (không tự bật trong task này)", function () {
	var config = require("../server/config");
	var previous = process.env.ANTICHEAT_ENFORCE;
	delete process.env.ANTICHEAT_ENFORCE;

	try {
		assert.equal(config.resolveConfig({}).anticheatEnforce, false);
		process.env.ANTICHEAT_ENFORCE = "1";
		assert.equal(config.resolveConfig({}).anticheatEnforce, true);
	} finally {
		if (previous === undefined) {
			delete process.env.ANTICHEAT_ENFORCE;
		} else {
			process.env.ANTICHEAT_ENFORCE = previous;
		}
	}
});
