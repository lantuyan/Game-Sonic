// Streak + Fever Mode (plan §4.4, Q10) — móc nối "giỏi toán = bá đạo".
//
// Thuần số học → máy trạng thái test được. Fever là phần thưởng LỚN cho chuỗi
// đúng: bất tử + hút coin + coin×2 + tốc độ +10%, nên luật vào/ra phải chặt.

import { tuning } from "@/tuning";

export type ComboEvent =
	| { type: "streak"; streak: number; multiplier: number }
	| { type: "broken"; previousStreak: number }
	| { type: "fever-start"; durationSec: number }
	| { type: "fever-warning" }
	| { type: "fever-end" };

export class Combo {
	private streak = 0;
	private feverRemainingSec = 0;
	private warningEmitted = false;

	private readonly listeners: Array<(event: ComboEvent) => void> = [];

	onEvent(listener: (event: ComboEvent) => void): void {
		this.listeners.push(listener);
	}

	private emit(event: ComboEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	reset(): void {
		this.streak = 0;
		this.feverRemainingSec = 0;
		this.warningEmitted = false;
	}

	get currentStreak(): number {
		return this.streak;
	}

	get isFeverActive(): boolean {
		return this.feverRemainingSec > 0;
	}

	get feverRemaining(): number {
		return this.feverRemainingSec;
	}

	/** Hệ số nhân điểm: 3 đúng → ×1.5, 5 đúng → ×2 (trần). */
	get multiplier(): number {
		if (this.streak >= tuning.scoring.streakTier2) {
			return tuning.scoring.streakTier2Multiplier;
		}

		if (this.streak >= tuning.scoring.streakTier1) {
			return tuning.scoring.streakTier1Multiplier;
		}

		return 1;
	}

	/** Hệ số coin: Fever cho ×2 (plan §4.4). */
	get coinMultiplier(): number {
		return this.isFeverActive === true ? tuning.scoring.feverCoinMultiplier : 1;
	}

	/**
	 * Trả lời ĐÚNG. Trả về true khi vừa kích hoạt Fever.
	 * Lưu ý: hệ số nhân áp cho câu VỪA trả lời, nên người gọi phải đọc `multiplier`
	 * TRƯỚC khi gọi hàm này nếu muốn giữ đúng ngữ nghĩa V1 — ở V2 ta cố ý áp hệ số
	 * MỚI (thưởng ngay cho câu vừa lên mốc), quyết định này ghi rõ ở đây.
	 */
	registerCorrect(): boolean {
		this.streak += 1;
		this.emit({ type: "streak", streak: this.streak, multiplier: this.multiplier });

		if (this.streak < tuning.scoring.feverStreak || this.isFeverActive === true) {
			return false;
		}

		this.feverRemainingSec = tuning.scoring.feverDurationSec;
		this.warningEmitted = false;
		this.emit({ type: "fever-start", durationSec: this.feverRemainingSec });
		return true;
	}

	/** Trả lời SAI hoặc hết giờ: vỡ streak về ×1 (KHÔNG mất tim — Q2). */
	registerWrong(): void {
		const previousStreak = this.streak;
		this.streak = 0;

		if (previousStreak > 0) {
			this.emit({ type: "broken", previousStreak });
		}
	}

	update(deltaSec: number): void {
		if (this.feverRemainingSec <= 0) {
			return;
		}

		this.feverRemainingSec = Math.max(this.feverRemainingSec - deltaSec, 0);

		// Cảnh báo 2s cuối để Fever "kết thúc êm", không cắt phụt.
		if (
			this.warningEmitted === false &&
			this.feverRemainingSec > 0 &&
			this.feverRemainingSec <= tuning.scoring.feverWarningSec
		) {
			this.warningEmitted = true;
			this.emit({ type: "fever-warning" });
		}

		if (this.feverRemainingSec === 0) {
			this.emit({ type: "fever-end" });
		}
	}
}
