"use strict";

// Kiểm chéo tính hợp lý của điểm (P1-4, thống nhất với plan §7.4).
//
//   score ≤ durationMs/1000 × MAX_SPEED_MPS
//           + correctCount × maxPoint(level) × ANSWER_POINT_MULTIPLIER × MAX_ANSWER_MULTIPLIER
//   (dung sai 10%)   và   durationMs ≥ 45s
//
// Vi phạm KHÔNG bị từ chối — điểm vẫn được nhận nhưng `verified = false` và ghi log.
// Đây là chủ ý: chặn thẳng thì một máy chậm, một lần treo tab, hay một công thức
// tính điểm mà ta chưa lường tới sẽ biến thành "học sinh ngoan bị tố gian lận".
// Cờ `verified` cho giáo viên tự quyết, còn game thì không bao giờ gãy.

/**
 * Tốc độ trần quy ra "mét mỗi giây điểm quãng đường".
 * = `tuning.speed.unitsPerSecondAtOne` × `tuning.speed.baseMax` × `rampCeilingFactor`
 * = 15.5 × 2 × 1.4 = 43.4. Client tính 1 điểm/mét nên đây cũng là điểm/giây tối đa
 * từ quãng đường.
 *
 * ⚠ Đổi 3 hằng số đó trong `client/src/tuning.ts` thì PHẢI đổi ở đây —
 * `test/anticheat.test.js` canh cho khỏi quên.
 */
var MAX_SPEED_MPS = 43.4;

/**
 * P2-8 — thang điểm câu hỏi. = `tuning.scoring.answerPointMultiplier` của client.
 *
 * ⚠ Đổi con số đó trong `client/src/tuning.ts` mà quên ở đây thì trần tụt xuống
 * 1/300 điểm câu hỏi thật ⇒ **mọi học sinh trả lời đúng đều bị đánh dấu nghi vấn**.
 * `test/anticheat.test.js` và `test/balance.test.js` canh cho khỏi quên.
 */
var ANSWER_POINT_MULTIPLIER = 300;

/**
 * Hệ số nhân LỚN NHẤT một câu đúng có thể ăn:
 *   `scoring.streakTier2Multiplier` (2, streak ≥5) × `powerup.doublePointsMultiplier` (2).
 *
 * Trước P2-8 chỗ này là hằng `2` với chú thích "×2 cho streak trần" — **thiếu mất
 * power-up Nhân đôi điểm**, vốn nhân thẳng vào `answerScore` (`Score.pointMultiplier`).
 * Hồi đó không lộ ra vì điểm câu hỏi quá nhỏ so với phần quãng đường nên dung sai
 * nuốt hết; sau khi câu hỏi thành 80–90% tổng điểm thì đúng học sinh giỏi nhất —
 * chuỗi đúng dài + nhặt được Nhân đôi điểm — mới là người bị tố oan.
 */
var MAX_ANSWER_MULTIPLIER = 4;

/**
 * Dung sai 10% — đủ để nuốt sai số làm tròn và các khoản thưởng lặt vặt.
 *
 * Near-miss (`Score.addBonus`) CỐ Ý không có mặt trong công thức trần: nó phụ thuộc
 * số chướng ngại lướt sát, thứ server không đo được. Nó được nuốt bởi phần dôi của
 * số hạng quãng đường — trần dùng tốc độ TRẦN 43.4 điểm/giây trong khi ván mặc định
 * chỉ chạy ~18 điểm/giây, tức mỗi giây đã dôi sẵn ~25 điểm cho phần thưởng lặt vặt.
 */
var TOLERANCE = 1.1;

/** Ván ngắn hơn 45s không thể có điểm thật (plan §7.4). */
var MIN_DURATION_MS = 45000;

/**
 * @param {object} payload  score/correctCount/durationMs đã chuẩn hoá.
 * @param {number} maxPoint điểm cao nhất một câu của lớp đó.
 * @returns {{plausible: boolean, reason: string|null, ceiling: number}}
 */
function checkPlausibility(payload, maxPoint) {
	var score = Number(payload.score) || 0;
	var correctCount = Number(payload.correctCount) || 0;
	var durationMs = Number(payload.durationMs) || 0;
	var safeMaxPoint = Number(maxPoint);

	if (isFinite(safeMaxPoint) === false || safeMaxPoint <= 0) {
		safeMaxPoint = 100;
	}

	// Trần: điểm quãng đường tối đa + điểm câu hỏi tối đa (streak trần × Nhân đôi điểm).
	var ceiling =
		((durationMs / 1000) * MAX_SPEED_MPS +
			correctCount * safeMaxPoint * ANSWER_POINT_MULTIPLIER * MAX_ANSWER_MULTIPLIER) *
		TOLERANCE;

	if (durationMs < MIN_DURATION_MS) {
		return { plausible: false, reason: "duration-too-short", ceiling: ceiling };
	}

	if (score > ceiling) {
		return { plausible: false, reason: "score-above-ceiling", ceiling: ceiling };
	}

	return { plausible: true, reason: null, ceiling: ceiling };
}

module.exports = {
	checkPlausibility: checkPlausibility,
	MAX_SPEED_MPS: MAX_SPEED_MPS,
	ANSWER_POINT_MULTIPLIER: ANSWER_POINT_MULTIPLIER,
	MAX_ANSWER_MULTIPLIER: MAX_ANSWER_MULTIPLIER,
	MIN_DURATION_MS: MIN_DURATION_MS,
	TOLERANCE: TOLERANCE
};
