"use strict";

// P2-6 — NHẬP / XUẤT NGÂN HÀNG CÂU HỎI BẰNG EXCEL.
//
// Bốn thứ bắt buộc phải khoá lại, vì cả bốn đều hỏng ÂM THẦM:
//   1. vòng khứ hồi xuất → nhập KHÔNG được đổi một byte dữ liệu nào;
//   2. dấu tiếng Việt phải sống sót qua BOM/CRLF/bọc nháy;
//   3. file sai định dạng phải bị từ chối KÈM SỐ DÒNG (không nhập một nửa);
//   4. nhập KHÔNG được xoá ngầm câu không có trong file.
//
// Phần lớn test chạy trên một kho GIẢ trong bộ nhớ — luật nhập/ghép là logic
// thuần, và dựng Postgres để kiểm "câu này có bị xoá không" chỉ làm test chậm
// chứ không làm nó đúng hơn. Phần route chạy trên app THẬT (kho JSON, đúng 1.200
// câu của repo) để bắt những thứ chỉ lộ ra qua HTTP: cookie admin, header
// charset, và vòng khứ hồi trên dữ liệu thật.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var bcrypt = require("bcrypt");
var request = require("supertest");
var QuestionModel = require("../shared/questionModel");
var questionImport = require("../server/questionImport");
var createApp = require("../server/app").createApp;

var rootDir = path.resolve(__dirname, "..");

// MỘT thư mục tạm cho CẢ FILE (và do đó một PGlite duy nhất).
//
// Không `mkdtempSync` trong từng test: mỗi instance PGlite là một cluster Postgres
// vài chục MB, và cách làm kia đã từng làm ĐẦY Ổ ĐĨA 25 GB (docs/v2/P1-ACCEPTANCE §3).
var sharedRuntimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "question-import-"));
var sharedConfig = {
	rootDir: rootDir,
	staticDir: rootDir,
	runtimeDir: sharedRuntimeDir,
	pgDataDir: path.join(sharedRuntimeDir, "pgdata"),
	// ⚠ ĐẶT RÕ RỖNG. `resolveConfig` ngã về `process.env.DATABASE_URL` khi thiếu —
	// và một biến môi trường lạc vào lúc chạy test nghĩa là test ghi thẳng vào CSDL
	// production. Ở đây kho câu hỏi là kho JSON trong thư mục tạm, không đâu khác.
	databaseUrl: "",
	jwtSecret: "test-secret-key-p2-6",
	adminPasswordHash: bcrypt.hashSync("admin123", 10),
	nodeEnv: "test"
};

var sharedRuntime = createApp(sharedConfig);

// Đăng nhập MỘT lần cho cả file: `loginLimiter` đếm 5 lần/phút THEO IP (đúng như
// vậy — chống dò mật khẩu thì phải theo IP), nên mỗi test tự đăng nhập lại sẽ tự
// đâm vào 429 của chính mình.
var adminAgentPromise = null;

function loginAdmin() {
	if (adminAgentPromise === null) {
		adminAgentPromise = (async function () {
			var agent = request.agent(sharedRuntime.app);
			await agent.post("/api/admin/login").send({ password: "admin123" }).expect(200);
			return agent;
		})();
	}

	return adminAgentPromise;
}

// --- Đồ dùng chung ----------------------------------------------------------

function sampleQuestion(id, extra) {
	return Object.assign({
		id: id,
		difficulty: "easy",
		question: "Câu " + id + ": 1 + 1 = ?",
		answers: { A: "2", B: "3" },
		correctAnswer: "A",
		point: 10,
		time: 12
	}, extra || {});
}

/** Kho giả trong bộ nhớ — cùng giao diện với `server/db.js` và `questionStore.js`. */
function makeFakeStore(initial) {
	var state = {};
	var writes = [];

	QuestionModel.LEVELS.forEach(function (level) {
		state[level] = [];
	});

	Object.keys(initial || {}).forEach(function (level) {
		state[level] = QuestionModel.validateQuestionsData(initial[level], level);
	});

	return {
		writes: writes,
		count: function (level) {
			return state[level].length;
		},
		ids: function (level) {
			return state[level].map(function (question) {
				return question.id;
			});
		},
		find: function (level, id) {
			return state[level].filter(function (question) {
				return question.id === id;
			})[0];
		},
		getLevelBundle: function (level) {
			QuestionModel.assertLevel(level);
			return Promise.resolve({
				questions: QuestionModel.cloneData(state[level]),
				pointSettings: {},
				timeSettings: {},
				gameSpeed: 1,
				quizMode: "gate"
			});
		},
		replaceQuestionsForLevel: function (level, questions) {
			QuestionModel.assertLevel(level);
			state[level] = QuestionModel.validateQuestionsData(questions, "Questions for " + level);
			writes.push(level);
			return Promise.resolve({ questions: state[level] });
		}
	};
}

/** Dựng CSV thô để mô phỏng file giáo viên (kể cả file hỏng). */
function buildCsv(options) {
	var settings = options || {};
	var delimiter = settings.delimiter || ",";
	var lines = [];

	if (settings.sep !== false) {
		lines.push("sep=" + delimiter);
	}

	lines.push((settings.header || questionImport.COLUMNS.map(function (column) {
		return column.title;
	})).join(delimiter));

	(settings.rows || []).forEach(function (row) {
		lines.push(Array.isArray(row) ? row.join(delimiter) : row);
	});

	return (settings.bom === false ? "" : "﻿") + lines.join("\r\n") + "\r\n";
}

function rowOf(level, question) {
	var answers = question.answers || {};

	return [
		level,
		question.id,
		question.difficulty,
		question.question,
		answers.A || "",
		answers.B || "",
		answers.C || "",
		answers.D || "",
		question.correctAnswer,
		question.point,
		question.time,
		question.explanation || ""
	];
}

// --- 1. XUẤT: công thức Excel + tiếng Việt ----------------------------------

test("xuất CSV có BOM UTF-8, chỉ thị sep=, và xuống dòng CRLF", function () {
	var csv = questionImport.questionsToCsv([{ level: "lop6", questions: [sampleQuestion("6q1")] }]);

	// BOM là thứ duy nhất đứng giữa "Excel Windows đọc đúng" và "vỡ hết dấu".
	assert.equal(csv.charCodeAt(0), 0xFEFF);
	assert.equal(csv.slice(1).split("\r\n")[0], "sep=,");
	assert.ok(csv.indexOf("\r\n") !== -1, "phải dùng CRLF");
	assert.equal(csv.split("\n").length - 1, csv.split("\r\n").length - 1, "không được có \\n đơn lẻ");
});

test("xuất CSV: dòng tiêu đề đúng 12 cột theo schema hiện có (không đổi schema)", function () {
	var csv = questionImport.questionsToCsv([]);
	var header = csv.slice(1).split("\r\n")[1];

	assert.equal(
		header,
		"Lớp,Mã câu hỏi,Loại,Nội dung câu hỏi,Đáp án A,Đáp án B,Đáp án C,Đáp án D,Đáp án đúng,Điểm,Thời gian (giây),Lời giải"
	);
});

test("ô có dấu phẩy / chấm phẩy / nháy kép / xuống dòng đều được bọc đúng", function () {
	var tricky = sampleQuestion("6q9", {
		question: 'Điểm M(1; 2), N(3, 4) và dấu "kép" — chọn đáp án đúng?',
		explanation: "Dòng một\nDòng hai",
		answers: { A: "M(1; 2)", B: "N(3, 4)" }
	});

	var csv = questionImport.questionsToCsv([{ level: "lop7", questions: [tricky] }]);
	var parsed = questionImport.parseQuestionCsv(csv);

	assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
	assert.equal(parsed.rows.length, 1);
	assert.equal(parsed.rows[0].question.question, tricky.question);
	assert.equal(parsed.rows[0].question.explanation, tricky.explanation);
	assert.equal(parsed.rows[0].question.answers.A, "M(1; 2)");
});

test("chữ có dấu tiếng Việt sống sót nguyên vẹn qua vòng xuất → nhập", function () {
	var vietnamese = sampleQuestion("7q42", {
		difficulty: "hard",
		question: "Tổng ba góc trong một tam giác bằng bao nhiêu độ? Đường trung trực đi qua đâu?",
		answers: { A: "180°", B: "90°", C: "270°", D: "360°" },
		correctAnswer: "A",
		explanation: "Áp dụng định lí tổng ba góc: 180°. Ghi nhớ kĩ để làm bài kiểm tra giữa kì."
	});

	var csv = questionImport.questionsToCsv([{ level: "lop7", questions: [vietnamese] }]);
	var parsed = questionImport.parseQuestionCsv(csv);

	assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));

	var back = parsed.rows[0].question;

	assert.equal(parsed.rows[0].level, "lop7");
	assert.equal(back.question, vietnamese.question);
	assert.equal(back.explanation, vietnamese.explanation);
	assert.deepEqual(back.answers, vietnamese.answers);
	assert.equal(back.difficulty, "hard");
});

// --- 2. NHẬP: đọc file ------------------------------------------------------

test("tự dò dấu phân cách ; — đúng cách Excel tiếng Việt lưu lại file", function () {
	// Windows tiếng Việt đặt "List separator" là `;`, nên file giáo viên lưu lại từ
	// Excel về tay ta ở dạng này chứ không phải dạng ta đã xuất ra.
	var csv = buildCsv({
		sep: false,
		delimiter: ";",
		rows: [rowOf("lop6", sampleQuestion("6q1", { question: "Tính 2 + 3, rồi so sánh với 4" }))]
	});

	var parsed = questionImport.parseQuestionCsv(csv);

	assert.equal(parsed.delimiter, ";");
	assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
	// Dấu phẩy trong nội dung KHÔNG được hiểu là dấu phân cách.
	assert.equal(parsed.rows[0].question.question, "Tính 2 + 3, rồi so sánh với 4");
});

test("file phân cách ; vẫn đọc đúng ô có chứa ; (được bọc nháy)", function () {
	var csv = buildCsv({
		sep: false,
		delimiter: ";",
		rows: [rowOf("lop8", sampleQuestion("8q1", { question: '"Điểm M(1; 2) nằm trên đồ thị nào?"' }))]
	});

	var parsed = questionImport.parseQuestionCsv(csv);

	assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
	assert.equal(parsed.rows[0].question.question, "Điểm M(1; 2) nằm trên đồ thị nào?");
});

test("thứ tự cột tự do và tên cột không dấu vẫn nhận", function () {
	var csv = buildCsv({
		sep: false,
		header: ["ma cau hoi", "LOP", "Noi dung cau hoi", "a", "B", "Dap an C", "d", "dap an dung", "Diem", "thoi gian", "loai", "loi giai"],
		rows: [["6q77", "Lớp 6", "2 + 2 = ?", "4", "5", "", "", "A", "10", "12", "easy", ""]]
	});

	var parsed = questionImport.parseQuestionCsv(csv);

	assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
	assert.equal(parsed.rows[0].level, "lop6");
	assert.equal(parsed.rows[0].question.id, "6q77");
	assert.equal(parsed.rows[0].question.correctAnswer, "A");
});

test('cột "Lớp" nhận cả lop6, "Lớp 6" và 6', function () {
	["lop6", "Lớp 6", "6", "LOP6"].forEach(function (label) {
		var csv = buildCsv({ sep: false, rows: [rowOf(label, sampleQuestion("6q1"))] });
		var parsed = questionImport.parseQuestionCsv(csv);

		assert.equal(parsed.ok, true, label + ": " + JSON.stringify(parsed.errors));
		assert.equal(parsed.rows[0].level, "lop6", label);
	});
});

test("số thập phân kiểu Excel tiếng Việt (10,5) được hiểu đúng", function () {
	var csv = buildCsv({
		sep: false,
		delimiter: ";",
		rows: [rowOf("lop6", sampleQuestion("6q1", { point: "10,5" }))]
	});

	var parsed = questionImport.parseQuestionCsv(csv);

	assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
	assert.equal(parsed.rows[0].question.point, 10.5);
});

// --- 3. NHẬP: từ chối file sai, KÈM SỐ DÒNG ---------------------------------

test("dòng sai bị từ chối kèm ĐÚNG số dòng trong file và số dòng Excel", function () {
	var csv = buildCsv({
		rows: [
			rowOf("lop6", sampleQuestion("6q1")),
			rowOf("lop6", sampleQuestion("6q2", { correctAnswer: "D" })),
			rowOf("lop6", sampleQuestion("6q3"))
		]
	});

	var parsed = questionImport.parseQuestionCsv(csv);

	assert.equal(parsed.ok, false);
	assert.equal(parsed.errors.length, 1);
	// dòng 1 = sep=, · dòng 2 = tiêu đề · dòng 3 = câu đầu · dòng 4 = câu hỏng.
	assert.equal(parsed.errors[0].line, 4);
	// Excel NUỐT dòng `sep=,` nên trên màn hình nó là dòng 3.
	assert.equal(parsed.errors[0].excelRow, 3);
	assert.match(parsed.errors[0].message, /Đáp án đúng/);
});

test("file KHÔNG có sep=, thì số dòng file và số dòng Excel trùng nhau", function () {
	var csv = buildCsv({
		sep: false,
		rows: [rowOf("lop6", sampleQuestion("6q1")), rowOf("lop6", sampleQuestion("6q2", { question: "" }))]
	});

	var parsed = questionImport.parseQuestionCsv(csv);

	assert.equal(parsed.ok, false);
	assert.equal(parsed.errors[0].line, 3);
	assert.equal(parsed.errors[0].excelRow, 3);
});

test("ô có xuống dòng bên trong KHÔNG làm lệch số dòng của các lỗi phía sau", function () {
	var csv = buildCsv({
		sep: false,
		rows: [
			rowOf("lop6", sampleQuestion("6q1", { explanation: "Dòng một\r\nDòng hai\r\nDòng ba" }))
				.map(function (cell) {
					return /[\r\n,]/.test(String(cell)) ? '"' + String(cell).replace(/"/g, '""') + '"' : cell;
				}),
			rowOf("lop6", sampleQuestion("6q2", { time: "abc" }))
		]
	});

	var parsed = questionImport.parseQuestionCsv(csv);

	assert.equal(parsed.ok, false);
	// tiêu đề dòng 1; câu đầu chiếm dòng 2–4; câu hỏng bắt đầu ở dòng 5.
	assert.equal(parsed.errors[0].line, 5);
	assert.match(parsed.errors[0].message, /Thời gian/);
});

test("mọi lỗi thường gặp đều báo bằng TIẾNG VIỆT kèm mã câu", function () {
	var cases = [
		{ row: rowOf("lop9", sampleQuestion("9q1")), pattern: /Cột "Lớp"/ },
		{ row: rowOf("lop6", sampleQuestion("", {})), pattern: /Thiếu "Mã câu hỏi"/ },
		{ row: rowOf("lop6", sampleQuestion("6q1", { question: "" })), pattern: /thiếu "Nội dung câu hỏi"/ },
		{ row: rowOf("lop6", sampleQuestion("6q1", { answers: { A: "2" } })), pattern: /ít nhất 2 đáp án/ },
		{ row: rowOf("lop6", sampleQuestion("6q1", { answers: { A: "2", C: "4" } })), pattern: /điền lần lượt từ A/ },
		{ row: rowOf("lop6", sampleQuestion("6q1", { correctAnswer: "C" })), pattern: /"Đáp án đúng"/ },
		{ row: rowOf("lop6", sampleQuestion("6q1", { point: "mười" })), pattern: /"Điểm" phải là số không âm/ },
		{ row: rowOf("lop6", sampleQuestion("6q1", { point: -5 })), pattern: /"Điểm" phải là số không âm/ },
		{ row: rowOf("lop6", sampleQuestion("6q1", { time: 0 })), pattern: /số nguyên từ 1/ },
		{ row: rowOf("lop6", sampleQuestion("6q1", { time: 12.5 })), pattern: /số nguyên từ 1/ },
		{ row: rowOf("lop6", sampleQuestion("6q1", { explanation: "x".repeat(501) })), pattern: /"Lời giải" dài 501 ký tự/ }
	];

	cases.forEach(function (item) {
		var parsed = questionImport.parseQuestionCsv(buildCsv({ sep: false, rows: [item.row] }));

		assert.equal(parsed.ok, false, JSON.stringify(item.row));
		assert.match(parsed.errors[0].message, item.pattern);
		// Thông điệp tiếng Anh của `questionModel` KHÔNG được lộ ra với các lỗi
		// thường gặp — nó chỉ là lưới cuối cùng, không phải giao diện người dùng.
		assert.doesNotMatch(parsed.errors[0].message, /Question|must|invalid/);
	});
});

test("mã câu hỏi trùng trong cùng một lớp bị từ chối và chỉ ra dòng trùng", function () {
	var csv = buildCsv({
		sep: false,
		rows: [rowOf("lop6", sampleQuestion("6q1")), rowOf("lop6", sampleQuestion("6q1", { question: "Khác" }))]
	});

	var parsed = questionImport.parseQuestionCsv(csv);

	assert.equal(parsed.ok, false);
	assert.equal(parsed.errors[0].line, 3);
	assert.match(parsed.errors[0].message, /trùng với dòng 2/);
});

test("cùng một mã ở HAI lớp khác nhau là hợp lệ", function () {
	var csv = buildCsv({
		sep: false,
		rows: [rowOf("lop6", sampleQuestion("q1")), rowOf("lop7", sampleQuestion("q1"))]
	});

	assert.equal(questionImport.parseQuestionCsv(csv).ok, true);
});

test("thiếu cột bắt buộc bị từ chối, nói rõ thiếu cột nào, ở dòng tiêu đề", function () {
	var csv = buildCsv({
		sep: false,
		header: ["Lớp", "Mã câu hỏi", "Nội dung câu hỏi", "Đáp án A", "Đáp án B"],
		rows: [["lop6", "6q1", "1 + 1 = ?", "2", "3"]]
	});

	var parsed = questionImport.parseQuestionCsv(csv);

	assert.equal(parsed.ok, false);
	assert.equal(parsed.errors[0].line, 1);
	assert.match(parsed.errors[0].message, /"Đáp án đúng"/);
	assert.match(parsed.errors[0].message, /"Điểm"/);
	assert.match(parsed.errors[0].message, /đủ 12 cột/);
});

test("file rỗng / chỉ có tiêu đề / không phải UTF-8 đều bị từ chối rõ ràng", function () {
	assert.match(questionImport.parseQuestionCsv("").errors[0].message, /File rỗng/);
	assert.match(questionImport.parseQuestionCsv("   \r\n").errors[0].message, /File rỗng/);
	assert.match(
		questionImport.parseQuestionCsv(buildCsv({ sep: false, rows: [] })).errors[0].message,
		/chỉ có dòng tiêu đề/
	);
	// U+FFFD = byte không giải mã được bằng UTF-8 ⇒ Excel đã lưu bằng "CSV" (ANSI)
	// thay vì "CSV UTF-8". Không đoán, không đọc bừa — nói thẳng cách sửa.
	assert.match(
		questionImport.parseQuestionCsv(buildCsv({ sep: false, rows: [["lop6", "6q1", "easy", "C�u h�i", "2", "3", "", "", "A", "10", "12", ""]] })).errors[0].message,
		/CSV UTF-8/
	);
});

test("số lỗi báo về được chặn ở 50 dòng — không dội 1.200 dòng lỗi vào màn hình", function () {
	var rows = [];

	for (var index = 0; index < 60; index += 1) {
		rows.push(rowOf("lop6", sampleQuestion("6q" + index, { time: "sai" })));
	}

	var parsed = questionImport.parseQuestionCsv(buildCsv({ sep: false, rows: rows }));

	assert.equal(parsed.ok, false);
	assert.equal(parsed.errors.length, questionImport.MAX_REPORTED_ERRORS);
});

test("SAI MỘT DÒNG LÀ TỪ CHỐI CẢ FILE — không nhập được nửa vời", async function () {
	var store = makeFakeStore({ lop6: [sampleQuestion("6q1")] });
	var csv = buildCsv({
		sep: false,
		rows: [
			rowOf("lop6", sampleQuestion("6q2")),
			rowOf("lop6", sampleQuestion("6q3", { correctAnswer: "Z" }))
		]
	});

	var preview = await questionImport.previewImport(store, csv, { mode: "merge" });

	assert.equal(preview.ok, false);
	assert.equal(preview.errors.length, 1);

	var applied = await questionImport.applyImport(store, csv, { mode: "merge", digest: "bất kỳ" });

	assert.equal(applied.ok, false);
	assert.equal(store.writes.length, 0, "không được ghi gì khi file có lỗi");
	assert.equal(store.count("lop6"), 1);
});

// --- 4. KHÔNG XOÁ NGẦM ------------------------------------------------------

test("merge (mặc định): câu KHÔNG có trong file được GIỮ NGUYÊN", async function () {
	var store = makeFakeStore({
		lop6: [sampleQuestion("6q1"), sampleQuestion("6q2"), sampleQuestion("6q3")]
	});

	var csv = buildCsv({
		sep: false,
		rows: [rowOf("lop6", sampleQuestion("6q2", { question: "Nội dung đã sửa" }))]
	});

	var preview = await questionImport.previewImport(store, csv, {});

	assert.equal(preview.ok, true);
	assert.equal(preview.mode, "merge");
	assert.equal(preview.totals.added, 0);
	assert.equal(preview.totals.updated, 1);
	assert.equal(preview.totals.removed, 0, "merge KHÔNG BAO GIỜ được xoá");
	assert.equal(preview.levels[0].resultCount, 3);

	var applied = await questionImport.applyImport(store, csv, { mode: "merge", digest: preview.digest });

	assert.equal(applied.ok, true);
	assert.deepEqual(store.ids("lop6"), ["6q1", "6q2", "6q3"]);
	assert.equal(store.find("lop6", "6q2").question, "Nội dung đã sửa");
	assert.equal(store.find("lop6", "6q1").question, "Câu 6q1: 1 + 1 = ?");
});

test("merge: câu mới được nối vào CUỐI, thứ tự câu cũ không đổi", async function () {
	var store = makeFakeStore({ lop6: [sampleQuestion("6q1"), sampleQuestion("6q2")] });
	var csv = buildCsv({ sep: false, rows: [rowOf("lop6", sampleQuestion("6q99"))] });
	var preview = await questionImport.previewImport(store, csv, { mode: "merge" });

	assert.equal(preview.totals.added, 1);
	assert.equal(preview.levels[0].added[0].id, "6q99");

	await questionImport.applyImport(store, csv, { mode: "merge", digest: preview.digest });

	assert.deepEqual(store.ids("lop6"), ["6q1", "6q2", "6q99"]);
});

test("replace: CHỈ xoá khi người dùng chọn rõ, và chỉ trong lớp có mặt trong file", async function () {
	var store = makeFakeStore({
		lop6: [sampleQuestion("6q1"), sampleQuestion("6q2"), sampleQuestion("6q3")],
		lop7: [sampleQuestion("7q1"), sampleQuestion("7q2")]
	});

	var csv = buildCsv({ sep: false, rows: [rowOf("lop6", sampleQuestion("6q2"))] });
	var preview = await questionImport.previewImport(store, csv, { mode: "replace" });

	assert.equal(preview.mode, "replace");
	assert.deepEqual(preview.levels[0].removed, ["6q1", "6q3"]);
	assert.deepEqual(preview.untouchedLevels, ["lop7", "lop8"]);

	await questionImport.applyImport(store, csv, { mode: "replace", digest: preview.digest });

	assert.deepEqual(store.ids("lop6"), ["6q2"]);
	// Lớp 7 KHÔNG có trong file ⇒ không bị đụng tới, dù đang ở chế độ xoá.
	assert.deepEqual(store.ids("lop7"), ["7q1", "7q2"]);
	assert.deepEqual(store.writes, ["lop6"]);
});

test("chế độ lạ bị từ chối thay vì im lặng ngã về merge", async function () {
	var store = makeFakeStore({ lop6: [sampleQuestion("6q1")] });

	await assert.rejects(
		questionImport.previewImport(store, buildCsv({ sep: false, rows: [rowOf("lop6", sampleQuestion("6q1"))] }), { mode: "xoa-het" }),
		/merge.*replace/
	);
});

// --- 5. XEM TRƯỚC RỒI MỚI XÁC NHẬN ------------------------------------------

test("xem trước KHÔNG ghi một byte nào", async function () {
	var store = makeFakeStore({ lop6: [sampleQuestion("6q1")] });
	var csv = buildCsv({ sep: false, rows: [rowOf("lop6", sampleQuestion("6q2"))] });

	await questionImport.previewImport(store, csv, { mode: "replace" });

	assert.equal(store.writes.length, 0);
	assert.deepEqual(store.ids("lop6"), ["6q1"]);
});

test("xem trước liệt kê rõ thêm/sửa/xoá/giữ nguyên và ĐỔI NHỮNG TRƯỜNG NÀO", async function () {
	var store = makeFakeStore({
		lop6: [sampleQuestion("6q1"), sampleQuestion("6q2"), sampleQuestion("6q3")]
	});

	var csv = buildCsv({
		sep: false,
		rows: [
			rowOf("lop6", sampleQuestion("6q1")),
			rowOf("lop6", sampleQuestion("6q2", { point: 25, explanation: "Lời giải mới" })),
			rowOf("lop6", sampleQuestion("6q4"))
		]
	});

	var preview = await questionImport.previewImport(store, csv, { mode: "replace" });

	assert.equal(preview.totals.unchanged, 1);
	assert.equal(preview.totals.updated, 1);
	assert.equal(preview.totals.added, 1);
	assert.equal(preview.totals.removed, 1);
	assert.deepEqual(preview.levels[0].updated[0].changes, ["Điểm", "Lời giải"]);
	assert.equal(preview.levels[0].updated[0].excelRow, 3);
	assert.equal(preview.levels[0].currentCount, 3);
	assert.equal(preview.levels[0].resultCount, 3);
});

test("xác nhận KHÔNG kèm mã xác nhận bị từ chối", async function () {
	var store = makeFakeStore({ lop6: [sampleQuestion("6q1")] });
	var csv = buildCsv({ sep: false, rows: [rowOf("lop6", sampleQuestion("6q2"))] });
	var result = await questionImport.applyImport(store, csv, { mode: "merge" });

	assert.equal(result.ok, false);
	assert.equal(result.reason, "missing-digest");
	assert.equal(store.writes.length, 0);
});

test("ngân hàng đổi giữa lúc xem trước và lúc xác nhận ⇒ TỪ CHỐI, không đè lên việc người khác", async function () {
	var store = makeFakeStore({ lop6: [sampleQuestion("6q1")] });
	var csv = buildCsv({ sep: false, rows: [rowOf("lop6", sampleQuestion("6q2"))] });
	var preview = await questionImport.previewImport(store, csv, { mode: "merge" });

	// Một giáo viên khác thêm câu ở tab bên cạnh.
	await store.replaceQuestionsForLevel("lop6", [sampleQuestion("6q1"), sampleQuestion("6q9")]);

	var result = await questionImport.applyImport(store, csv, { mode: "merge", digest: preview.digest });

	assert.equal(result.ok, false);
	assert.equal(result.reason, "stale-preview");
	assert.deepEqual(store.ids("lop6"), ["6q1", "6q9"], "việc của người kia còn nguyên");
});

test("mã xác nhận phụ thuộc chế độ nhập — digest của merge không dùng cho replace được", async function () {
	var store = makeFakeStore({ lop6: [sampleQuestion("6q1"), sampleQuestion("6q2")] });
	var csv = buildCsv({ sep: false, rows: [rowOf("lop6", sampleQuestion("6q1"))] });
	var mergePreview = await questionImport.previewImport(store, csv, { mode: "merge" });
	var result = await questionImport.applyImport(store, csv, { mode: "replace", digest: mergePreview.digest });

	assert.equal(result.ok, false);
	assert.equal(result.reason, "stale-preview");
	assert.equal(store.writes.length, 0);
});

// --- 6. VÒNG KHỨ HỒI TRÊN KHO GIẢ -------------------------------------------

test("xuất → nhập lại NGAY: không thêm, không sửa, không xoá", async function () {
	var questions = [
		sampleQuestion("6q1"),
		sampleQuestion("6q2", { difficulty: "medium", answers: { A: "1", B: "2", C: "3", D: "4" }, correctAnswer: "D", point: 20.5 }),
		sampleQuestion("6q3", { explanation: "Nhớ quy đồng mẫu số trước khi cộng." })
	];
	var store = makeFakeStore({ lop6: questions, lop7: [sampleQuestion("7q1")] });
	var bundles = await Promise.all(["lop6", "lop7"].map(function (level) {
		return store.getLevelBundle(level).then(function (bundle) {
			return { level: level, questions: bundle.questions };
		});
	}));

	var preview = await questionImport.previewImport(store, questionImport.questionsToCsv(bundles), { mode: "replace" });

	assert.equal(preview.ok, true, JSON.stringify(preview.errors));
	assert.deepEqual(preview.totals, { rows: 4, added: 0, updated: 0, removed: 0, unchanged: 4 });
});

// --- 7. ROUTE THẬT (app + kho JSON 1.200 câu của repo) ----------------------

test("3 route mới đều đòi đăng nhập admin", async function () {
	var anonymous = request(sharedRuntime.app);

	await anonymous.get("/api/admin/questions.csv").expect(401);
	await anonymous.post("/api/admin/questions/import/preview").set("Content-Type", "text/csv").send("x").expect(401);
	await anonymous.post("/api/admin/questions/import/apply").set("Content-Type", "text/csv").send("x").expect(401);
});

test("GET /api/admin/questions.csv trả charset=utf-8 + BOM + tên file tải về", async function () {
	var agent = await loginAdmin();
	var response = await agent.get("/api/admin/questions.csv?level=lop6").expect(200);

	// charset ở header VÀ BOM trong nội dung — thiếu một trong hai là Excel Windows
	// đọc thành CP-1252 (bài học P1-6).
	assert.match(response.headers["content-type"], /text\/csv/);
	assert.match(response.headers["content-type"], /charset=utf-8/);
	assert.match(response.headers["content-disposition"], /attachment/);
	assert.equal(response.text.charCodeAt(0), 0xFEFF);

	var lines = response.text.slice(1).split("\r\n");

	assert.equal(lines[0], "sep=,");
	assert.match(lines[1], /^Lớp,Mã câu hỏi/);
	assert.ok(lines.length > 50, "lớp 6 phải có ít nhất vài chục câu");
});

test("xuất một lớp lạ bị từ chối 400", async function () {
	var agent = await loginAdmin();

	await agent.get("/api/admin/questions.csv?level=lop9").expect(400);
});

test("KHỨ HỒI TRÊN DỮ LIỆU THẬT: xuất cả 3 lớp rồi nhập lại ⇒ 0 thay đổi", async function () {
	var agent = await loginAdmin();
	var exported = await agent.get("/api/admin/questions.csv").expect(200);
	var preview = await agent
		.post("/api/admin/questions/import/preview?mode=replace")
		.set("Content-Type", "text/csv")
		.send(exported.text)
		.expect(200);

	assert.equal(preview.body.ok, true, JSON.stringify(preview.body.errors || []).slice(0, 500));
	assert.equal(preview.body.totals.added, 0);
	assert.equal(preview.body.totals.updated, 0);
	assert.equal(preview.body.totals.removed, 0);
	assert.equal(preview.body.totals.unchanged, preview.body.totals.rows);
	assert.equal(preview.body.levels.length, 3);
	assert.deepEqual(preview.body.untouchedLevels, []);
	// Ngân hàng repo có 1.200 câu (100 + 100 + 1.000).
	assert.equal(preview.body.totals.rows, 1200);
});

test("nhập qua HTTP: sửa 1 câu, thêm 1 câu, KHÔNG xoá câu nào của lớp 6", async function () {
	var agent = await loginAdmin();
	var before = await agent.get("/api/levels/lop6/question-bank").expect(200);
	var firstId = before.body.questions[0].id;
	var csv = buildCsv({
		rows: [
			rowOf("lop6", Object.assign({}, before.body.questions[0], { explanation: "Lời giải do P2-6 thêm vào." })),
			rowOf("lop6", sampleQuestion("6q-p2-6-moi", { question: "Câu mới nhập từ Excel: 5 × 4 = ?", answers: { A: "20", B: "21" } }))
		]
	});

	var preview = await agent
		.post("/api/admin/questions/import/preview")
		.set("Content-Type", "text/csv")
		.send(csv)
		.expect(200);

	assert.equal(preview.body.ok, true, JSON.stringify(preview.body.errors || []));
	assert.equal(preview.body.totals.added, 1);
	assert.equal(preview.body.totals.updated, 1);
	assert.equal(preview.body.totals.removed, 0);
	assert.equal(preview.body.levels[0].resultCount, before.body.questions.length + 1);

	var applied = await agent
		.post("/api/admin/questions/import/apply?mode=merge&digest=" + preview.body.digest)
		.set("Content-Type", "text/csv")
		.send(csv)
		.expect(200);

	assert.equal(applied.body.ok, true);
	assert.deepEqual(applied.body.applied, ["lop6"]);

	var after = await agent.get("/api/levels/lop6/question-bank").expect(200);

	assert.equal(after.body.questions.length, before.body.questions.length + 1);
	assert.equal(after.body.questions[0].id, firstId);
	assert.equal(after.body.questions[0].explanation, "Lời giải do P2-6 thêm vào.");
	assert.equal(after.body.questions[after.body.questions.length - 1].id, "6q-p2-6-moi");
	// Chữ có dấu đi qua HTTP + CSV + kho vẫn nguyên.
	assert.equal(after.body.questions[after.body.questions.length - 1].question, "Câu mới nhập từ Excel: 5 × 4 = ?");
});

test("nhập file hỏng qua HTTP: 200 kèm ok=false + danh sách lỗi có số dòng, ngân hàng KHÔNG đổi", async function () {
	var agent = await loginAdmin();
	var before = await agent.get("/api/levels/lop6/question-bank").expect(200);
	var csv = buildCsv({ rows: [rowOf("lop6", sampleQuestion("6q-hong", { time: "mười hai" }))] });

	var preview = await agent
		.post("/api/admin/questions/import/preview")
		.set("Content-Type", "text/csv")
		.send(csv)
		.expect(200);

	assert.equal(preview.body.ok, false);
	assert.equal(preview.body.errors[0].line, 3);
	assert.equal(preview.body.errors[0].excelRow, 2);

	var applied = await agent
		.post("/api/admin/questions/import/apply?digest=gia-mao")
		.set("Content-Type", "text/csv")
		.send(csv)
		.expect(200);

	assert.equal(applied.body.ok, false);

	var after = await agent.get("/api/levels/lop6/question-bank").expect(200);

	assert.equal(after.body.questions.length, before.body.questions.length);
});

test("gửi body rỗng hoặc sai Content-Type bị từ chối 400 với thông báo tiếng Việt", async function () {
	var agent = await loginAdmin();
	var empty = await agent
		.post("/api/admin/questions/import/preview")
		.set("Content-Type", "text/csv")
		.send("")
		.expect(400);

	assert.match(empty.body.error, /Chưa có nội dung file CSV/);

	var wrongType = await agent
		.post("/api/admin/questions/import/preview")
		.send({ csv: "lop6" })
		.expect(400);

	assert.match(wrongType.body.error, /text\/csv/);
});

// --- 8. Hợp đồng: P2-6 KHÔNG được sửa file hợp đồng tích hợp -----------------

test("questionImport không tự viết lại luật — vẫn gọi validateQuestion của questionModel", function () {
	var source = fs.readFileSync(path.join(rootDir, "server", "questionImport.js"), "utf8");

	assert.ok(source.indexOf("QuestionModel.validateQuestion(") !== -1, "phải dùng lại bộ kiểm tra của hợp đồng");
	assert.ok(source.indexOf("BOM + lines.join(CRLF)") !== -1, "phải giữ công thức BOM + CRLF của P1-6");

	// KHÔNG thêm phụ thuộc npm nào cho P2-6 (lý do ở đầu server/questionImport.js:
	// gói `xlsx` có lịch sử CVE và không nằm trên npm registry công khai).
	var manifest = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
	var names = Object.keys(manifest.dependencies).concat(Object.keys(manifest.devDependencies));

	["xlsx", "exceljs", "node-xlsx", "csv-parse", "papaparse"].forEach(function (packageName) {
		assert.equal(names.indexOf(packageName), -1, "P2-6 không được thêm " + packageName);
	});
});

test("trang admin: bắt buộc xem trước rồi mới xác nhận, và mặc định là KHÔNG xoá", function () {
	var admin = fs.readFileSync(path.join(rootDir, "admin.html"), "utf8");

	assert.ok(/id="bank-preview-button"/.test(admin), "phải có nút xem trước");
	// Nút xác nhận phải sinh ra ở trạng thái KHOÁ — mở nó là việc của một bản xem
	// trước hợp lệ, không phải của việc tải trang.
	assert.match(admin, /id="bank-apply-button"[^>]*disabled/);
	assert.ok(/questions\/import\/preview/.test(admin) && /questions\/import\/apply/.test(admin));
	assert.ok(/questions\.csv/.test(admin), "phải có nút xuất");

	// Lựa chọn ĐẦU TIÊN của ô "câu không có trong file" phải là giữ nguyên — cái
	// được chọn sẵn không bao giờ được là cái xoá dữ liệu.
	var modeSelect = admin.slice(admin.indexOf('id="bank-import-mode"'));

	assert.ok(modeSelect.indexOf('value="merge"') < modeSelect.indexOf('value="replace"'));
	assert.ok(/CSV UTF-8/.test(admin), "phải hướng dẫn giáo viên lưu đúng bảng mã");
	// Không nhúng thư viện Excel nào vào trang legacy (P2-7 mới chuyển admin sang Vite).
	assert.equal(/xlsx|sheetjs|papaparse/i.test(admin), false);
});

test("hai file hợp đồng tích hợp KHÔNG bị P2-6 sửa", function () {
	// Quy tắc vàng #4: `shared/questionModel.js` và `questionBank.js` chỉ được ĐỌC.
	// Test này đọc mã nguồn thay vì tin vào review — kiểm rằng mọi thứ P2-6 cần đều
	// đã có sẵn ở đó và không ai phải "thêm một hàm nhỏ" vào hợp đồng.
	["validateQuestion", "normalizeDifficulty", "normalizeExplanation", "EXPLANATION_MAX_LENGTH", "QUESTION_ANSWER_KEYS"].forEach(
		function (member) {
			assert.notEqual(QuestionModel[member], undefined, "questionModel phải có sẵn " + member);
		}
	);

	var bankSource = fs.readFileSync(path.join(rootDir, "questionBank.js"), "utf8");

	assert.ok(bankSource.indexOf("questions/import") === -1, "questionBank.js không được biết gì về nhập/xuất Excel");
});

test("13 route cũ + shape bundle không đổi (P2-6 chỉ THÊM)", async function () {
	var agent = await loginAdmin();
	var bundle = await agent.get("/api/levels/lop7/question-bank").expect(200);

	assert.deepEqual(
		Object.keys(bundle.body).sort(),
		["gameSpeed", "pointSettings", "questions", "quizMode", "timeSettings"]
	);
});
