"use strict";

var path = require("path");
var season = require("./season");

function resolveNumber(value, fallbackValue) {
	var numericValue = Number(value);

	if (isFinite(numericValue) === false || numericValue <= 0) {
		return fallbackValue;
	}

	return numericValue;
}

function resolveConfig(overrides) {
	var values = overrides || {};
	var rootDir = values.rootDir || path.resolve(__dirname, "..");
	var runtimeDir = values.runtimeDir || (process.env.VERCEL === "1" ? path.join("/tmp", "game-sonic-running") : path.join(rootDir, ".runtime"));
	var databasePath = values.databasePath || process.env.DATABASE_PATH || path.join(runtimeDir, "game-sonic-running.sqlite");

	return {
		rootDir: rootDir,
		staticDir: values.staticDir || rootDir,
		runtimeDir: runtimeDir,
		databasePath: databasePath,
		// Postgres connection string (Neon) for production. When empty, the SQL
		// layer falls back to embedded PGlite stored under pgDataDir.
		databaseUrl: values.databaseUrl != null ? values.databaseUrl : String(process.env.DATABASE_URL || ""),
		pgDataDir: values.pgDataDir || path.join(runtimeDir, "pgdata"),
		// Optional shared SQL client (lets question store + player store reuse one connection).
		sqlClient: values.sqlClient != null ? values.sqlClient : null,
		port: resolveNumber(values.port != null ? values.port : process.env.PORT, 3000),
		jwtSecret: values.jwtSecret != null ? values.jwtSecret : String(process.env.JWT_SECRET || ""),
		adminPasswordHash: values.adminPasswordHash != null ? values.adminPasswordHash : String(process.env.ADMIN_PASSWORD_HASH || ""),
		/**
		 * P1-4 — bật thì TỪ CHỐI hẳn điểm nộp không kèm vé ván chơi.
		 * Mặc định TẮT: client V1 cũ chưa biết gửi vé, bật sớm là khoá cửa với chính
		 * người chơi cũ. Bật ở bước "Checklist release P1" sau khi V2 đã phủ hết máy.
		 */
		anticheatEnforce:
			values.anticheatEnforce != null
				? values.anticheatEnforce === true
				: String(process.env.ANTICHEAT_ENFORCE || "") === "1",
		nodeEnv: values.nodeEnv || process.env.NODE_ENV || "development",
		/**
		 * P2-8 — mốc bắt đầu "Mùa 2" của bảng xếp hạng (plan §11 câu 5).
		 *
		 * CHUỖI THÔ, chưa parse: `resolveConfig` cố ý không ném lỗi (nhiều test dựng
		 * app bằng `createApp({...})` và không nên chết vì một biến môi trường lạ ở
		 * máy khác). `validateConfig` mới là chỗ ném — tức chỉ khi server thật khởi động.
		 *
		 * Rỗng = **chưa chốt ngày phát hành** ⇒ bảng xếp hạng chạy y như trước P2-8,
		 * chỉ có một bảng "Tất cả". Chủ dự án đặt `LEADERBOARD_SEASON2_START` lúc phát
		 * hành là mùa mới tự mở, không cần deploy lại client.
		 */
		leaderboardSeason2Start:
			values.leaderboardSeason2Start != null
				? String(values.leaderboardSeason2Start)
				: String(process.env.LEADERBOARD_SEASON2_START || ""),
		/**
		 * P2-7 — số lần đăng nhập admin cho phép mỗi phút mỗi IP.
		 *
		 * CỐ Ý **không đọc biến môi trường**: đây là tuyến chặn dò mật khẩu, và một
		 * biến môi trường đặt sai trên production là cách âm thầm nhất để tắt nó.
		 * Chỉ `createApp(overrides)` mới đổi được — tức là chỉ test.
		 *
		 * Vì sao cần đổi được: bộ test của P2-7 phải đăng nhập bằng NHIỀU tài khoản
		 * thật (giáo viên A, giáo viên B, quản trị chính) để kiểm cách ly quyền, mà
		 * limiter đếm theo IP nên 5 lượt là hết ngay trong một file.
		 */
		loginRateLimitMax: resolveNumber(values.loginRateLimitMax, 5),
		cookieName: "admin_token",
		jwtExpiresIn: "8h"
	};
}

function isPlaceholderSecret(value) {
	var normalizedValue = String(value || "").trim().toLowerCase();

	return normalizedValue === "" || normalizedValue.indexOf("replace-with-") === 0;
}

function validateConfig(config) {
	if (isPlaceholderSecret(config.jwtSecret)) {
		throw new Error("Missing JWT_SECRET. Add it to .env before starting the server.");
	}

	if (isPlaceholderSecret(config.adminPasswordHash)) {
		throw new Error("Missing ADMIN_PASSWORD_HASH. Generate one with \"npm run hash-password -- <password>\" and add it to .env.");
	}

	// P2-8: ngày ranh giới gõ sai thì DỪNG HẲN. Bỏ qua âm thầm nghĩa là bảng xếp
	// hạng lặng lẽ trộn thang điểm cũ với thang điểm mới, và không ai phát hiện ra
	// cho tới khi một học sinh hỏi vì sao bạn mình 4.000 điểm lại đứng trên mình 30.000.
	season.parseSeasonStart(config.leaderboardSeason2Start);
}

module.exports = {
	resolveConfig: resolveConfig,
	validateConfig: validateConfig
};
