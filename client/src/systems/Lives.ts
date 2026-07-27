// Mạng & thời gian ân xá (plan §4.4).
//
// Luật cốt lõi của V2 (Q2): mạng CHỈ mất vì va chạm chướng ngại. Trả lời sai
// KHÔNG mất tim — chỉ vỡ streak + vấp 1s + 10s không coin. Ép luật này vào một
// chỗ duy nhất để không system nào "lỡ tay" trừ tim vì lý do khác.

import { tuning } from "@/tuning";

export type HitResult =
	/** Đang bất tử hoặc đang trong ân xá → bỏ qua hoàn toàn. */
	| "ignored"
	/** Khiên đỡ (P0-8) → mất khiên, không mất tim. */
	| "shielded"
	/** Mất 1 tim, vẫn còn mạng. */
	| "damaged"
	/** Hết tim → game over. */
	| "dead";

export class Lives {
	private lives = tuning.scoring.startingLives;
	private invincibleRemainingSec = 0;
	private shields = 0;

	reset(): void {
		this.lives = tuning.scoring.startingLives;
		this.invincibleRemainingSec = 0;
		this.shields = 0;
	}

	get current(): number {
		return this.lives;
	}

	get isInvincible(): boolean {
		return this.invincibleRemainingSec > 0;
	}

	get shieldCount(): number {
		return this.shields;
	}

	addShield(count = 1): void {
		this.shields += count;
	}

	/** Fever cho bất tử tạm thời (P0-8). */
	grantInvincibility(durationSec: number): void {
		this.invincibleRemainingSec = Math.max(this.invincibleRemainingSec, durationSec);
	}

	/** Va chạm chướng ngại. Đây là ĐƯỜNG DUY NHẤT làm mất tim. */
	takeHit(): HitResult {
		if (this.invincibleRemainingSec > 0) {
			return "ignored";
		}

		if (this.shields > 0) {
			this.shields -= 1;
			// Khiên vỡ cũng cho ân xá, nếu không sẽ ăn tiếp cú thứ hai của cùng cụm.
			this.invincibleRemainingSec = tuning.player.invincibleSec;
			return "shielded";
		}

		this.lives -= 1;
		this.invincibleRemainingSec = tuning.player.invincibleSec;

		return this.lives <= 0 ? "dead" : "damaged";
	}

	/**
	 * Trừ 1 tim vì trả lời SAI/TIMEOUT ở Boss Gate (plan §4.3 mục 3, Q12 — P1-1).
	 *
	 * NGOẠI LỆ DUY NHẤT của luật "sai toán không mất mạng" (Q2), và nó cố tình
	 * KHÔNG đi qua khiên hay thời gian bất tử: khiên đỡ chướng ngại, không đỡ được
	 * việc không biết làm bài; còn 3s ân xá sau va chạm mà cũng miễn cả boss thì
	 * người chơi học được cách "đâm một cái rồi vào boss cho an toàn".
	 *
	 * Vẫn cấp ân xá SAU đó để không bị cụm chướng ngại đầu chặng mới ăn tiếp.
	 */
	takeBossPenalty(): HitResult {
		this.lives -= 1;
		this.invincibleRemainingSec = tuning.player.invincibleSec;

		return this.lives <= 0 ? "dead" : "damaged";
	}

	/**
	 * Hồi sinh sau khi trả lời đúng câu hồi sinh (P1-5).
	 *
	 * Cho lại ĐÚNG 1 tim, không phải đầy máu: hồi sinh là cơ hội chơi tiếp, không
	 * phải phần thưởng để nhân đôi độ dài ván. Vẫn đi qua Lives để bất biến "chỉ
	 * file này đụng tới số tim" đứng vững.
	 */
	revive(): void {
		this.lives = Math.max(this.lives, 0) + 1;
	}

	update(deltaSec: number): void {
		if (this.invincibleRemainingSec > 0) {
			this.invincibleRemainingSec = Math.max(this.invincibleRemainingSec - deltaSec, 0);
		}
	}
}
