// Điểm & coin (plan §4.4).
//
//   score = quãngĐường×1 + Σ(câuĐúng × question.point × streakMultiplier)
//
// Câu đúng cố ý chiếm ~80–90% tổng điểm: BXH phải đo NĂNG LỰC TOÁN chứ không phải
// khả năng chạy lâu. Thuần số học → unit test trực tiếp.

import { tuning } from "@/tuning";

export interface ScoreSnapshot {
	total: number;
	distanceScore: number;
	answerScore: number;
	coins: number;
	correctCount: number;
	totalAnswered: number;
}

export class Score {
	private distanceM = 0;
	private answerScore = 0;
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
	 * Điểm câu đúng = question.point × streakMultiplier × pointMultiplier.
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

	get distanceScore(): number {
		return Math.floor(this.distanceM * tuning.scoring.pointsPerMeter);
	}

	get total(): number {
		return Math.floor(this.distanceScore + this.answerScore);
	}

	snapshot(): ScoreSnapshot {
		return {
			total: this.total,
			distanceScore: this.distanceScore,
			answerScore: Math.floor(this.answerScore),
			coins: Math.floor(this.coins),
			correctCount: this.correctCount,
			totalAnswered: this.totalAnswered
		};
	}
}
