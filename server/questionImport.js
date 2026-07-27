"use strict";

// P2-6 — XUẤT / NHẬP NGÂN HÀNG CÂU HỎI BẰNG FILE EXCEL MỞ ĐƯỢC.
//
// Vì sao CSV chứ không phải .xlsx (SheetJS):
//   · `server/statsStore.js` đã giải xong đúng bài này ở P1-6 — BOM UTF-8 + CRLF +
//     `charset=utf-8` là công thức để Excel bản Windows đọc đúng dấu tiếng Việt.
//     Phát minh lại bằng một thư viện khác là bỏ đi một lời giải đã kiểm chứng.
//   · Gói `xlsx` (SheetJS) có lịch sử CVE (prototype pollution / ReDoS) và bản
//     chính chủ không phát hành trên npm registry công khai — thêm nó vào một dự
//     án trường học là thêm một thứ phải theo dõi bảo mật mãi mãi, đổi lấy đúng
//     một thứ mà CSV cũng làm được: mở bằng Excel.
//   · 0 phụ thuộc mới ⇒ 0 byte thêm vào bundle, 0 giấy phép mới phải khai báo.
//
// Ba cái bẫy tiếng Việt + Excel mà file này xử lý:
//   1. **BOM UTF-8** — thiếu là Excel Windows đọc UTF-8 thành CP-1252, vỡ hết dấu.
//   2. **Dấu phân cách** — Windows tiếng Việt đặt "List separator" là `;`, nên
//      nháy đúp một file phân cách bằng `,` sẽ dồn TOÀN BỘ dữ liệu vào một cột.
//      Dòng chỉ thị `sep=,` ở đầu file bắt Excel dùng dấu phẩy. Chiều ngược lại:
//      Excel lưu lại theo `;` của máy, nên lúc NHẬP ta tự dò dấu phân cách.
//   3. **Số thập phân** — Excel tiếng Việt ghi `10,5`. Ô số nhận cả `,` lẫn `.`.
//
// Nguyên tắc bao trùm của phần NHẬP (đây là đường vào nguy hiểm nhất của hệ thống —
// một file sai có thể xoá sạch ngân hàng 1.200 câu của giáo viên):
//   · **Xem trước rồi mới xác nhận** — hai route tách hẳn, `preview` KHÔNG ghi gì.
//   · **Không bao giờ xoá ngầm** — câu không có trong file được GIỮ NGUYÊN. Muốn
//     xoá phải chọn rõ chế độ `replace`, và cũng chỉ xoá trong những lớp CÓ MẶT
//     trong file.
//   · **Sai một dòng là từ chối cả file** — nhập một nửa để lại ngân hàng ở trạng
//     thái không ai hiểu nổi.
//   · **Mọi lỗi kèm số dòng**, cả số dòng trong file lẫn số dòng Excel hiển thị.

var crypto = require("crypto");
var QuestionModel = require("../shared/questionModel");

var BOM = "﻿";
var CRLF = "\r\n";
var SEP_DIRECTIVE = "sep=,";
var EXPORT_DELIMITER = ",";
var DELIMITER_CANDIDATES = [",", ";", "\t"];
var MAX_REPORTED_ERRORS = 50;
var IMPORT_MODES = ["merge", "replace"];

/**
 * 12 cột — ĐÚNG các trường của `shared/questionModel.js`, không hơn không kém.
 * Q4 (plan §4) đã chốt KHÔNG đổi schema câu hỏi, nên bảng này chỉ là ánh xạ tên.
 *
 * `aliases` so khớp sau khi bỏ dấu + hạ chữ thường, nên giáo viên gõ "dap an dung"
 * hay "Đáp Án Đúng" đều nhận. Thứ tự cột TỰ DO — tra theo tên, không theo vị trí.
 */
var COLUMNS = [
	{ key: "level", title: "Lớp", required: true, aliases: ["lop", "level", "khoi", "lop hoc"] },
	{ key: "id", title: "Mã câu hỏi", required: true, aliases: ["ma cau hoi", "ma cau", "ma", "id"] },
	{ key: "difficulty", title: "Loại", required: true, aliases: ["loai", "loai cau hoi", "do kho", "difficulty"] },
	{ key: "question", title: "Nội dung câu hỏi", required: true, aliases: ["noi dung cau hoi", "noi dung", "cau hoi", "question"] },
	{ key: "A", title: "Đáp án A", required: true, aliases: ["dap an a", "a", "answer a"] },
	{ key: "B", title: "Đáp án B", required: true, aliases: ["dap an b", "b", "answer b"] },
	{ key: "C", title: "Đáp án C", required: true, aliases: ["dap an c", "c", "answer c"] },
	{ key: "D", title: "Đáp án D", required: true, aliases: ["dap an d", "d", "answer d"] },
	{ key: "correctAnswer", title: "Đáp án đúng", required: true, aliases: ["dap an dung", "dung", "correctanswer", "correct answer"] },
	{ key: "point", title: "Điểm", required: true, aliases: ["diem", "diem thuong", "point"] },
	{ key: "time", title: "Thời gian (giây)", required: true, aliases: ["thoi gian (giay)", "thoi gian", "giay", "time"] },
	{ key: "explanation", title: "Lời giải", required: true, aliases: ["loi giai", "loi giai ngan", "giai thich", "explanation"] }
];

/** Tên tiếng Việt của từng trường — dùng khi liệt kê "câu này đổi những gì". */
var FIELD_LABELS = {
	difficulty: "Loại",
	question: "Nội dung câu hỏi",
	answers: "Đáp án",
	correctAnswer: "Đáp án đúng",
	point: "Điểm",
	time: "Thời gian",
	explanation: "Lời giải"
};

// --- Tiện ích chuỗi ---------------------------------------------------------

/**
 * Bỏ dấu tiếng Việt để so khớp TÊN CỘT (chỉ dùng cho tên cột và mã lớp — KHÔNG
 * bao giờ đụng vào nội dung câu hỏi).
 */
function stripDiacritics(value) {
	return String(value == null ? "" : value)
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/đ/g, "d")
		.replace(/Đ/g, "D");
}

function normalizeHeaderName(value) {
	return stripDiacritics(value).toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Ô CSV. Bọc nháy khi có dấu phân cách, nháy kép, hoặc xuống dòng.
 *
 * `;` cũng được bọc dù ta xuất bằng `,`: đề lớp 8 có toạ độ dạng `M(1; 2)`, và
 * nếu ô đó không bọc thì một lượt "mở bằng Excel máy khác rồi lưu lại" có thể
 * biến nó thành hai cột.
 */
function escapeCell(value) {
	var text = String(value == null ? "" : value);

	return /[",;\t\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

// --- Bộ đọc CSV -------------------------------------------------------------

/**
 * Đọc CSV theo RFC 4180 (có bọc nháy, nháy kép đôi, xuống dòng trong ô).
 *
 * Mỗi bản ghi mang theo SỐ DÒNG VẬT LÝ nơi nó bắt đầu — không phải chỉ số mảng.
 * Đây là lý do phải tự viết bộ đọc thay vì `text.split("\n")`: một ô có xuống
 * dòng bên trong sẽ làm mọi số dòng phía sau lệch, và số dòng lệch còn tệ hơn
 * không có số dòng (giáo viên sửa nhầm câu khác).
 */
function parseDelimited(text, delimiter) {
	var records = [];
	var cells = [];
	var value = "";
	var inQuotes = false;
	var line = 1;
	var recordLine = 1;
	var index = 0;

	while (index < text.length) {
		var character = text.charAt(index);

		if (inQuotes === true) {
			if (character === '"') {
				if (text.charAt(index + 1) === '"') {
					value += '"';
					index += 2;
					continue;
				}

				inQuotes = false;
				index += 1;
				continue;
			}

			if (character === "\n") {
				line += 1;
			}

			value += character;
			index += 1;
			continue;
		}

		if (character === '"') {
			inQuotes = true;
			index += 1;
			continue;
		}

		if (character === delimiter) {
			cells.push(value);
			value = "";
			index += 1;
			continue;
		}

		if (character === "\r" || character === "\n") {
			if (character === "\r" && text.charAt(index + 1) === "\n") {
				index += 1;
			}

			cells.push(value);
			records.push({ line: recordLine, cells: cells });
			cells = [];
			value = "";
			index += 1;
			line += 1;
			recordLine = line;
			continue;
		}

		value += character;
		index += 1;
	}

	if (value !== "" || cells.length > 0) {
		cells.push(value);
		records.push({ line: recordLine, cells: cells });
	}

	return records.filter(function (record) {
		// Dòng trống hoàn toàn bị bỏ — Excel rất hay để lại một dòng trống ở cuối.
		return record.cells.some(function (cell) {
			return String(cell).trim() !== "";
		});
	});
}

/**
 * Dò dấu phân cách.
 *
 * Không đếm số dấu (đề lớp 8 đầy `;` trong nội dung), mà **chấm điểm theo số tên
 * cột nhận ra được** ở dòng tiêu đề. Dấu nào tách ra được nhiều tên cột hợp lệ
 * nhất thì đó là dấu thật.
 */
function detectDelimiter(text) {
	var sample = text.slice(0, 8000);
	var best = { delimiter: EXPORT_DELIMITER, score: -1 };

	DELIMITER_CANDIDATES.forEach(function (delimiter) {
		var records = parseDelimited(sample, delimiter);
		var header = records.length > 0 ? records[0].cells : [];
		var score = header.reduce(function (total, cell) {
			return total + (findColumn(cell) != null ? 1 : 0);
		}, 0);

		if (score > best.score) {
			best = { delimiter: delimiter, score: score };
		}
	});

	return best.delimiter;
}

function findColumn(headerCell) {
	var normalized = normalizeHeaderName(headerCell);

	if (normalized === "") {
		return null;
	}

	var found = null;

	COLUMNS.forEach(function (column) {
		if (found != null) {
			return;
		}

		if (normalizeHeaderName(column.title) === normalized || column.aliases.indexOf(normalized) !== -1) {
			found = column;
		}
	});

	return found;
}

// --- Chuẩn hoá từng ô -------------------------------------------------------

/**
 * Ô số. Nhận cả `10.5` lẫn `10,5` — Excel tiếng Việt ghi số thập phân bằng dấu
 * phẩy, và ô đó khi đó được bọc nháy nên vẫn về đúng một ô.
 *
 * KHÔNG cố đoán dấu phân nhóm hàng nghìn (`1.000`): với `1.000` thì "một nghìn"
 * và "một phẩy không" là hai cách đọc đều hợp lý, và đoán sai điểm số của một câu
 * là hỏng âm thầm. Trả NaN để người dùng tự sửa còn hơn.
 */
function parseNumberCell(raw) {
	var text = String(raw == null ? "" : raw).replace(/\s/g, "");

	if (text === "") {
		return NaN;
	}

	if (/^-?\d+,\d+$/.test(text)) {
		text = text.replace(",", ".");
	}

	return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : NaN;
}

/** `lop6` · `Lớp 6` · `6` đều ra `lop6`. Chuỗi lạ ra `""` (báo lỗi ở nơi gọi). */
function normalizeLevelCell(raw) {
	var text = stripDiacritics(String(raw == null ? "" : raw)).toLowerCase().replace(/\s+/g, "");

	if (QuestionModel.LEVELS.indexOf(text) !== -1) {
		return text;
	}

	var match = text.match(/^(?:lop)?([6-8])$/);

	return match != null ? "lop" + match[1] : "";
}

// --- XUẤT -------------------------------------------------------------------

/**
 * @param {Array<{level: string, questions: Array}>} entries
 * @returns {string} nội dung CSV kèm BOM — gửi thẳng vào response.
 */
function questionsToCsv(entries) {
	var lines = [SEP_DIRECTIVE];

	lines.push(COLUMNS.map(function (column) {
		return escapeCell(column.title);
	}).join(EXPORT_DELIMITER));

	(entries || []).forEach(function (entry) {
		(entry.questions || []).forEach(function (question) {
			var answers = question.answers || {};

			lines.push([
				entry.level,
				question.id,
				QuestionModel.normalizeDifficulty(question.difficulty),
				question.question,
				answers.A == null ? "" : answers.A,
				answers.B == null ? "" : answers.B,
				answers.C == null ? "" : answers.C,
				answers.D == null ? "" : answers.D,
				question.correctAnswer,
				question.point,
				question.time,
				question.explanation == null ? "" : question.explanation
			].map(escapeCell).join(EXPORT_DELIMITER));
		});
	});

	// BOM + CRLF — cùng công thức đã kiểm chứng ở `statsStore.statsToCsv` (P1-6).
	return BOM + lines.join(CRLF) + CRLF;
}

// --- ĐỌC FILE NHẬP ----------------------------------------------------------

function makeError(line, sepOffset, message) {
	return {
		line: line,
		// Excel NUỐT dòng `sep=,` (nó là chỉ thị, không phải dữ liệu), nên dòng thứ
		// N trong file hiện ra là dòng N-1 trên màn hình. Trả cả hai số để giáo viên
		// không phải tự trừ.
		excelRow: line - sepOffset,
		message: message
	};
}

/**
 * Đọc + kiểm tra toàn bộ file nhập.
 *
 * @returns {{ok: boolean, delimiter: string, rows: Array, errors: Array, warnings: Array}}
 */
function parseQuestionCsv(rawText) {
	var text = String(rawText == null ? "" : rawText);

	if (text.charAt(0) === BOM) {
		text = text.slice(1);
	}

	var errors = [];
	var warnings = [];

	if (text.trim() === "") {
		return {
			ok: false,
			delimiter: EXPORT_DELIMITER,
			rows: [],
			warnings: warnings,
			errors: [makeError(1, 0, "File rỗng — chưa có dữ liệu nào để nhập.")]
		};
	}

	// Ký tự thay thế U+FFFD = có byte không giải mã được bằng UTF-8. Đây chính là
	// dấu vết của "Excel lưu bằng CSV thường (ANSI)" thay vì "CSV UTF-8".
	if (text.indexOf("\uFFFD") !== -1) {
		return {
			ok: false,
			delimiter: EXPORT_DELIMITER,
			rows: [],
			warnings: warnings,
			errors: [makeError(1, 0,
				"File không phải UTF-8 nên dấu tiếng Việt đã hỏng. Trong Excel chọn " +
				"\"Lưu dưới dạng\" → \"CSV UTF-8 (Comma delimited)\" rồi nhập lại."
			)]
		};
	}

	// Dấu vết mojibake: file VẪN là UTF-8 hợp lệ nhưng nội dung là văn bản tiếng
	// Việt đã bị giải mã sai một lần rồi lưu lại. Không chặn (có thể là dữ liệu
	// thật của giáo viên), nhưng phải nói ra — bảng xem trước cho họ nhìn tận mắt.
	if (/Ã[-¿]|á»|áº|Æ°/.test(text)) {
		warnings.push(
			"Nội dung có dấu hiệu bị lỗi phông (ví dụ \"tiáº¿ng Viá»‡t\"). Kiểm tra kỹ cột " +
			"\"Nội dung câu hỏi\" trong bảng xem trước trước khi xác nhận."
		);
	}

	var firstLine = text.split(/\r\n|\n|\r/)[0];
	var sepMatch = firstLine.match(/^sep=(.)$/i);
	var sepOffset = sepMatch != null ? 1 : 0;
	var delimiter = sepMatch != null ? sepMatch[1] : detectDelimiter(text);
	var records = parseDelimited(text, delimiter);

	if (sepMatch != null && records.length > 0) {
		records = records.slice(1);
	}

	if (records.length === 0) {
		return {
			ok: false,
			delimiter: delimiter,
			rows: [],
			warnings: warnings,
			errors: [makeError(1 + sepOffset, sepOffset, "File không có dòng tiêu đề.")]
		};
	}

	var headerRecord = records[0];
	var columnIndex = {};
	var duplicateTitles = [];

	headerRecord.cells.forEach(function (cell, index) {
		var column = findColumn(cell);

		if (column == null) {
			return;
		}

		if (columnIndex[column.key] != null) {
			duplicateTitles.push(column.title);
			return;
		}

		columnIndex[column.key] = index;
	});

	var missing = COLUMNS.filter(function (column) {
		return column.required === true && columnIndex[column.key] == null;
	}).map(function (column) {
		return '"' + column.title + '"';
	});

	if (missing.length > 0) {
		errors.push(makeError(headerRecord.line, sepOffset,
			"Dòng tiêu đề thiếu cột bắt buộc: " + missing.join(", ") +
			". File nhập phải có đủ 12 cột như file xuất."
		));
	}

	if (duplicateTitles.length > 0) {
		errors.push(makeError(headerRecord.line, sepOffset,
			"Dòng tiêu đề có cột lặp: " + duplicateTitles.join(", ") + "."
		));
	}

	if (errors.length > 0) {
		return { ok: false, delimiter: delimiter, rows: [], errors: errors, warnings: warnings };
	}

	var dataRecords = records.slice(1);

	if (dataRecords.length === 0) {
		return {
			ok: false,
			delimiter: delimiter,
			rows: [],
			warnings: warnings,
			errors: [makeError(headerRecord.line, sepOffset, "File chỉ có dòng tiêu đề, không có câu hỏi nào.")]
		};
	}

	var rows = [];
	var seen = {};

	dataRecords.forEach(function (record) {
		if (errors.length >= MAX_REPORTED_ERRORS) {
			return;
		}

		function cell(key) {
			var index = columnIndex[key];
			var value = index != null && index < record.cells.length ? record.cells[index] : "";
			return String(value == null ? "" : value).trim();
		}

		function fail(message) {
			errors.push(makeError(record.line, sepOffset, message));
		}

		var level = normalizeLevelCell(cell("level"));

		if (level === "") {
			fail('Cột "Lớp" phải là lop6 / lop7 / lop8 (đang là "' + cell("level") + '").');
			return;
		}

		var id = cell("id");

		if (id === "") {
			fail('Thiếu "Mã câu hỏi".');
			return;
		}

		var key = level + "::" + id;

		if (seen[key] != null) {
			fail('Mã câu hỏi "' + id + '" của lớp ' + level + ' bị trùng với dòng ' + seen[key] + ".");
			return;
		}

		seen[key] = record.line;

		if (cell("question") === "") {
			fail('Câu "' + id + '" thiếu "Nội dung câu hỏi".');
			return;
		}

		var answers = {};
		var filled = [];
		var gap = null;

		QuestionModel.QUESTION_ANSWER_KEYS.forEach(function (answerKey, index) {
			var value = cell(answerKey);

			if (value === "") {
				return;
			}

			if (index !== filled.length && gap == null) {
				gap = answerKey;
			}

			answers[answerKey] = value;
			filled.push(answerKey);
		});

		if (gap != null) {
			fail('Câu "' + id + '": đáp án ' + gap + " có nội dung nhưng đáp án trước đó bỏ trống — phải điền lần lượt từ A.");
			return;
		}

		if (filled.length < 2) {
			fail('Câu "' + id + '" phải có ít nhất 2 đáp án (A và B).');
			return;
		}

		var correctAnswer = cell("correctAnswer").toUpperCase();

		if (filled.indexOf(correctAnswer) === -1) {
			fail('Câu "' + id + '": "Đáp án đúng" là "' + cell("correctAnswer") + '" nhưng chỉ có đáp án ' + filled.join(", ") + ".");
			return;
		}

		var point = parseNumberCell(cell("point"));

		if (isFinite(point) === false || point < 0) {
			fail('Câu "' + id + '": "Điểm" phải là số không âm (đang là "' + cell("point") + '").');
			return;
		}

		var time = parseNumberCell(cell("time"));

		if (isFinite(time) === false || time < 1 || Math.floor(time) !== time) {
			fail('Câu "' + id + '": "Thời gian (giây)" phải là số nguyên từ 1 trở lên (đang là "' + cell("time") + '").');
			return;
		}

		var explanation = cell("explanation");

		if (explanation.length > QuestionModel.EXPLANATION_MAX_LENGTH) {
			fail('Câu "' + id + '": "Lời giải" dài ' + explanation.length + " ký tự, tối đa " + QuestionModel.EXPLANATION_MAX_LENGTH + ".");
			return;
		}

		var candidate = {
			id: id,
			difficulty: cell("difficulty"),
			question: cell("question"),
			answers: answers,
			correctAnswer: correctAnswer,
			point: point,
			time: time
		};

		if (explanation !== "") {
			candidate.explanation = explanation;
		}

		try {
			// Cửa cuối cùng là HỢP ĐỒNG `shared/questionModel.js`, không phải các kiểm
			// tra tiếng Việt phía trên. Những kiểm tra kia chỉ tồn tại để giáo viên đọc
			// được lỗi bằng tiếng mẹ đẻ; luật thì vẫn là luật của model. Nếu một ngày
			// model chặt thêm, dòng dưới đây bắt được ngay — có test canh việc thông
			// điệp tiếng Anh này KHÔNG bao giờ lộ ra với các lỗi thường gặp.
			rows.push({
				line: record.line,
				excelRow: record.line - sepOffset,
				level: level,
				question: QuestionModel.validateQuestion(candidate, "Dòng " + record.line, 0)
			});
		} catch (error) {
			fail(error.message);
		}
	});

	if (errors.length > 0) {
		return { ok: false, delimiter: delimiter, rows: [], errors: errors, warnings: warnings };
	}

	return { ok: true, delimiter: delimiter, rows: rows, errors: [], warnings: warnings };
}

// --- So sánh & dựng kế hoạch ------------------------------------------------

/** Dạng chuẩn để SO SÁNH và để băm — bỏ `availableAnswers` (suy ra được). */
function canonicalQuestion(question) {
	var answers = {};

	QuestionModel.QUESTION_ANSWER_KEYS.forEach(function (answerKey) {
		var value = question.answers != null ? question.answers[answerKey] : null;

		if (value != null && String(value).trim() !== "") {
			answers[answerKey] = String(value).trim();
		}
	});

	return {
		id: question.id,
		difficulty: QuestionModel.normalizeDifficulty(question.difficulty),
		question: String(question.question),
		answers: answers,
		correctAnswer: String(question.correctAnswer).toUpperCase(),
		point: Number(question.point),
		time: Number(question.time),
		explanation: QuestionModel.normalizeExplanation(question.explanation, question.id)
	};
}

function listChangedFields(before, after) {
	var changed = [];

	["difficulty", "question", "correctAnswer", "point", "time", "explanation"].forEach(function (field) {
		if (before[field] !== after[field]) {
			changed.push(FIELD_LABELS[field]);
		}
	});

	if (JSON.stringify(before.answers) !== JSON.stringify(after.answers)) {
		changed.push(FIELD_LABELS.answers);
	}

	return changed;
}

function normalizeMode(value) {
	var mode = String(value == null ? "" : value).trim().toLowerCase();

	if (mode === "") {
		return "merge";
	}

	if (IMPORT_MODES.indexOf(mode) === -1) {
		throw new Error('Chế độ nhập phải là "merge" hoặc "replace".');
	}

	return mode;
}

/**
 * Dựng kế hoạch thay đổi. **KHÔNG ghi gì** — đây là hàm thuần, và đó là lý do
 * "xem trước" và "xác nhận" chắc chắn nói về cùng một thứ: cả hai gọi hàm này.
 *
 * @param {Object} currentByLevel  { lop6: [câu đã chuẩn hoá], ... } chỉ các lớp có trong file
 * @param {Array}  rows            kết quả `parseQuestionCsv().rows`
 * @param {string} mode            "merge" (mặc định, KHÔNG xoá) hoặc "replace"
 */
function buildPlan(currentByLevel, rows, mode) {
	var normalizedMode = normalizeMode(mode);
	var byLevel = {};
	var order = [];

	rows.forEach(function (row) {
		if (byLevel[row.level] == null) {
			byLevel[row.level] = [];
			order.push(row.level);
		}

		byLevel[row.level].push(row);
	});

	var levels = order.map(function (level) {
		var current = (currentByLevel[level] || []).map(canonicalQuestion);
		var currentById = {};

		current.forEach(function (question) {
			currentById[question.id] = question;
		});

		var incoming = byLevel[level].map(function (row) {
			return { line: row.line, excelRow: row.excelRow, question: canonicalQuestion(row.question) };
		});
		var incomingById = {};

		incoming.forEach(function (item) {
			incomingById[item.question.id] = item.question;
		});

		var added = [];
		var updated = [];
		var unchanged = 0;

		incoming.forEach(function (item) {
			var before = currentById[item.question.id];

			if (before == null) {
				added.push({ id: item.question.id, line: item.line, excelRow: item.excelRow });
				return;
			}

			var changes = listChangedFields(before, item.question);

			if (changes.length === 0) {
				unchanged += 1;
				return;
			}

			updated.push({ id: item.question.id, line: item.line, excelRow: item.excelRow, changes: changes });
		});

		var removed = normalizedMode === "replace"
			? current.filter(function (question) {
				return incomingById[question.id] == null;
			}).map(function (question) {
				return question.id;
			})
			: [];

		// Danh sách CUỐI CÙNG sẽ được ghi.
		//   · merge   → giữ nguyên thứ tự cũ, câu nào có trong file thì thay nội
		//               dung, câu mới nối vào cuối. Câu KHÔNG có trong file ở lại.
		//   · replace → đúng thứ tự trong file.
		var result;

		if (normalizedMode === "replace") {
			result = incoming.map(function (item) {
				return item.question;
			});
		} else {
			result = current.map(function (question) {
				return incomingById[question.id] != null ? incomingById[question.id] : question;
			}).concat(incoming.filter(function (item) {
				return currentById[item.question.id] == null;
			}).map(function (item) {
				return item.question;
			}));
		}

		return {
			level: level,
			rows: incoming.length,
			added: added,
			updated: updated,
			removed: removed,
			unchanged: unchanged,
			currentCount: current.length,
			resultCount: result.length,
			result: result
		};
	});

	var untouched = QuestionModel.LEVELS.filter(function (level) {
		return byLevel[level] == null;
	});

	var totals = levels.reduce(function (sum, item) {
		return {
			rows: sum.rows + item.rows,
			added: sum.added + item.added.length,
			updated: sum.updated + item.updated.length,
			removed: sum.removed + item.removed.length,
			unchanged: sum.unchanged + item.unchanged
		};
	}, { rows: 0, added: 0, updated: 0, removed: 0, unchanged: 0 });

	return {
		ok: true,
		mode: normalizedMode,
		levels: levels,
		untouchedLevels: untouched,
		totals: totals,
		digest: digestPlan(normalizedMode, levels)
	};
}

/**
 * Vân tay của kết quả cuối cùng — băm CẢ danh sách sẽ được ghi, không chỉ phần
 * thay đổi. Nhờ vậy nếu một giáo viên khác sửa đề ở tab bên cạnh giữa lúc xem
 * trước và lúc bấm xác nhận thì vân tay lệch và lệnh ghi bị từ chối, thay vì âm
 * thầm đè lên việc của người kia.
 */
function digestPlan(mode, levels) {
	return crypto.createHash("sha256").update(JSON.stringify({
		mode: mode,
		levels: levels.map(function (item) {
			return { level: item.level, result: item.result };
		})
	})).digest("hex");
}

/** Bỏ `result` khỏi kế hoạch trước khi trả về HTTP — client không cần 1.200 câu. */
function toPublicPlan(plan) {
	return {
		ok: true,
		mode: plan.mode,
		digest: plan.digest,
		totals: plan.totals,
		untouchedLevels: plan.untouchedLevels,
		levels: plan.levels.map(function (item) {
			return {
				level: item.level,
				rows: item.rows,
				added: item.added,
				updated: item.updated,
				removed: item.removed,
				unchanged: item.unchanged,
				currentCount: item.currentCount,
				resultCount: item.resultCount
			};
		})
	};
}

// --- Ghép với kho dữ liệu ---------------------------------------------------

function loadCurrentByLevel(dataStore, levels) {
	return Promise.all(levels.map(function (level) {
		return Promise.resolve(dataStore.getLevelBundle(level)).then(function (bundle) {
			return { level: level, questions: bundle.questions || [] };
		});
	})).then(function (parts) {
		var map = {};

		parts.forEach(function (part) {
			map[part.level] = part.questions;
		});

		return map;
	});
}

/** Dựng kế hoạch từ nội dung CSV — dùng chung cho cả xem trước lẫn xác nhận. */
function planFromCsv(dataStore, csvText, options) {
	return Promise.resolve().then(function () {
		var mode = normalizeMode(options != null ? options.mode : null);
		var parsed = parseQuestionCsv(csvText);

		if (parsed.ok !== true) {
			return {
				ok: false,
				errors: parsed.errors,
				errorCount: parsed.errors.length,
				warnings: parsed.warnings
			};
		}

		var levels = [];

		parsed.rows.forEach(function (row) {
			if (levels.indexOf(row.level) === -1) {
				levels.push(row.level);
			}
		});

		return loadCurrentByLevel(dataStore, levels).then(function (currentByLevel) {
			var plan = buildPlan(currentByLevel, parsed.rows, mode);
			plan.warnings = parsed.warnings;
			plan.delimiter = parsed.delimiter;
			return plan;
		});
	});
}

function previewImport(dataStore, csvText, options) {
	return planFromCsv(dataStore, csvText, options).then(function (plan) {
		if (plan.ok !== true) {
			return plan;
		}

		var publicPlan = toPublicPlan(plan);
		publicPlan.warnings = plan.warnings;
		publicPlan.delimiter = plan.delimiter;
		return publicPlan;
	});
}

/**
 * Ghi thật.
 *
 * Ba lớp chắn trước khi một byte nào chạm vào ngân hàng:
 *   1. Cả file phải hợp lệ (một dòng sai là từ chối tất cả).
 *   2. Vân tay phải khớp với thứ giáo viên đã xem.
 *   3. Không lớp nào được rỗng sau khi nhập.
 *
 * Từng lớp là một `replaceQuestionsForLevel` — với kho Postgres đó là MỘT
 * transaction (xoá + chèn lại), nên không có trạng thái "đã xoá mà chưa chèn".
 * Giữa các lớp thì KHÔNG có transaction chung: gặp lỗi ở lớp thứ hai là dừng
 * ngay và báo rõ lớp nào đã ghi xong. Xem mục "Khác tài liệu" của P2-6.
 */
function applyImport(dataStore, csvText, options) {
	var settings = options || {};

	return planFromCsv(dataStore, csvText, settings).then(function (plan) {
		if (plan.ok !== true) {
			return plan;
		}

		var expected = String(settings.digest == null ? "" : settings.digest).trim();

		if (expected === "") {
			return {
				ok: false,
				reason: "missing-digest",
				errors: [],
				errorCount: 0,
				error: "Thiếu mã xác nhận. Bấm \"Xem trước thay đổi\" rồi mới xác nhận nhập."
			};
		}

		if (expected !== plan.digest) {
			return {
				ok: false,
				reason: "stale-preview",
				errors: [],
				errorCount: 0,
				error: "Ngân hàng câu hỏi đã thay đổi kể từ lúc xem trước. Xem trước lại rồi xác nhận."
			};
		}

		// Không cần kiểm "lớp rỗng sau khi nhập": một lớp chỉ xuất hiện trong kế hoạch
		// khi file có ÍT NHẤT một dòng hợp lệ của lớp đó, và cả hai chế độ đều giữ lại
		// những dòng ấy — nên `resultCount >= 1` là bất biến cấu trúc, không phải thứ
		// phải canh lúc chạy. (Kho vẫn chặn lần cuối: `validateQuestionsData` ném khi
		// danh sách rỗng.)
		var applied = [];

		return plan.levels.reduce(function (chain, item) {
			return chain.then(function () {
				return Promise.resolve(dataStore.replaceQuestionsForLevel(item.level, item.result)).then(function () {
					applied.push(item.level);
				});
			});
		}, Promise.resolve()).then(function () {
			var result = toPublicPlan(plan);
			result.applied = applied;
			result.warnings = plan.warnings;
			return result;
		}).catch(function (error) {
			var failure = new Error(
				"Nhập thất bại ở lớp " + (plan.levels[applied.length] || {}).level + ": " + error.message +
				(applied.length > 0 ? " (các lớp đã ghi xong: " + applied.join(", ") + ")" : "")
			);
			failure.statusCode = 400;
			throw failure;
		});
	});
}

module.exports = {
	COLUMNS: COLUMNS,
	IMPORT_MODES: IMPORT_MODES.slice(),
	MAX_REPORTED_ERRORS: MAX_REPORTED_ERRORS,
	SEP_DIRECTIVE: SEP_DIRECTIVE,
	questionsToCsv: questionsToCsv,
	parseQuestionCsv: parseQuestionCsv,
	parseDelimited: parseDelimited,
	detectDelimiter: detectDelimiter,
	canonicalQuestion: canonicalQuestion,
	normalizeMode: normalizeMode,
	buildPlan: buildPlan,
	previewImport: previewImport,
	applyImport: applyImport
};
