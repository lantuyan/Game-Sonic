// Chu trình Cổng Toán (plan §4.3) — nhiệm vụ đinh của V2.
//
//   idle → telegraph(3–4s) → station(slow-mo, dựng cổng) → feedback(2.5s) → idle
//                                     ↓ hết giờ chưa chọn
//                               softGate: lần 1 mở modal 10s (không tính timeout),
//                                         lần 2+ tính timeout
//
// Máy trạng thái tách khỏi phần hình: `QuizGateController` chỉ giữ thời gian và
// quyết định, còn RunScene lo dựng/ẩn cổng. Nhờ vậy toàn bộ luật test được.

import { tuning } from "@/tuning";
import { computeStationDurationSec, SoftGateTracker, type GateLayout, type QuizMode } from "@/systems/quizRules";
import {
	computeGateIntervalSec,
	pickQueueIndexWithShift,
	shouldRouteToModalForSlowReader
} from "@/systems/learningRules";
import type { LegacyQuestion } from "@/integration/questionBank.d";

export type QuizPhase = "idle" | "telegraph" | "station" | "modal" | "feedback";

export type QuizOutcome = "correct" | "wrong" | "timeout";

export interface QuizGateCallbacks {
	/** Bắt đầu telegraph: HUD hiện đề, dọn chướng ngại vùng trạm. */
	onTelegraph(question: LegacyQuestion): void;
	/** Vào trạm: bật slow-mo, dựng cổng. */
	onStationOpen(question: LegacyQuestion, layout: GateLayout, durationSec: number): void;
	/** Chuyển sang modal (đề dài, hoặc cổng mềm cứu). */
	onModalOpen(question: LegacyQuestion, durationSec: number, isRescue: boolean): void;
	/** Đã có kết quả — phát hiệu ứng, ghi nhận điểm. */
	onResolved(question: LegacyQuestion, outcome: QuizOutcome, selectedAnswer: string | null): void;
	/** Kết thúc feedback, trả tốc độ về bình thường. */
	onClosed(): void;
	/** Không còn câu nào — chuyển "chạy thuần + ôn câu sai". */
	onQueueEmpty(): void;
}

export class QuizGateController {
	private phase: QuizPhase = "idle";
	private timerSec = 0;
	private nextGateInSec = 0;

	private current: LegacyQuestion | null = null;
	private currentMode: QuizMode = "gate";
	private currentLayout: GateLayout | null = null;
	private selectedAnswer: string | null = null;
	private stationDurationSec = 0;
	private answeredAtMs = 0;
	private questionShownAtMs = 0;

	private readonly softGate = new SoftGateTracker();
	private readonly callbacks: QuizGateCallbacks;

	/** Hàng đợi câu — POP TỪ CUỐI MẢNG (hợp đồng plan §7.3.1). */
	private queue: LegacyQuestion[] = [];
	private avgAnswerMs: number | null = null;
	private levelQuizMode: QuizMode = "gate";
	private queueExhaustedNotified = false;
	/**
	 * Accuracy dùng cho luật tần suất cổng (P1-5). Lấy từ RunScene mỗi lần hẹn trạm
	 * mới, để nhịp bám theo em NGAY TRONG VÁN chứ không chỉ theo hồ sơ ván trước.
	 */
	private accuracyProvider: (() => number | null) | null = null;
	/** micro-DDA (P1-5): lệch bậc cho lượt bốc kế tiếp. */
	private difficultyShiftProvider: (() => number) | null = null;

	constructor(callbacks: QuizGateCallbacks) {
		this.callbacks = callbacks;
	}

	/** Bắt đầu ván mới. */
	start(queue: LegacyQuestion[], options: { avgAnswerMs: number | null; levelQuizMode: QuizMode }): void {
		this.queue = queue.slice();
		this.avgAnswerMs = options.avgAnswerMs;
		this.levelQuizMode = options.levelQuizMode;
		this.softGate.reset();
		this.phase = "idle";
		this.current = null;
		this.currentLayout = null;
		this.selectedAnswer = null;
		this.queueExhaustedNotified = false;
		this.scheduleNextGate();
	}

	/** P1-5 — nguồn accuracy cho luật tần suất cổng. */
	setAccuracyProvider(provider: (() => number | null) | null): void {
		this.accuracyProvider = provider;
	}

	/** P1-5 — nguồn `shift` của micro-DDA cho lượt bốc kế tiếp. */
	setDifficultyShiftProvider(provider: (() => number) | null): void {
		this.difficultyShiftProvider = provider;
	}

	private scheduleNextGate(): void {
		const accuracy = this.accuracyProvider === null ? null : this.accuracyProvider();

		if (accuracy !== null) {
			// P1-5: làm đúng nhiều thì gặp cổng dày hơn, sai nhiều thì thưa ra.
			// ±3s ngẫu nhiên để nhịp không thành máy đếm đoán được.
			const base = computeGateIntervalSec(accuracy);
			this.nextGateInSec = Math.max(base + (Math.random() * 6 - 3), tuning.quiz.gateIntervalMinSec);
			return;
		}

		// Chưa có dữ liệu (mấy trạm đầu ván): giữ nguyên dải P0 25–35s.
		const span = tuning.quiz.gateIntervalMaxSec - tuning.quiz.gateIntervalMinSec;
		this.nextGateInSec = tuning.quiz.gateIntervalMinSec + Math.random() * span;
	}

	/** Cho test bơm khoảng thời gian cố định thay vì ngẫu nhiên. */
	forceNextGateIn(seconds: number): void {
		this.nextGateInSec = seconds;
	}

	get currentPhase(): QuizPhase {
		return this.phase;
	}

	get currentQuestion(): LegacyQuestion | null {
		return this.current;
	}

	get layout(): GateLayout | null {
		return this.currentLayout;
	}

	get remainingSec(): number {
		return this.timerSec;
	}

	get isBusy(): boolean {
		return this.phase !== "idle";
	}

	/** Đang trong trạm slow-mo? RunScene dùng để đặt engine.timeScale. */
	get isSlowMotion(): boolean {
		return this.phase === "station";
	}

	update(deltaSec: number, nowMs: number, buildLayout: (question: LegacyQuestion) => GateLayout): void {
		if (this.phase === "idle") {
			this.nextGateInSec -= deltaSec;

			if (this.nextGateInSec <= 0) {
				this.beginTelegraph(nowMs, buildLayout);
			}

			return;
		}

		this.timerSec -= deltaSec;

		if (this.timerSec > 0) {
			return;
		}

		if (this.phase === "telegraph") {
			this.openStation(buildLayout);
			return;
		}

		if (this.phase === "station") {
			this.onStationTimeout(nowMs);
			return;
		}

		if (this.phase === "modal") {
			// Modal hết giờ: luôn tính timeout (kể cả khi đang là modal cứu, vì
			// người chơi đã được cho thêm 10s rồi).
			this.resolve("timeout", null, nowMs);
			return;
		}

		// feedback xong.
		this.phase = "idle";
		this.current = null;
		this.currentLayout = null;
		this.scheduleNextGate();
		this.callbacks.onClosed();
	}

	private beginTelegraph(nowMs: number, buildLayout: (question: LegacyQuestion) => GateLayout): void {
		// micro-DDA (P1-5) chọn câu lệch bậc TRONG hàng đợi; shift = 0 thì đúng bằng
		// `queue.pop()` như P0, nên hợp đồng "pop từ cuối mảng" vẫn giữ nguyên.
		const shift = this.difficultyShiftProvider === null ? 0 : this.difficultyShiftProvider();
		const pickIndex = pickQueueIndexWithShift(this.queue, shift);
		const question = pickIndex === -1 ? null : (this.queue.splice(pickIndex, 1)[0] ?? null);

		if (question === null) {
			if (this.queueExhaustedNotified === false) {
				this.queueExhaustedNotified = true;
				this.callbacks.onQueueEmpty();
			}

			// Hết câu → không hẹn trạm nữa, chuyển "chạy thuần".
			this.nextGateInSec = Number.POSITIVE_INFINITY;
			return;
		}

		this.current = question;
		this.selectedAnswer = null;
		this.questionShownAtMs = nowMs;
		this.currentMode = this.routeCurrent();

		if (this.currentMode === "modal") {
			// Đề dài / lớp đặt modal: bỏ qua telegraph + trạm, mở modal ngay.
			this.phase = "modal";
			this.timerSec = question.time;
			this.callbacks.onModalOpen(question, question.time, false);
			return;
		}

		this.phase = "telegraph";
		this.timerSec = tuning.quiz.telegraphSec;
		this.callbacks.onTelegraph(question);
		// Dựng sẵn layout để RunScene dọn đường và chuẩn bị cổng ngay từ telegraph.
		this.currentLayout = buildLayout(question);
	}

	private routeCurrent(): QuizMode {
		const question = this.current;

		if (question === null) {
			return "gate";
		}

		if (this.levelQuizMode === "modal") {
			return "modal";
		}

		// P1-5 — em đọc chậm gặp câu medium+ thì mở modal: trên cổng 3D đề trôi về
		// phía mình, đọc không kịp là mất câu chứ không phải không biết làm.
		if (shouldRouteToModalForSlowReader(question, this.avgAnswerMs) === true) {
			return "modal";
		}

		return question.question.length > tuning.quiz.modalLengthThreshold ? "modal" : "gate";
	}

	private openStation(buildLayout: (question: LegacyQuestion) => GateLayout): void {
		const question = this.current;

		if (question === null) {
			this.phase = "idle";
			return;
		}

		const layout = this.currentLayout ?? buildLayout(question);
		this.currentLayout = layout;
		this.stationDurationSec = computeStationDurationSec(question, this.avgAnswerMs);
		this.phase = "station";
		this.timerSec = this.stationDurationSec;
		this.callbacks.onStationOpen(question, layout, this.stationDurationSec);
	}

	private onStationTimeout(nowMs: number): void {
		const question = this.current;

		if (question === null) {
			this.phase = "idle";
			return;
		}

		// Cổng mềm: lần đầu mỗi ván được modal 10s cứu, KHÔNG tính timeout.
		if (this.softGate.onStationExpired() === "rescue") {
			this.phase = "modal";
			this.timerSec = tuning.quiz.softGateModalSec;
			this.callbacks.onModalOpen(question, tuning.quiz.softGateModalSec, true);
			return;
		}

		this.resolve("timeout", null, nowMs);
	}

	/** Người chơi chọn đáp án (lái vào làn ở trạm, hoặc bấm nút ở modal). */
	answer(answerKey: string, nowMs: number): void {
		const question = this.current;

		if (question === null || (this.phase !== "station" && this.phase !== "modal")) {
			return;
		}

		this.selectedAnswer = answerKey;
		this.resolve(answerKey === question.correctAnswer ? "correct" : "wrong", answerKey, nowMs);
	}

	/** Chạy qua làn TRỐNG (không có cổng) — không tính là trả lời (plan §4.3). */
	passEmptyLane(): void {
		// Cố ý không làm gì: trạm vẫn đếm giờ.
	}

	private resolve(outcome: QuizOutcome, selectedAnswer: string | null, nowMs: number): void {
		const question = this.current;

		if (question === null) {
			return;
		}

		this.answeredAtMs = nowMs;
		this.phase = "feedback";
		this.timerSec = tuning.quiz.feedbackSec;
		this.callbacks.onResolved(question, outcome, selectedAnswer);
	}

	get answerElapsedMs(): number {
		return Math.max(this.answeredAtMs - this.questionShownAtMs, 0);
	}

	get remainingQuestions(): number {
		return this.queue.length;
	}

	get softGateUsed(): boolean {
		return this.softGate.hasUsedRescue;
	}

	get mode(): QuizMode {
		return this.currentMode;
	}

	get selected(): string | null {
		return this.selectedAnswer;
	}
}
