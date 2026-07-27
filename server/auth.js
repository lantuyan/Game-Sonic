"use strict";

var bcrypt = require("bcrypt");
var jwt = require("jsonwebtoken");

function getCookieOptions(config) {
	return {
		httpOnly: true,
		sameSite: "lax",
		secure: config.nodeEnv === "production",
		path: "/"
	};
}

/**
 * P2-5 — chủ sở hữu mặc định của lớp học.
 *
 * Hôm nay hệ thống chỉ có MỘT tài khoản admin dùng chung, nên mọi lớp thuộc về
 * `admin`. Nhưng quyền sở hữu đã được đưa vào token và vào MỌI truy vấn lớp ngay
 * từ bây giờ: P2-7 (nhiều tài khoản `admin_users`) chỉ cần đặt `owner` khác nhau
 * lúc đăng nhập là việc cách ly lớp giữa các giáo viên tự động đúng, không phải
 * đi sửa lại từng route — và không có giai đoạn nào hệ thống chạy với quyền sở
 * hữu "để tính sau".
 */
var DEFAULT_OWNER_ID = "admin";

/**
 * P2-7 — quyền của phiên admin.
 *
 * `owner` quản lý được tài khoản khác; `teacher` chỉ quản lý chính mình. Claim này
 * nằm ở `adminRole`, KHÔNG phải `role`: `role: "admin"` đã có từ V1 và đang nằm
 * trong cookie của mọi phiên đang mở — đổi nghĩa của nó là hoặc đăng xuất tất cả,
 * hoặc (tệ hơn) hạ quyền im lặng một phiên đang làm việc.
 */
var ADMIN_ROLE_OWNER = "owner";
var ADMIN_ROLE_TEACHER = "teacher";

function createAdminToken(config, ownerId, adminRole) {
	var owner = typeof ownerId === "string" && ownerId.trim() !== "" ? ownerId.trim() : DEFAULT_OWNER_ID;

	return jwt.sign(
		{
			role: "admin",
			owner: owner,
			adminRole: adminRole === ADMIN_ROLE_TEACHER ? ADMIN_ROLE_TEACHER : ADMIN_ROLE_OWNER
		},
		config.jwtSecret,
		{
			expiresIn: config.jwtExpiresIn
		}
	);
}

function setAdminCookie(response, token, config) {
	response.cookie(config.cookieName, token, getCookieOptions(config));
}

function clearAdminCookie(response, config) {
	response.clearCookie(config.cookieName, getCookieOptions(config));
}

async function verifyAdminPassword(password, config) {
	if (typeof password !== "string" || password === "") {
		return false;
	}

	return bcrypt.compare(password, config.adminPasswordHash);
}

function readAdminClaims(request, config) {
	var token = request.cookies ? request.cookies[config.cookieName] : "";

	if (typeof token !== "string" || token === "") {
		return null;
	}

	try {
		return jwt.verify(token, config.jwtSecret);
	} catch (error) {
		return null;
	}
}

function isAuthenticated(request, config) {
	return readAdminClaims(request, config) != null;
}

/**
 * Chủ sở hữu của phiên admin đang gọi. Token cũ (phát trước P2-5) không có claim
 * `owner` — ngã về `admin` để không ai bị đăng xuất giữa chừng lúc cập nhật.
 */
function resolveOwnerId(request, config) {
	var claims = readAdminClaims(request, config);

	if (claims == null) {
		return null;
	}

	return typeof claims.owner === "string" && claims.owner.trim() !== "" ? claims.owner.trim() : DEFAULT_OWNER_ID;
}

/**
 * P2-7 — danh tính đầy đủ của phiên admin: `{ username, role }`.
 *
 * Token phát TRƯỚC P2-7 không có `adminRole`. Ngã về `owner` cho tài khoản `admin`
 * và `teacher` cho mọi tên khác: phiên `admin` cũ chính là tài khoản dùng chung có
 * toàn quyền, nên hạ quyền nó giữa chừng là khoá cửa với người đang làm việc.
 */
function resolveAdminIdentity(request, config) {
	var claims = readAdminClaims(request, config);

	if (claims == null) {
		return null;
	}

	var username =
		typeof claims.owner === "string" && claims.owner.trim() !== "" ? claims.owner.trim() : DEFAULT_OWNER_ID;
	var adminRole = typeof claims.adminRole === "string" ? claims.adminRole.trim() : "";

	if (adminRole !== ADMIN_ROLE_OWNER && adminRole !== ADMIN_ROLE_TEACHER) {
		adminRole = username === DEFAULT_OWNER_ID ? ADMIN_ROLE_OWNER : ADMIN_ROLE_TEACHER;
	}

	return { username: username, role: adminRole };
}

function requireAdminAuth(config) {
	return function (request, response, next) {
		if (isAuthenticated(request, config) !== true) {
			response.status(401).json({
				error: "Admin authentication required."
			});
			return;
		}

		next();
	};
}

module.exports = {
	ADMIN_ROLE_OWNER: ADMIN_ROLE_OWNER,
	ADMIN_ROLE_TEACHER: ADMIN_ROLE_TEACHER,
	DEFAULT_OWNER_ID: DEFAULT_OWNER_ID,
	resolveAdminIdentity: resolveAdminIdentity,
	resolveOwnerId: resolveOwnerId,
	clearAdminCookie: clearAdminCookie,
	createAdminToken: createAdminToken,
	isAuthenticated: isAuthenticated,
	requireAdminAuth: requireAdminAuth,
	setAdminCookie: setAdminCookie,
	verifyAdminPassword: verifyAdminPassword
};
