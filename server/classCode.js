"use strict";

// P2-5 · MÃ LỚP HỌC — phần thuần số học, không đụng CSDL.
//
// Tách riêng khỏi `classStore.js` vì đây là chỗ DUY NHẤT quyết định "mã có đoán
// được không", và câu trả lời đó phải kiểm được bằng test chứ không bằng niềm tin.
//
// Vì sao mã lớp phải khó đoán: mã lộ ra ngoài nghĩa là người lạ gắn được máy vào
// lớp của một trường tiểu học. Chúng ta chọn:
//
//   · **32 ký tự** trong bảng chữ, **8 vị trí** ⇒ 32^8 = **2^40 ≈ 1,1 nghìn tỉ**
//     tổ hợp. Với rate-limit 12 lượt thử/phút/máy (server/app.js), dò trúng một mã
//     bất kỳ cần trung bình hàng chục nghìn năm-máy. Đây mới là tuyến phòng thủ
//     thật; rate-limit chỉ để không ai làm nghẽn server.
//   · **`crypto.randomBytes`, KHÔNG `Math.random`.** `Math.random` là PRNG không
//     mã hoá: quan sát vài mã là suy ra được trạng thái sinh và đoán được mã kế
//     tiếp. Có test đọc mã nguồn canh điều này.
//   · Bảng chữ **bỏ `I O 0 1`** — mã được đọc to trong lớp và chép tay lên bảng;
//     "0 hay O" là một lỗi nhập liệu chắc chắn xảy ra, và mỗi lần xảy ra là một
//     lượt thử hỏng của một em học sinh, không phải của kẻ tấn công.
//
// Bảng chữ dài đúng 32 (ước của 256) nên `byte % 32` là **phân bố đều tuyệt đối** —
// không có sai lệch modulo, không cần lấy mẫu loại bỏ.

var crypto = require("crypto");

/** 32 ký tự: A–Z và 2–9, đã bỏ I, O, 0, 1. */
var ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
var CODE_LENGTH = 8;
/** Vị trí chèn dấu gạch khi HIỂN THỊ (lưu trong CSDL vẫn là 8 ký tự liền). */
var GROUP_SIZE = 4;

var MAX_LABEL_LENGTH = 60;
var DEFAULT_EXPIRES_IN_DAYS = 30;
var MIN_EXPIRES_IN_DAYS = 1;
var MAX_EXPIRES_IN_DAYS = 180;

/**
 * Số bit ngẫu nhiên thật sự của một mã. Hằng số này tồn tại để test khoá lại: hạ
 * độ dài mã hay thu nhỏ bảng chữ sẽ làm test đỏ, chứ không âm thầm làm mã yếu đi.
 */
var CODE_ENTROPY_BITS = Math.round(CODE_LENGTH * Math.log2(ALPHABET.length));

/** Sinh một mã mới. Chỉ dùng nguồn ngẫu nhiên mã hoá. */
function generateCode() {
	var bytes = crypto.randomBytes(CODE_LENGTH);
	var code = "";

	for (var index = 0; index < CODE_LENGTH; index += 1) {
		code += ALPHABET.charAt(bytes[index] % ALPHABET.length);
	}

	return code;
}

/**
 * Chuẩn hoá mã người dùng gõ vào → dạng lưu trong CSDL.
 *
 * Học sinh sẽ gõ "abcd-2345", "ABCD 2345", "abcd2345" — cả ba phải vào được cùng
 * một lớp. Trả về chuỗi rỗng nếu không phải mã hợp lệ, để phía gọi chỉ phải kiểm
 * một điều kiện.
 *
 * `O`→`0`? KHÔNG. Bảng chữ đã bỏ cả hai ký tự dễ nhầm, nên thay thế "thông minh"
 * chỉ làm mã sai trở thành mã sai khác. Ta chấp nhận từ chối và báo rõ.
 */
function normalizeCode(value) {
	var text = String(value == null ? "" : value).toUpperCase().replace(/[^A-Z0-9]/g, "");

	if (text.length !== CODE_LENGTH) {
		return "";
	}

	for (var index = 0; index < text.length; index += 1) {
		if (ALPHABET.indexOf(text.charAt(index)) === -1) {
			return "";
		}
	}

	return text;
}

/** Dạng hiển thị cho giáo viên đọc/chép: `ABCD-2345`. */
function formatCode(value) {
	var normalized = normalizeCode(value);

	if (normalized === "") {
		return "";
	}

	return normalized.slice(0, GROUP_SIZE) + "-" + normalized.slice(GROUP_SIZE);
}

/**
 * Tên lớp do giáo viên đặt (vd "Lớp 6A — cô Hà").
 *
 * ⚠ Đây là dữ liệu của LỚP, không phải của học sinh. Cả P2-5 không có một trường
 * nào nhận họ tên thật, ngày sinh hay email của trẻ (xem docs/v2/P2-5-PRIVACY.md).
 */
function normalizeLabel(value) {
	var text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();

	if (text === "") {
		throw badRequest("Tên lớp không được để trống.");
	}

	if (text.length > MAX_LABEL_LENGTH) {
		throw badRequest("Tên lớp tối đa " + MAX_LABEL_LENGTH + " ký tự.");
	}

	return text;
}

/**
 * Hạn dùng của mã. **Bắt buộc có** — một mã sống mãi là một mã sẽ lộ.
 *
 * Trần 180 ngày ≈ một năm học: dài hơn thì mã đi theo học sinh sang năm sau, lúc
 * lớp đã khác người.
 */
function normalizeExpiresInDays(value) {
	if (value == null || String(value).trim() === "") {
		return DEFAULT_EXPIRES_IN_DAYS;
	}

	var days = Number(value);

	if (isFinite(days) === false || Math.floor(days) !== days) {
		throw badRequest("Số ngày hiệu lực phải là số nguyên.");
	}

	if (days < MIN_EXPIRES_IN_DAYS || days > MAX_EXPIRES_IN_DAYS) {
		throw badRequest("Số ngày hiệu lực phải trong khoảng " + MIN_EXPIRES_IN_DAYS + "–" + MAX_EXPIRES_IN_DAYS + ".");
	}

	return days;
}

/** Trạng thái hiển thị của một lớp, suy ra từ dữ liệu — không lưu thành cột. */
function describeStatus(row, now) {
	var at = now instanceof Date ? now : new Date();

	if (row == null) {
		return "unknown";
	}

	if (row.revokedAt != null) {
		return "revoked";
	}

	if (row.expiresAt != null && new Date(row.expiresAt).getTime() <= at.getTime()) {
		return "expired";
	}

	return "active";
}

function badRequest(message) {
	var error = new Error(message);
	error.statusCode = 400;
	return error;
}

module.exports = {
	ALPHABET: ALPHABET,
	CODE_LENGTH: CODE_LENGTH,
	CODE_ENTROPY_BITS: CODE_ENTROPY_BITS,
	DEFAULT_EXPIRES_IN_DAYS: DEFAULT_EXPIRES_IN_DAYS,
	MIN_EXPIRES_IN_DAYS: MIN_EXPIRES_IN_DAYS,
	MAX_EXPIRES_IN_DAYS: MAX_EXPIRES_IN_DAYS,
	MAX_LABEL_LENGTH: MAX_LABEL_LENGTH,
	generateCode: generateCode,
	normalizeCode: normalizeCode,
	formatCode: formatCode,
	normalizeLabel: normalizeLabel,
	normalizeExpiresInDays: normalizeExpiresInDays,
	describeStatus: describeStatus
};
