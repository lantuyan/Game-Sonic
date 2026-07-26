// Công thức tốc độ — HỢP ĐỒNG với admin (plan §4.5, §7.3.4).
//
// Điểm khác V1 quan trọng: V1 dùng `multiplier²` khiến admin đặt 1.5 lại thành
// 2.25× — phi tuyến, không ai đoán được. V2 dùng TUYẾN TÍNH và tài liệu hoá lại.
//
// Thuần số học, không import three → unit test trực tiếp.

import { tuning } from "@/tuning";

export interface SpeedInputs {
	/** `bundle.gameSpeed` do admin đặt (0.5–2.0). */
	gameSpeed: number;
	/** `QuestionBank.getAdaptiveSpeedFactor(level)` — AI thích ứng sẵn có của V1. */
	adaptiveFactor: number;
}

export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

/**
 * Tốc độ NỀN của ván = clamp(gameSpeed × adaptiveFactor, 0.5, 2.0).
 * Giá trị này cố định suốt ván; ramp và các hiệu ứng tạm nằm ở SpeedController.
 */
export function computeBaseSpeed(inputs: SpeedInputs): number {
	const gameSpeed = Number.isFinite(inputs.gameSpeed) ? inputs.gameSpeed : 1;
	const adaptive = Number.isFinite(inputs.adaptiveFactor) ? inputs.adaptiveFactor : 1;

	return clamp(gameSpeed * adaptive, tuning.speed.baseMin, tuning.speed.baseMax);
}

/** Trần tốc độ sau ramp: nền × 1.4 nhưng không bao giờ vượt 2.0 (plan §4.5). */
export function computeSpeedCeiling(baseSpeed: number): number {
	return Math.min(baseSpeed * tuning.speed.rampCeilingFactor, tuning.speed.baseMax);
}

/** Hệ số ramp sau `elapsedSec`: +5% mỗi 30s, cộng dồn tuyến tính theo bậc. */
export function computeRampFactor(elapsedSec: number): number {
	const steps = Math.floor(Math.max(elapsedSec, 0) / tuning.speed.rampStepSec);
	return 1 + steps * tuning.speed.rampPerStep;
}

export class SpeedController {
	/** Tốc độ nền của ván (không đổi trong ván). */
	baseSpeed = 1;

	private elapsedSec = 0;
	/** Thời gian còn lại của pha hồi tốc sau va chạm. */
	private recoverRemainingSec = 0;
	private feverActive = false;

	start(inputs: SpeedInputs): void {
		this.baseSpeed = computeBaseSpeed(inputs);
		this.elapsedSec = 0;
		this.recoverRemainingSec = 0;
		this.feverActive = false;
	}

	/** Va chạm: tụt tốc rồi hồi dần trong 3s (plan §4.5). */
	onHit(): void {
		this.recoverRemainingSec = tuning.speed.hitRecoverSec;
	}

	setFever(active: boolean): void {
		this.feverActive = active;
	}

	update(deltaSec: number): void {
		this.elapsedSec += deltaSec;

		if (this.recoverRemainingSec > 0) {
			this.recoverRemainingSec = Math.max(this.recoverRemainingSec - deltaSec, 0);
		}
	}

	/** Hệ số tốc độ hiện tại, đã gồm ramp + hồi sau va chạm + Fever. */
	get current(): number {
		const ramped = Math.min(this.baseSpeed * computeRampFactor(this.elapsedSec), computeSpeedCeiling(this.baseSpeed));
		const withFever = this.feverActive === true ? ramped * (1 + tuning.speed.feverBoost) : ramped;

		if (this.recoverRemainingSec <= 0) {
			return Math.min(withFever, tuning.speed.baseMax);
		}

		// Hồi tuyến tính từ hitSlowdownFactor về 1 trong hitRecoverSec giây.
		const recoverProgress = 1 - this.recoverRemainingSec / tuning.speed.hitRecoverSec;
		const penalty = tuning.speed.hitSlowdownFactor + (1 - tuning.speed.hitSlowdownFactor) * recoverProgress;

		return Math.min(withFever * penalty, tuning.speed.baseMax);
	}

	get elapsed(): number {
		return this.elapsedSec;
	}

	/** Chuỗi toast hiển thị khi vào ván (hợp đồng plan §7.3.4). */
	get toastText(): string {
		return `Tốc độ hiện tại: x${this.baseSpeed.toFixed(1)}`;
	}
}
