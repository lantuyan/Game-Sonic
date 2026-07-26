// Máy trạng thái chuyển động của player — THUẦN SỐ HỌC, không import three.
//
// Tách riêng khỏi Player.ts để cảm giác điều khiển (thứ quyết định game hay/dở)
// kiểm được tất định bằng unit test, thay vì phải "chơi thử rồi cảm nhận".
//
// Trục toạ độ: x theo làn, y theo độ cao. Player luôn đứng yên trên trục z — thế
// giới chạy về phía player (systems/Track.ts).

import { tuning } from "@/tuning";
import type { PlayerPose } from "@/systems/Collision";

export type MotionCommand = "laneLeft" | "laneRight" | "jump" | "slide";

export interface MotionEvents {
	/** Vừa chạm đất sau khi nhảy — dùng để bắn bụi + squash-stretch + tiếng. */
	landed: boolean;
	/** Vừa bắt đầu nhảy. */
	jumped: boolean;
	/** Vừa đổi làn (đã bắt đầu tween). */
	changedLane: boolean;
}

const LANE_COUNT = 3;

function easeOutCubic(progress: number): number {
	return 1 - (1 - progress) ** 3;
}

export class PlayerMotion {
	lane = 1;
	targetLane = 1;
	/** x hiện tại (nội suy giữa 2 làn khi đang tween). */
	x = 0;
	y = 0;

	private tweenFromX = 0;
	private tweenRemainingSec = 0;

	private jumpElapsedSec = 0;
	private jumping = false;
	private fastFalling = false;

	private slideRemainingSec = 0;

	/** Vấp sau khi trả lời sai (plan §4.4) — KHÔNG mất tim, chỉ mất nhịp. */
	private stumbleRemainingSec = 0;

	private readonly events: MotionEvents = { landed: false, jumped: false, changedLane: false };

	get pose(): PlayerPose {
		if (this.jumping === true) {
			return "jump";
		}

		if (this.slideRemainingSec > 0) {
			return "slide";
		}

		return "run";
	}

	get isTweening(): boolean {
		return this.tweenRemainingSec > 0;
	}

	get isStumbling(): boolean {
		return this.stumbleRemainingSec > 0;
	}

	/** Nửa chiều cao hitbox: trượt hạ 50% (plan §4.1). */
	get hitboxHeight(): number {
		return this.pose === "slide" ? tuning.player.height * tuning.player.slideHitboxScale : tuning.player.height;
	}

	/**
	 * Nhận 1 lệnh. Trả về false khi lệnh bị từ chối (đang bận) — người gọi giữ lệnh
	 * lại trong input buffer để thử lại ở bước sau, nhờ vậy lệnh không bị NUỐT.
	 */
	command(action: MotionCommand): boolean {
		if (this.stumbleRemainingSec > 0) {
			return false;
		}

		if (action === "laneLeft" || action === "laneRight") {
			return this.changeLane(action === "laneLeft" ? -1 : 1);
		}

		if (action === "jump") {
			return this.startJump();
		}

		return this.startSlide();
	}

	private changeLane(direction: number): boolean {
		// Đang tween thì chưa nhận lệnh mới — nhưng KHÔNG vứt lệnh đi, để buffer giữ.
		if (this.tweenRemainingSec > 0) {
			return false;
		}

		const nextLane = this.lane + direction;

		if (nextLane < 0 || nextLane > LANE_COUNT - 1) {
			// Đã ở làn ngoài cùng: coi như đã xử lý xong, không giữ lại trong buffer
			// (nếu giữ, người chơi vừa vào được làn giữa sẽ bị đẩy tiếp ra ngoài).
			return true;
		}

		this.tweenFromX = this.x;
		this.targetLane = nextLane;
		this.tweenRemainingSec = tuning.player.laneTweenSec;
		this.events.changedLane = true;
		return true;
	}

	private startJump(): boolean {
		if (this.jumping === true) {
			return false;
		}

		// Nhảy cắt ngang trượt: người chơi đổi ý giữa chừng là hợp lệ.
		this.slideRemainingSec = 0;
		this.jumping = true;
		this.fastFalling = false;
		this.jumpElapsedSec = 0;
		this.events.jumped = true;
		return true;
	}

	private startSlide(): boolean {
		// Vuốt xuống khi đang bay = đập xuống đất ngay (plan §4.1).
		if (this.jumping === true) {
			this.fastFalling = true;
			return true;
		}

		if (this.slideRemainingSec > 0) {
			return false;
		}

		this.slideRemainingSec = tuning.player.slideDurationSec;
		return true;
	}

	/** Bắt đầu vấp 1s sau khi trả lời sai. */
	stumble(): void {
		this.stumbleRemainingSec = tuning.player.stumbleSec;
	}

	/** Ép về mặt đất và bỏ mọi trạng thái (bắt đầu ván / hồi sinh). */
	reset(): void {
		this.lane = 1;
		this.targetLane = 1;
		this.x = 0;
		this.y = 0;
		this.tweenRemainingSec = 0;
		this.jumping = false;
		this.fastFalling = false;
		this.jumpElapsedSec = 0;
		this.slideRemainingSec = 0;
		this.stumbleRemainingSec = 0;
	}

	/** Cập nhật 1 bước vật lý. Trả về các sự kiện xảy ra TRONG bước này. */
	update(deltaSec: number): MotionEvents {
		this.events.landed = false;
		this.events.jumped = false;
		this.events.changedLane = false;

		this.updateLane(deltaSec);
		this.updateJump(deltaSec);

		if (this.slideRemainingSec > 0) {
			this.slideRemainingSec = Math.max(this.slideRemainingSec - deltaSec, 0);
		}

		if (this.stumbleRemainingSec > 0) {
			this.stumbleRemainingSec = Math.max(this.stumbleRemainingSec - deltaSec, 0);
		}

		return this.events;
	}

	private updateLane(deltaSec: number): void {
		if (this.tweenRemainingSec <= 0) {
			this.x = laneToX(this.lane);
			return;
		}

		this.tweenRemainingSec = Math.max(this.tweenRemainingSec - deltaSec, 0);

		const targetX = laneToX(this.targetLane);
		const progress = 1 - this.tweenRemainingSec / tuning.player.laneTweenSec;
		this.x = this.tweenFromX + (targetX - this.tweenFromX) * easeOutCubic(progress);

		if (this.tweenRemainingSec === 0) {
			this.lane = this.targetLane;
			this.x = targetX;
		}
	}

	private updateJump(deltaSec: number): void {
		if (this.jumping === false) {
			this.y = 0;
			return;
		}

		// Fast-fall: tua nhanh phần sau của parabol thay vì đổi hẳn công thức —
		// giữ đúng độ cao đỉnh, chỉ rơi nhanh hơn.
		const step = this.fastFalling === true ? deltaSec * tuning.player.fastFallMultiplier : deltaSec;
		this.jumpElapsedSec += step;

		const duration = tuning.player.jumpDurationSec;

		if (this.jumpElapsedSec >= duration) {
			this.jumping = false;
			this.fastFalling = false;
			this.jumpElapsedSec = 0;
			this.y = 0;
			this.events.landed = true;
			return;
		}

		// Parabol chuẩn: đỉnh đúng giữa quãng, chạm đất đúng lúc hết thời gian.
		const normalized = this.jumpElapsedSec / duration;
		this.y = 4 * tuning.player.jumpHeight * normalized * (1 - normalized);
	}
}

/** x thế giới của tâm làn (0 = trái, 1 = giữa, 2 = phải). */
export function laneToX(lane: number): number {
	return (lane - 1) * tuning.world.laneOffsetX;
}
