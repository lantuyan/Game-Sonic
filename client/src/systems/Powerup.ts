// 3 power-up lõi của P0 (plan §4.4 Q11): Magnet 8s / Khiên 1 va chạm / ×2 điểm 10s.
//
// Quy tắc chồng (stack) được ép ở đây, một chỗ duy nhất:
//   · cùng loại nhặt lại → LÀM MỚI thời gian, không cộng dồn vô hạn;
//   · khác loại → chạy song song;
//   · Khiên là số lần đỡ, không phải thời gian — Fever bất tử KHÔNG tiêu khiên.
//
// Thuần số học → test được.

import { tuning } from "@/tuning";

/**
 * P1-5 thêm `speedBoost` — chạy nhanh hơn 6 giây, đổi lại khó né hơn.
 * P2-2 thêm `slowClock` — Đồng hồ chậm: thế giới trôi chậm lại 6 giây.
 */
export type PowerupKind = "magnet" | "shield" | "doublePoints" | "speedBoost" | "slowClock";

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
	doublePoints: tuning.powerup.doublePointsSec,
	speedBoost: tuning.learning.speedBoostSec,
	slowClock: tuning.powerup.slowClockSec
};

/**
 * Power-up nào đếm giờ theo THẾ GIỚI thay vì theo đồng hồ thật (P2-2).
 *
 * Chỉ Đồng hồ chậm. Lý do hẹp và cụ thể: giá trị của nó đo bằng quãng đường mà
 * người chơi được đi chậm lại. Nếu nó vẫn hao trong lúc thế giới bị ĐÓNG BĂNG
 * (modal của Boss Gate, câu hồi sinh — cả hai kéo 10–25 giây) thì món quà 6 giây
 * bốc hơi sạch trong lúc người chơi đang đọc đề, và bên ngoài nhìn vào chỉ thấy
 * "nhặt được cái gì đó rồi chẳng thấy gì xảy ra".
 *
 * Magnet/×2 điểm/Tăng tốc GIỮ NGUYÊN cách đếm cũ: đổi chúng là đổi cân bằng của
 * P0-8/P1-5 mà task này không được phép mở lại.
 */
const WORLD_TIME_KINDS: Record<PowerupKind, boolean> = {
	magnet: false,
	shield: false,
	doublePoints: false,
	speedBoost: false,
	slowClock: true
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
		const duration = DURATIONS[kind];
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

	/**
	 * Hệ số tốc độ do power-up Tăng tốc (P1-5).
	 *
	 * CỘNG vào hệ số tốc độ chứ không nhân với trần ramp: Tăng tốc là phần thưởng
	 * ngắn hạn, không được biến thành đường vòng để vượt `speed.baseMax`.
	 */
	get speedMultiplier(): number {
		return this.isActive("speedBoost") === true ? tuning.learning.speedBoostFactor : 1;
	}

	/**
	 * Hệ số làm chậm THẾ GIỚI do Đồng hồ chậm (P2-2).
	 *
	 * Trả về 1 khi không bật. KHÔNG BAO GIỜ trả 0: thế giới đứng im là việc của
	 * phanh Boss Gate, và một power-up thì không được có quyền đó.
	 */
	get worldSlowFactor(): number {
		if (this.isActive("slowClock") === false) {
			return 1;
		}

		// Kẹp lại phòng khi `?debug` chỉnh tay xuống 0 — vẫn phải chạy được.
		return Math.min(Math.max(tuning.powerup.slowClockFactor, 0.1), 1);
	}

	/** Bán kính hút coin: 0 khi không có Magnet và không Fever. */
	magnetRadius(feverActive: boolean): number {
		if (this.isActive("magnet") === true || feverActive === true) {
			return tuning.powerup.magnetRadius;
		}

		return 0;
	}

	/**
	 * @param worldRunning thế giới có đang thật sự chuyển động không. `false` thì
	 *   những power-up đếm theo thế giới (xem `WORLD_TIME_KINDS`) tạm dừng đồng hồ.
	 *   Mặc định `true` để mọi lời gọi cũ giữ nguyên hành vi.
	 */
	update(deltaSec: number, worldRunning = true): void {
		for (const [kind, remaining] of this.timers) {
			if (worldRunning === false && WORLD_TIME_KINDS[kind] === true) {
				continue;
			}

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

export { DURATIONS as POWERUP_DURATIONS, WORLD_TIME_KINDS as POWERUP_WORLD_TIME_KINDS };
