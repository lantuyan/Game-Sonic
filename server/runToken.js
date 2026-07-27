"use strict";

// Vé một-ván (P1-4): client xin `POST /api/runs/start` lúc bắt đầu, nộp lại kèm điểm.
//
// Vé là chuỗi tự chứng thực `runId.expiresAt.hmac` ký bằng JWT_SECRET — KHÔNG cần
// bảng trong CSDL. Lý do rất thực tế: server chạy serverless trên Vercel, bảng vé
// nghĩa là thêm một vòng ghi/đọc DB cho MỖI ván, mà cái ta cần chỉ là "vé này do
// chính server phát và chưa quá 30 phút".
//
// Chống dùng lại (replay) thì KHÔNG tự chứng thực được — phải nhớ vé đã tiêu. Ở đây
// dùng bộ nhớ trong tiến trình, và ta nói thẳng giới hạn của nó: mỗi instance
// serverless có bộ nhớ riêng, nên vé dùng lại ở instance khác có thể lọt. Nó vẫn
// chặn được kịch bản thực tế nhất (bấm nộp lại nhiều lần trong một phiên), còn
// tuyến phòng thủ chính vẫn là kiểm chéo điểm ở `scoreCheck.js`.

var crypto = require("crypto");

var TOKEN_TTL_MS = 30 * 60 * 1000;
/** Trần số vé đã tiêu nhớ trong RAM — chặn rò rỉ bộ nhớ nếu chạy lâu. */
var SPENT_LIMIT = 5000;

var spentTokens = new Map();

function sign(payload, secret) {
	return crypto.createHmac("sha256", String(secret)).update(payload).digest("base64url");
}

/** Phát một vé mới. `nowMs` để test bơm thời gian thay vì chờ thật. */
function issueRunToken(secret, nowMs) {
	var now = nowMs != null ? nowMs : Date.now();
	var runId = crypto.randomUUID();
	var expiresAt = now + TOKEN_TTL_MS;
	var payload = runId + "." + expiresAt;

	return {
		runId: runId,
		token: payload + "." + sign(payload, secret),
		expiresAt: expiresAt
	};
}

/**
 * Kiểm vé. Trả về `{ ok: true }` hoặc `{ ok: false, reason }` với reason là một
 * trong: "missing" · "malformed" · "bad-signature" · "expired" · "replayed" ·
 * "run-id-mismatch".
 *
 * `consume: false` để soi vé mà không tiêu (dùng trong test).
 */
function verifyRunToken(token, runId, secret, options) {
	var settings = options || {};
	var now = settings.nowMs != null ? settings.nowMs : Date.now();

	if (typeof token !== "string" || token === "") {
		return { ok: false, reason: "missing" };
	}

	var parts = token.split(".");

	if (parts.length !== 3) {
		return { ok: false, reason: "malformed" };
	}

	var payload = parts[0] + "." + parts[1];
	var expected = sign(payload, secret);
	var provided = parts[2];

	// So sánh theo thời gian hằng: `===` trên chuỗi thoát sớm ở ký tự khác đầu tiên,
	// đủ để dò từng ký tự chữ ký nếu ai đó đo được thời gian phản hồi.
	var expectedBuffer = Buffer.from(expected);
	var providedBuffer = Buffer.from(provided);

	if (
		expectedBuffer.length !== providedBuffer.length ||
		crypto.timingSafeEqual(expectedBuffer, providedBuffer) === false
	) {
		return { ok: false, reason: "bad-signature" };
	}

	var expiresAt = Number(parts[1]);

	if (isFinite(expiresAt) === false || now > expiresAt) {
		return { ok: false, reason: "expired" };
	}

	if (runId != null && String(runId) !== parts[0]) {
		return { ok: false, reason: "run-id-mismatch" };
	}

	if (spentTokens.has(parts[0])) {
		return { ok: false, reason: "replayed" };
	}

	if (settings.consume !== false) {
		pruneSpent(now);
		spentTokens.set(parts[0], expiresAt);
	}

	return { ok: true, runId: parts[0] };
}

/** Bỏ các vé đã hết hạn (không cần nhớ nữa) và chặn trần bộ nhớ. */
function pruneSpent(now) {
	for (var entry of spentTokens) {
		if (entry[1] < now) {
			spentTokens.delete(entry[0]);
		}
	}

	while (spentTokens.size >= SPENT_LIMIT) {
		var oldest = spentTokens.keys().next();

		if (oldest.done === true) {
			break;
		}

		spentTokens.delete(oldest.value);
	}
}

/** Chỉ dùng trong test — xoá sổ vé đã tiêu. */
function resetSpentTokens() {
	spentTokens.clear();
}

module.exports = {
	issueRunToken: issueRunToken,
	verifyRunToken: verifyRunToken,
	resetSpentTokens: resetSpentTokens,
	TOKEN_TTL_MS: TOKEN_TTL_MS
};
