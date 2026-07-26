// 3 power-up lõi của P0 (plan §4.4 Q11): Magnet 8s / Khiên 1 va chạm / ×2 điểm 10s.
//
// Quy tắc chồng (stack) được ép ở đây, một chỗ duy nhất:
//   · cùng loại nhặt lại → LÀM MỚI thời gian, không cộng dồn vô hạn;
//   · khác loại → chạy song song;
//   · Khiên là số lần đỡ, không phải thời gian — Fever bất tử KHÔNG tiêu khiên.
//
// Thuần số học → test được.

import { tuning } from "@/tuning";

export type PowerupKind = "magnet" | "shield" | "doublePoints";

export interface PowerupState {
	kind: PowerupKind;
	remainingSec: number;
}

export type PowerupEvent =
	| { type: "started"; kind: PowerupKind; durationSec: number }
	| { type: "ended"; kind: PowerupKind };

const DURATIONS: Record<PowerupKind, number> = {
	magnet: tuning.powerup.magnetSec,
	shield: 0,
	doublePoints: tuning.powerup.doublePointsSec
};

export class Powerups {
	private readonly timers = new Map<PowerupKind, number>();
	private shieldCharges = 0;

	private readonly listeners: Array<(event: PowerupEvent) => void> = [];

	onEvent(listener: (event: PowerupEvent) => void): void {
		this.listeners.push(listener);
	}

	private emit(event: PowerupEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	reset(): void {
		this.timers.clear();
		this.shieldCharges = 0;
	}

	collect(kind: PowerupKind): void {
		if (kind === "shield") {
			this.shieldCharges = Math.max(this.shieldCharges, tuning.powerup.shieldHits);
			this.emit({ type: "started", kind, durationSec: 0 });
			return;
		}

		// Nhặt lại cùng loại: đặt lại đồng hồ về đủ thời lượng (không cộng dồn).
		const duration = kind === "magnet" ? tuning.powerup.magnetSec : tuning.powerup.doublePointsSec;
		this.timers.set(kind, duration);
		this.emit({ type: "started", kind, durationSec: duration });
	}

	isActive(kind: PowerupKind): boolean {
		if (kind === "shield") {
			return this.shieldCharges > 0;
		}

		return (this.timers.get(kind) ?? 0) > 0;
	}

	remaining(kind: PowerupKind): number {
		if (kind === "shield") {
			return this.shieldCharges;
		}

		return this.timers.get(kind) ?? 0;
	}

	/** Dùng 1 lần đỡ của khiên. Trả về true khi khiên đã chặn cú va chạm này. */
	consumeShield(): boolean {
		if (this.shieldCharges <= 0) {
			return false;
		}

		this.shieldCharges -= 1;
		this.emit({ type: "ended", kind: "shield" });
		return true;
	}

	/** Hệ số nhân điểm do power-up (×2 khi đang bật). */
	get pointMultiplier(): number {
		return this.isActive("doublePoints") === true ? tuning.powerup.doublePointsMultiplier : 1;
	}

	/** Bán kính hút coin: 0 khi không có Magnet và không Fever. */
	magnetRadius(feverActive: boolean): number {
		if (this.isActive("magnet") === true || feverActive === true) {
			return tuning.powerup.magnetRadius;
		}

		return 0;
	}

	update(deltaSec: number): void {
		for (const [kind, remaining] of this.timers) {
			const next = Math.max(remaining - deltaSec, 0);

			if (next === 0) {
				this.timers.delete(kind);
				this.emit({ type: "ended", kind });
				continue;
			}

			this.timers.set(kind, next);
		}
	}

	/** Danh sách đang chạy — HUD hiển thị timer. */
	get active(): PowerupState[] {
		const states: PowerupState[] = [];

		for (const [kind, remainingSec] of this.timers) {
			states.push({ kind, remainingSec });
		}

		if (this.shieldCharges > 0) {
			states.push({ kind: "shield", remainingSec: this.shieldCharges });
		}

		return states;
	}
}

export { DURATIONS as POWERUP_DURATIONS };
