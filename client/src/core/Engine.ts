// Vòng lặp game — CHỖ DUY NHẤT của fixed timestep 60Hz trong toàn dự án (plan §7.1).
//
// Vì sao fixed timestep: V1 nhân chuyển động với delta thật nên máy yếu (hoặc tab
// bị throttle) làm vật lý sai nhịp. Ở đây `update(dt)` luôn nhận đúng 1/60s, phần
// dư nằm ở accumulator, và `render(alpha)` nội suy để hình vẫn mượt.

const FIXED_DELTA_SEC = 1 / 60;
/** Kẹp delta ≤ 1/30 (plan §4.5): tab ngủ dậy không được bơm hàng trăm bước một lúc. */
const MAX_FRAME_DELTA_SEC = 1 / 30;
/** Chặn "spiral of death" khi máy quá chậm: tối đa số bước vật lý mỗi frame. */
const MAX_STEPS_PER_FRAME = 5;

export interface EngineCallbacks {
	/** Bước vật lý — dt LUÔN bằng fixedDeltaSec. */
	update(deltaSec: number): void;
	/** Vẽ — alpha ∈ [0,1) là phần dư accumulator để nội suy. */
	render(alpha: number): void;
}

export class Engine {
	readonly fixedDeltaSec = FIXED_DELTA_SEC;

	private readonly callbacks: EngineCallbacks;
	private accumulatorSec = 0;
	private previousTimeMs = 0;
	private frameHandle = 0;
	private running = false;
	private paused = false;

	/** Slow-mo trạm câu hỏi (plan §4.3) — nhân vào thời gian nạp accumulator. */
	timeScale = 1;

	/** Số bước vật lý đã chạy — debug overlay đọc. */
	stepCount = 0;
	/** Thời gian frame gần nhất (ms, đã đo thật) — debug overlay đọc. */
	lastFrameMs = 0;

	private readonly handleVisibilityChange = (): void => {
		if (document.visibilityState === "hidden") {
			this.pause();
			return;
		}

		this.resume();
	};

	private readonly loop = (timeMs: number): void => {
		this.frameHandle = requestAnimationFrame(this.loop);

		const rawDeltaSec = (timeMs - this.previousTimeMs) / 1000;
		this.previousTimeMs = timeMs;
		this.lastFrameMs = rawDeltaSec * 1000;

		if (this.paused === true) {
			return;
		}

		const clampedDeltaSec = Math.min(Math.max(rawDeltaSec, 0), MAX_FRAME_DELTA_SEC);
		this.accumulatorSec += clampedDeltaSec * this.timeScale;

		let steps = 0;

		while (this.accumulatorSec >= FIXED_DELTA_SEC && steps < MAX_STEPS_PER_FRAME) {
			this.callbacks.update(FIXED_DELTA_SEC);
			this.accumulatorSec -= FIXED_DELTA_SEC;
			this.stepCount += 1;
			steps += 1;
		}

		if (steps === MAX_STEPS_PER_FRAME) {
			// Máy không theo kịp: vứt phần dư thay vì tích lũy nợ vô hạn.
			this.accumulatorSec = 0;
		}

		this.callbacks.render(this.accumulatorSec / FIXED_DELTA_SEC);
	};

	constructor(callbacks: EngineCallbacks) {
		this.callbacks = callbacks;
	}

	start(): void {
		if (this.running === true) {
			return;
		}

		this.running = true;
		this.paused = false;
		this.resetClock();
		document.addEventListener("visibilitychange", this.handleVisibilityChange);
		this.frameHandle = requestAnimationFrame(this.loop);
	}

	stop(): void {
		if (this.running === false) {
			return;
		}

		this.running = false;
		cancelAnimationFrame(this.frameHandle);
		document.removeEventListener("visibilitychange", this.handleVisibilityChange);
	}

	pause(): void {
		this.paused = true;
	}

	resume(): void {
		if (this.paused === false) {
			return;
		}

		this.paused = false;
		// Tương đương `resetAnimationClock` của V1 (EndlessRunner.htm:533-542):
		// bỏ khoảng thời gian tab bị ẩn, nếu không player "dịch chuyển" khi quay lại.
		this.resetClock();
	}

	get isPaused(): boolean {
		return this.paused;
	}

	get isRunning(): boolean {
		return this.running;
	}

	/** Xóa nợ thời gian tích lũy. Gọi sau mọi lần dừng dài (pause, modal, nạp asset). */
	resetClock(): void {
		this.previousTimeMs = performance.now();
		this.accumulatorSec = 0;
	}
}
