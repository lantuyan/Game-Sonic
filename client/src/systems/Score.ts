// Điểm & coin (plan §4.4).
//
//   score = quãngĐường×1 + Σ(câuĐúng × answerPointValue(question.point) × streakMultiplier)
//
// Câu đúng cố ý chiếm ~80–90% tổng điểm: BXH phải đo NĂNG LỰC TOÁN chứ không phải
// khả năng chạy lâu. Thuần số học → unit test trực tiếp.
//
// P2-8: `Score` vẫn là SỐ HỌC THUẦN — nó nhân đúng những gì được đưa vào và không
// biết gì về thang điểm. Việc quy đổi `question.point` sang thang của bảng xếp hạng
// nằm ở `answerPointValue()` bên dưới và được gọi ở nơi có câu hỏi thật
// (`scenes/RunScene.ts`). Tách như vậy để `recordAnswer(true, 100, 2) === 200` vẫn
// đọc ra đúng nghĩa "point × streak", không phải một phép nhân ẩn.

import { tuning } from "@/tuning";

/**
 * Quy đổi `question.point` (10/15/20/25 trong ngân hàng thật) sang thang điểm bảng
 * xếp hạng của V2 — xem `tuning.scoring.answerPointMultiplier` để biết vì sao.
 *
 * Giá trị lạ (thiếu field, NaN) → 0 thay vì NaN: một câu hỏi nhập thiếu điểm không
 * được phép biến cả ván thành `NaN` trên bảng xếp hạng.
 */
export function answerPointValue(questionPoint: number): number {
	if (Number.isFinite(questionPoint) === false || questionPoint <= 0) {
		return 0;
	}

	return questionPoint * tuning.scoring.answerPointMultiplier;
}

export interface ScoreSnapshot {
	total: number;
	distanceScore: number;
	answerScore: number;
	/** Thưởng ngoài lề: near-miss (P1-1)… — tách riêng để P1 cân lại được. */
	bonusScore: number;
	coins: number;
	correctCount: number;
	totalAnswered: number;
}

export class Score {
	private distanceM = 0;
	private answerScore = 0;
	private bonusScore = 0;
	private coins = 0;
	private correctCount = 0;
	private totalAnswered = 0;

	/** Nhân đôi điểm khi có power-up ×2 (P0-8). */
	private pointMultiplier = 1;
	/** Nhân đôi coin khi Fever (P0-8). */
	private coinMultiplier = 1;

	reset(): void {
		this.distanceM = 0;
		this.answerScore = 0;
		this.bonusScore = 0;
		this.coins = 0;
		this.correctCount = 0;
		this.totalAnswered = 0;
		this.pointMultiplier = 1;
		this.coinMultiplier = 1;
	}

	setDistance(distanceM: number): void {
		this.distanceM = Math.max(distanceM, 0);
	}

	setPointMultiplier(multiplier: number): void {
		this.pointMultiplier = multiplier;
	}

	setCoinMultiplier(multiplier: number): void {
		this.coinMultiplier = multiplier;
	}

	/** Nhặt coin. Trả về số coin thực cộng (đã nhân hệ số Fever). */
	addCoin(count = 1): number {
		const gained = count * tuning.scoring.coinPerPickup * this.coinMultiplier;
		this.coins += gained;
		return gained;
	}

	/**
	 * Ghi nhận 1 câu trả lời.
	 * Điểm câu đúng = questionPoint × streakMultiplier × pointMultiplier.
	 *
	 * `questionPoint` đã phải đi qua `answerPointValue()` ở phía gọi.
	 */
	recordAnswer(correct: boolean, questionPoint: number, streakMultiplier: number): number {
		this.totalAnswered += 1;

		if (correct === false) {
			return 0;
		}

		this.correctCount += 1;
		const gained = questionPoint * streakMultiplier * this.pointMultiplier;
		this.answerScore += gained;
		this.coins += tuning.scoring.coinPerCorrectAnswer * this.coinMultiplier;
		return gained;
	}

	/**
	 * Thưởng thẳng vào điểm, KHÔNG qua hệ số streak/power-up (near-miss — P1-1).
	 * Near-miss là thưởng kỹ năng lái; nhân nó với multiplier của toán sẽ làm loãng
	 * ý nghĩa "BXH đo năng lực toán".
	 */
	addBonus(points: number): number {
		if (Number.isFinite(points) === false || points <= 0) {
			return 0;
		}

		this.bonusScore += points;
		return points;
	}

	get distanceScore(): number {
		return Math.floor(this.distanceM * tuning.scoring.pointsPerMeter);
	}

	get total(): number {
		return Math.floor(this.distanceScore + this.answerScore + this.bonusScore);
	}

	snapshot(): ScoreSnapshot {
		return {
			total: this.total,
			distanceScore: this.distanceScore,
			answerScore: Math.floor(this.answerScore),
			bonusScore: Math.floor(this.bonusScore),
			coins: Math.floor(this.coins),
			correctCount: this.correctCount,
			totalAnswered: this.totalAnswered
		};
	}
}
