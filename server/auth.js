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

function createAdminToken(config, ownerId) {
	return jwt.sign(
		{
			role: "admin",
			owner: typeof ownerId === "string" && ownerId.trim() !== "" ? ownerId.trim() : DEFAULT_OWNER_ID
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
	DEFAULT_OWNER_ID: DEFAULT_OWNER_ID,
	resolveOwnerId: resolveOwnerId,
	clearAdminCookie: clearAdminCookie,
	createAdminToken: createAdminToken,
	isAuthenticated: isAuthenticated,
	requireAdminAuth: requireAdminAuth,
	setAdminCookie: setAdminCookie,
	verifyAdminPassword: verifyAdminPassword
};
