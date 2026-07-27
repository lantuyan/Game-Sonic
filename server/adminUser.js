"use strict";

// P2-7 · LUẬT THUẦN CHO TÀI KHOẢN QUẢN TRỊ.
//
// Tách khỏi `adminUserStore.js` vì đúng một lý do: những luật dưới đây quyết định
// ai vào được trang quản trị, nên chúng phải kiểm được bằng test mà không cần
// CSDL, không cần bcrypt, không cần HTTP.
//
// Hai bất biến của cả P2-7, viết ra để người sửa sau không phải đoán:
//
//   1. **`username` CHÍNH LÀ `class_codes.owner_id`.** P2-5 đã ghi quyền sở hữu lớp
//      bằng chuỗi `"admin"`; nên tài khoản di trú từ `ADMIN_PASSWORD_HASH` BẮT BUỘC
//      mang tên `admin`, nếu không toàn bộ lớp học đã tạo sẽ mất chủ.
//   2. **Không bao giờ khoá cửa với người đang dùng.** `ADMIN_PASSWORD_HASH` là biến
//      môi trường đang chạy trên production; mọi đường di trú phải giữ nó còn hiệu
//      lực cho tài khoản `admin` (xem `LEGACY_USERNAME` + chú thích ở `server/app.js`).

/** Tên tài khoản của mật khẩu cũ trong `ADMIN_PASSWORD_HASH`. Trùng `auth.DEFAULT_OWNER_ID`. */
var LEGACY_USERNAME = "admin";

/** `owner` quản lý được tài khoản khác; `teacher` chỉ quản lý được chính mình. */
var ROLES = ["owner", "teacher"];

var USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
var MIN_PASSWORD_LENGTH = 8;
var MAX_PASSWORD_LENGTH = 200;
var MAX_DISPLAY_NAME_LENGTH = 60;

function badRequest(message) {
	var error = new Error(message);
	error.statusCode = 400;
	return error;
}

/**
 * Chuẩn hoá tên đăng nhập.
 *
 * Hạ chữ thường + cắt khoảng trắng vì giáo viên gõ tên mình trên điện thoại (bàn
 * phím tự viết hoa chữ đầu) — "Ha" và "ha" phải là một người, không phải hai tài
 * khoản khác nhau mà một trong hai không có lớp nào.
 */
function normalizeUsername(value) {
	return String(value == null ? "" : value).trim().toLowerCase();
}

function assertUsername(value) {
	var username = normalizeUsername(value);

	if (USERNAME_PATTERN.test(username) !== true) {
		throw badRequest(
			"Tên đăng nhập phải dài 3–32 ký tự, chỉ gồm chữ thường không dấu, số, dấu chấm, gạch ngang, gạch dưới."
		);
	}

	return username;
}

function normalizeRole(value) {
	var role = String(value == null ? "" : value).trim().toLowerCase();

	if (role === "") {
		return "teacher";
	}

	if (ROLES.indexOf(role) === -1) {
		throw badRequest("Quyền không hợp lệ (chỉ có \"owner\" hoặc \"teacher\").");
	}

	return role;
}

function normalizeDisplayName(value, fallbackUsername) {
	var name = String(value == null ? "" : value).replace(/\s+/g, " ").trim();

	if (name === "") {
		return fallbackUsername;
	}

	if (name.length > MAX_DISPLAY_NAME_LENGTH) {
		throw badRequest("Tên hiển thị tối đa " + MAX_DISPLAY_NAME_LENGTH + " ký tự.");
	}

	return name;
}

/**
 * Mật khẩu tối thiểu 8 ký tự và KHÔNG có quy tắc "phải có ký tự đặc biệt".
 *
 * Cố ý: người dùng là giáo viên trung học, mật khẩu này gõ trên máy phòng tin học
 * và thường được ghi lại đâu đó. Ép ký tự đặc biệt chỉ đẻ ra `Abc@1234` dán lên
 * màn hình. Độ dài là thứ duy nhất thực sự đắt cho người dò, nên chỉ ép độ dài.
 */
function assertPassword(value) {
	var password = String(value == null ? "" : value);

	if (password.length < MIN_PASSWORD_LENGTH) {
		throw badRequest("Mật khẩu phải dài ít nhất " + MIN_PASSWORD_LENGTH + " ký tự.");
	}

	if (password.length > MAX_PASSWORD_LENGTH) {
		throw badRequest("Mật khẩu quá dài (tối đa " + MAX_PASSWORD_LENGTH + " ký tự).");
	}

	return password;
}

/**
 * Ai được thao tác lên tài khoản nào.
 *
 * `actor` = { username, role }. Trả `{ allowed, reason }` thay vì ném lỗi để phía
 * gọi tự chọn mã HTTP — và để test liệt kê được cả bảng quyền trong một vòng lặp.
 *
 * Luật:
 *   · `owner` làm được mọi việc, TRỪ tự xoá mình (xoá tài khoản đang đăng nhập là
 *     cách nhanh nhất để không còn ai vào được trang quản trị);
 *   · `teacher` chỉ đổi được mật khẩu CỦA CHÍNH MÌNH — không tạo, không xoá,
 *     không đổi mật khẩu người khác, không xem danh sách tài khoản.
 */
function canManage(actor, action, targetUsername) {
	var actorRole = actor != null ? normalizeRole(actor.role) : "teacher";
	var actorName = actor != null ? normalizeUsername(actor.username) : "";
	var target = normalizeUsername(targetUsername);
	var isSelf = actorName !== "" && actorName === target;

	if (action === "set-password" && isSelf === true) {
		return { allowed: true, reason: "self" };
	}

	if (actorRole !== "owner") {
		return { allowed: false, reason: "not-owner" };
	}

	if (action === "delete" && isSelf === true) {
		return { allowed: false, reason: "self-delete" };
	}

	return { allowed: true, reason: "owner" };
}

module.exports = {
	LEGACY_USERNAME: LEGACY_USERNAME,
	ROLES: ROLES,
	MIN_PASSWORD_LENGTH: MIN_PASSWORD_LENGTH,
	MAX_DISPLAY_NAME_LENGTH: MAX_DISPLAY_NAME_LENGTH,
	assertPassword: assertPassword,
	assertUsername: assertUsername,
	canManage: canManage,
	normalizeDisplayName: normalizeDisplayName,
	normalizeRole: normalizeRole,
	normalizeUsername: normalizeUsername
};
