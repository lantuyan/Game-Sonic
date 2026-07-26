// Toàn bộ điều khiển đi qua đây và phát ra ACTION TRỪU TƯỢNG (plan §4.1).
// Không system nào được nghe trực tiếp keydown/pointerdown.
//
// Hai điểm sống còn:
//   1. Input buffer 150ms — bấm khi đang tween đổi làn KHÔNG bị nuốt (lỗi V1).
//   2. Pointer Events + `touch-action:none` + xử lý `pointercancel` — swipe không
//      bị trình duyệt cướp thành scroll/refresh.

import { tuning } from "@/tuning";

export type GameAction =
	| "laneLeft"
	| "laneRight"
	| "jump"
	| "slide"
	| "pause"
	| "answer1"
	| "answer2"
	| "answer3"
	| "answer4"
	| "confirm";

export type ActionListener = (action: GameAction) => void;

interface BufferedAction {
	action: GameAction;
	expiresAtMs: number;
}

const KEY_MAP: Readonly<Record<string, GameAction>> = {
	ArrowLeft: "laneLeft",
	KeyA: "laneLeft",
	ArrowRight: "laneRight",
	KeyD: "laneRight",
	ArrowUp: "jump",
	KeyW: "jump",
	Space: "jump",
	ArrowDown: "slide",
	KeyS: "slide",
	Escape: "pause",
	Digit1: "answer1",
	Digit2: "answer2",
	Digit3: "answer3",
	Digit4: "answer4",
	Numpad1: "answer1",
	Numpad2: "answer2",
	Numpad3: "answer3",
	Numpad4: "answer4",
	Enter: "confirm"
};

export class Input {
	private readonly target: HTMLElement;
	private readonly listeners = new Set<ActionListener>();
	/** Hàng đợi lệnh chưa tiêu thụ; mỗi phần tử tự hết hạn sau `input.bufferMs`. */
	private readonly buffer: BufferedAction[] = [];

	private pointerId: number | null = null;
	private startX = 0;
	private startY = 0;
	private startTimeMs = 0;
	private swipeHandled = false;
	private enabled = true;

	private readonly handleKeyDown = (event: KeyboardEvent): void => {
		if (this.enabled === false || event.repeat === true) {
			return;
		}

		const action = KEY_MAP[event.code];

		if (action === undefined) {
			return;
		}

		// Space/mũi tên cuộn trang — chặn để không nhảy màn hình khi chơi.
		event.preventDefault();
		this.dispatch(action);
	};

	private readonly handlePointerDown = (event: PointerEvent): void => {
		if (this.enabled === false || this.pointerId !== null) {
			return;
		}

		this.pointerId = event.pointerId;
		this.startX = event.clientX;
		this.startY = event.clientY;
		this.startTimeMs = performance.now();
		this.swipeHandled = false;
		this.target.setPointerCapture(event.pointerId);
	};

	private readonly handlePointerMove = (event: PointerEvent): void => {
		if (this.pointerId !== event.pointerId || this.swipeHandled === true) {
			return;
		}

		const deltaX = event.clientX - this.startX;
		const deltaY = event.clientY - this.startY;
		const elapsedMs = performance.now() - this.startTimeMs;

		if (elapsedMs > tuning.input.maxSwipeMs) {
			this.endPointer(event.pointerId);
			return;
		}

		const action = this.resolveSwipe(deltaX, deltaY, elapsedMs);

		if (action === null) {
			return;
		}

		// Bắn ngay khi vượt ngưỡng (không đợi nhấc tay) — phản hồi nhanh hơn hẳn.
		this.swipeHandled = true;
		this.dispatch(action);
	};

	private readonly handlePointerUp = (event: PointerEvent): void => {
		if (this.pointerId !== event.pointerId) {
			return;
		}

		if (this.swipeHandled === false) {
			const deltaX = event.clientX - this.startX;
			const deltaY = event.clientY - this.startY;
			const elapsedMs = performance.now() - this.startTimeMs;
			const action = this.resolveSwipe(deltaX, deltaY, elapsedMs);

			if (action !== null) {
				this.dispatch(action);
			}
		}

		this.endPointer(event.pointerId);
	};

	private readonly handlePointerCancel = (event: PointerEvent): void => {
		// Cuộc gọi đến / notification / gesture hệ thống: hủy sạch, không bắn lệnh ma.
		this.endPointer(event.pointerId);
	};

	private readonly handleContextMenu = (event: Event): void => {
		event.preventDefault();
	};

	constructor(target: HTMLElement) {
		this.target = target;
		target.style.touchAction = "none";

		window.addEventListener("keydown", this.handleKeyDown);
		target.addEventListener("pointerdown", this.handlePointerDown);
		target.addEventListener("pointermove", this.handlePointerMove);
		target.addEventListener("pointerup", this.handlePointerUp);
		target.addEventListener("pointercancel", this.handlePointerCancel);
		target.addEventListener("contextmenu", this.handleContextMenu);
	}

	private resolveSwipe(deltaX: number, deltaY: number, elapsedMs: number): GameAction | null {
		const absX = Math.abs(deltaX);
		const absY = Math.abs(deltaY);
		const distance = Math.max(absX, absY);

		if (distance === 0 || elapsedMs <= 0) {
			return null;
		}

		const velocityPxPerSec = (distance / elapsedMs) * 1000;
		const passesThreshold =
			distance >= tuning.input.swipeThresholdPx || velocityPxPerSec >= tuning.input.swipeVelocityPxPerSec;

		if (passesThreshold === false) {
			return null;
		}

		if (absX > absY) {
			return deltaX < 0 ? "laneLeft" : "laneRight";
		}

		return deltaY < 0 ? "jump" : "slide";
	}

	private endPointer(pointerId: number): void {
		if (this.target.hasPointerCapture(pointerId) === true) {
			this.target.releasePointerCapture(pointerId);
		}

		this.pointerId = null;
		this.swipeHandled = false;
	}

	private dispatch(action: GameAction): void {
		this.buffer.push({
			action,
			expiresAtMs: performance.now() + tuning.input.bufferMs
		});

		for (const listener of this.listeners) {
			listener(action);
		}
	}

	/** Nghe action tức thời (UI/menu). Gameplay nên dùng `consume()` để có buffer. */
	on(listener: ActionListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/**
	 * Lấy lệnh cũ nhất còn hạn khớp bộ lọc, và xóa nó khỏi hàng đợi.
	 * Player gọi mỗi bước vật lý: đang tween thì trả false, tween xong lệnh vẫn còn.
	 */
	consume(predicate: (action: GameAction) => boolean): GameAction | null {
		const nowMs = performance.now();

		for (let index = 0; index < this.buffer.length; index += 1) {
			const entry = this.buffer[index];

			if (entry === undefined) {
				continue;
			}

			if (entry.expiresAtMs < nowMs) {
				this.buffer.splice(index, 1);
				index -= 1;
				continue;
			}

			if (predicate(entry.action) === true) {
				this.buffer.splice(index, 1);
				return entry.action;
			}
		}

		return null;
	}

	/** Dọn buffer khi chuyển cảnh (không mang lệnh cũ sang ván mới). */
	flush(): void {
		this.buffer.length = 0;
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;

		if (enabled === false) {
			this.flush();
			this.pointerId = null;
		}
	}

	dispose(): void {
		window.removeEventListener("keydown", this.handleKeyDown);
		this.target.removeEventListener("pointerdown", this.handlePointerDown);
		this.target.removeEventListener("pointermove", this.handlePointerMove);
		this.target.removeEventListener("pointerup", this.handlePointerUp);
		this.target.removeEventListener("pointercancel", this.handlePointerCancel);
		this.target.removeEventListener("contextmenu", this.handleContextMenu);
		this.listeners.clear();
		this.buffer.length = 0;
	}
}
