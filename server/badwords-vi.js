"use strict";

// Bộ lọc từ cấm tiếng Việt cho biệt danh (P1-4).
//
// NGUYÊN TẮC ĐỊNH HƯỚNG MỌI QUYẾT ĐỊNH Ở ĐÂY: chặn nhầm TÊN THẬT của một đứa trẻ
// tệ hơn nhiều so với để lọt một biệt danh xấu. Biệt danh xấu thì giáo viên khoá
// bằng tay trong một phút (P1-4 có sẵn công cụ); còn bị chặn oan thì học sinh
// không hiểu vì sao, và không có ai để hỏi.
//
// Vì vậy bộ lọc chia làm HAI TẦNG với độ nhạy khác nhau:
//
//   1. `BANNED_WORDS` — từ đủ dài, nghĩa tục rõ ràng. So theo TỪ (không so chuỗi
//      con): "cặc" bị chặn nhưng "Bắc" thì không.
//
//   2. `BANNED_EXACT` — chuỗi NGẮN hoặc ĐA NGHĨA ("dm", "cc", "vl", "lon"). Chỉ
//      chặn khi chúng là TOÀN BỘ biệt danh. Lý do: "DM" một mình gần như chắc chắn
//      là chửi, nhưng "DM Khoa" nhiều khả năng là tên viết tắt.
//
// Những từ ĐÃ CÂN NHẮC RỒI BỎ RA vì trùng tên/từ thường dùng — đừng thêm lại:
//   · "diem" → "Diễm" là tên nữ rất phổ biến, và "điểm" là từ dùng hàng ngày;
//   · "cac"  → "các" là mạo từ tiếng Việt, xuất hiện đầy trong cụm thường;
//   · "dit"  → giữ lại (không có từ thường nào trùng), nhưng chỉ so theo từ.
//
// Bộ lọc CHỈ dùng cho biệt danh hiển thị công khai, không dùng cho nội dung học tập.

/** Từ tục "đủ dài để không trùng gì" — so theo TỪ, dạng đã bỏ dấu. */
var BANNED_WORDS = [
	"dume", "dumemay", "cak", "buoi", "dit", "deo",
	"chode", "docho", "sucvat", "matday", "dongu", "thangngu", "condi",
	"fuck", "fck", "shit", "bitch", "asshole", "cunt", "nigger", "pussy"
];

/** Cụm nhiều từ — so trên chuỗi đã nối, vẫn theo ranh giới từ. */
var BANNED_PHRASES = [
	"dit me", "dit me may", "vai lon", "cho de", "do cho", "suc vat",
	"mat day", "do ngu", "thang ngu", "con di"
];

/**
 * Chuỗi NGẮN / ĐA NGHĨA — chỉ chặn khi là TOÀN BỘ biệt danh.
 * "dm" một mình là chửi; "DM Khoa" nhiều khả năng là tên viết tắt.
 */
var BANNED_EXACT = ["dm", "dmm", "dme", "vcl", "vl", "cc", "cac", "lon", "du", "diem"];

/**
 * Bỏ dấu tiếng Việt và chuẩn hoá về chữ thường.
 * `đ`/`Đ` phải xử lý riêng vì NFD KHÔNG tách nó thành d + dấu.
 */
function removeDiacritics(value) {
	return String(value == null ? "" : value)
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/đ/g, "d")
		.replace(/Đ/g, "D")
		.toLowerCase();
}

/**
 * Tách biệt danh thành các "từ".
 *
 * Chữ số đổi về chữ tương ứng ("l0n" → "lon"), mọi ký tự không phải chữ/số thành
 * khoảng trắng — học sinh hay chèn ký tự để lách ("d.m", "d_m", "d*m").
 */
function tokenize(value) {
	var normalized = removeDiacritics(value)
		.replace(/0/g, "o")
		.replace(/1/g, "i")
		.replace(/3/g, "e")
		.replace(/4/g, "a")
		.replace(/5/g, "s")
		.replace(/7/g, "t")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();

	return normalized === "" ? [] : normalized.split(" ");
}

/**
 * Biệt danh có chứa từ cấm không.
 *
 * @param {string} value      biệt danh người chơi nhập.
 * @param {string[]} [extraWords] từ cấm bổ sung của trường (dạng bất kỳ, sẽ bỏ dấu).
 */
function containsBadWord(value, extraWords) {
	var words = tokenize(value);

	if (words.length === 0) {
		return false;
	}

	var extra = Array.isArray(extraWords) ? extraWords.map(removeDiacritics) : [];
	var extraSingles = new Set(extra.filter(function (word) { return word.indexOf(" ") === -1; }));
	var extraPhrases = extra.filter(function (word) { return word.indexOf(" ") !== -1; });

	// Tầng 1 — từ tục đủ dài, so theo từng TỪ.
	var bannedSet = new Set(BANNED_WORDS);

	for (var index = 0; index < words.length; index += 1) {
		if (bannedSet.has(words[index]) || extraSingles.has(words[index])) {
			return true;
		}
	}

	// Tầng 1b — cụm nhiều từ, so trên chuỗi có ranh giới từ ở hai đầu.
	var padded = " " + words.join(" ") + " ";

	for (var phrase of BANNED_PHRASES.concat(extraPhrases)) {
		if (padded.indexOf(" " + phrase + " ") !== -1) {
			return true;
		}
	}

	// Tầng 2 — chuỗi ngắn/đa nghĩa: CHỈ khi là toàn bộ biệt danh.
	// So cả dạng còn khoảng trắng ("d m") lẫn dạng dính liền ("dm" từ "d.m").
	var glued = words.join("");

	if (BANNED_EXACT.indexOf(glued) !== -1) {
		return true;
	}

	// Tầng 3 — biệt danh là MỘT khối dính liền, đủ dài để không phải tên thật:
	// bắt kiểu lách "ditmemay". Chỉ xét cụm, không xét từ đơn.
	if (words.length === 1 && glued.length >= 7) {
		for (var gluedPhrase of BANNED_PHRASES) {
			if (glued.indexOf(gluedPhrase.replace(/ /g, "")) !== -1) {
				return true;
			}
		}
	}

	return false;
}

module.exports = {
	BANNED_WORDS: BANNED_WORDS,
	BANNED_PHRASES: BANNED_PHRASES,
	BANNED_EXACT: BANNED_EXACT,
	containsBadWord: containsBadWord,
	removeDiacritics: removeDiacritics,
	tokenize: tokenize
};
