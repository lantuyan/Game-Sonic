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

	update(deltaSec: number): void {
		if (this.invincibleRemainingSec > 0) {
			this.invincibleRemainingSec = Math.max(this.invincibleRemainingSec - deltaSec, 0);
		}
	}
}
