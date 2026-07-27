// Chu trình Boss Gate (plan §4.3 mục 3 — P1-1).
//
//   idle ──(hết chặng ~2.5–3 phút, và cổng thường đang rảnh)──► intro (cắt cảnh 2.6s)
//        ◄── countdown(3-2-1) ◄── outro(2s: phá khiên+mưa coin | trùm bỏ chạy) ◄── question(modal)
//
// Cùng kiểu tách lớp như QuizGateController: file này CHỈ giữ thời gian + quyết định,
// phần hình (model boss, camera dolly, mưa coin) do RunScene lo. Nhờ vậy toàn bộ luật
// — kể cả "sai trừ đúng 1 tim" — kiểm được bằng `node --test`.
//
// Ràng buộc quan trọng: boss KHÔNG được chen vào giữa một trạm Cổng Toán đang mở.
// `update()` nhận cờ `canStart`; hết giờ mà cổng đang bận thì boss chờ, không huỷ.

import { tuning } from "@/tuning";
import { computeBossQuestionSec } from "@/systems/bossRules";
import type { LegacyQuestion } from "@/integration/questionBank.d";

export type BossPhase = "idle" | "intro" | "question" | "outro" | "countdown";

export type BossOutcome = "correct" | "wrong" | "timeout";

export interface BossCallbacks {
	/** Trùm chặn đường: bắt đầu cắt cảnh (camera dolly + nhạc dồn). */
	onIntro(question: LegacyQuestion): void;
	/** Mở modal câu hard/expert. */
	onQuestion(question: LegacyQuestion, durationSec: number): void;
	/** Có kết quả — RunScene trừ tim (nếu sai) và ghi markQuestionResult. */
	onResolved(question: LegacyQuestion, outcome: BossOutcome, selectedAnswer: string | null): void;
	/** Hết outro: đổi biome rồi vào đếm ngược. `victory` chỉ để chọn hiệu ứng. */
	onStageAdvance(victory: boolean): void;
	/** Mỗi giây đếm ngược một lần: 3 → 2 → 1. */
	onCountdown(secondsLeft: number): void;
	/** Boss xong hẳn, trả điều khiển về chạy thường. */
	onClosed(): void;
	/** Bốc câu cho boss. null = hết câu → bỏ qua chặng boss này. */
	pickQuestion(): LegacyQuestion | null;
}

export class BossGateController {
	private phase: BossPhase = "idle";
	private timerSec = 0;
	private nextBossInSec = 0;
	private current: LegacyQuestion | null = null;
	private selectedAnswer: string | null = null;
	private lastOutcome: BossOutcome | null = null;
	private questionShownAtMs = 0;
	private answeredAtMs = 0;
	private countdownShown = 0;
	private stage = 0;

	private readonly callbacks: BossCallbacks;
	private readonly random: () => number;

	constructor(callbacks: BossCallbacks, random: () => number = Math.random) {
		this.callbacks = callbacks;
		this.random = random;
	}

	start(): void {
		this.phase = "idle";
		this.current = null;
		this.selectedAnswer = null;
		this.lastOutcome = null;
		this.stage = 0;
		this.scheduleNext();
	}

	private scheduleNext(): void {
		const span = tuning.boss.intervalMaxSec - tuning.boss.intervalMinSec;
		this.nextBossInSec = tuning.boss.intervalMinSec + this.random() * span;
	}

	/** Cho test (và `?debug`) ép boss tới sớm thay vì chờ 2.5 phút. */
	forceNextBossIn(seconds: number): void {
		this.nextBossInSec = seconds;
	}

	get currentPhase(): BossPhase {
		return this.phase;
	}

	get isBusy(): boolean {
		return this.phase !== "idle";
	}

	/** Modal boss đang mở → RunScene đóng băng thế giới (timeScale = 0). */
	get isFrozen(): boolean {
		return this.phase === "question";
	}

	/** Cắt cảnh vào/ra → camera chuyển sang góc boss. */
	get isCinematic(): boolean {
		return this.phase === "intro" || this.phase === "outro";
	}

	get currentQuestion(): LegacyQuestion | null {
		return this.current;
	}

	get remainingSec(): number {
		return this.timerSec;
	}

	get stageIndex(): number {
		return this.stage;
	}

	get outcome(): BossOutcome | null {
		return this.lastOutcome;
	}

	get answerElapsedMs(): number {
		return Math.max(this.answeredAtMs - this.questionShownAtMs, 0);
	}

	/**
	 * @param canStart cổng Toán đang rảnh? Boss chỉ được xen vào khi rảnh — nếu không
	 *   người chơi sẽ thấy hai đề chồng nhau trên màn hình.
	 */
	update(deltaSec: number, nowMs: number, canStart: boolean): void {
		if (tuning.boss.enabled !== 1) {
			return;
		}

		if (this.phase === "idle") {
			this.nextBossInSec -= deltaSec;

			if (this.nextBossInSec <= 0 && canStart === true) {
				this.beginIntro(nowMs);
			}

			return;
		}

		if (this.phase === "countdown") {
			this.updateCountdown(deltaSec);
			return;
		}

		this.timerSec -= deltaSec;

		if (this.timerSec > 0) {
			return;
		}

		if (this.phase === "intro") {
			this.openQuestion(nowMs);
			return;
		}

		if (this.phase === "question") {
			this.resolve("timeout", null, nowMs);
			return;
		}

		// outro xong: sang chặng mới rồi đếm ngược.
		this.stage += 1;
		this.callbacks.onStageAdvance(this.lastOutcome === "correct");
		this.phase = "countdown";
		this.timerSec = tuning.boss.countdownSec;
		this.countdownShown = Math.ceil(tuning.boss.countdownSec) + 1;
	}

	private updateCountdown(deltaSec: number): void {
		this.timerSec -= deltaSec;

		const secondsLeft = Math.ceil(Math.max(this.timerSec, 0));

		if (secondsLeft < this.countdownShown && secondsLeft > 0) {
			this.countdownShown = secondsLeft;
			this.callbacks.onCountdown(secondsLeft);
		}

		if (this.timerSec > 0) {
			return;
		}

		this.phase = "idle";
		this.current = null;
		this.scheduleNext();
		this.callbacks.onClosed();
	}

	private beginIntro(nowMs: number): void {
		const question = this.callbacks.pickQuestion();

		if (question === null) {
			// Hết câu: bỏ qua chặng boss này, hẹn lại chặng sau (biết đâu review queue
			// nạp thêm). Không bao giờ để `nextBossInSec` âm dồn rồi bắn liên tiếp.
			this.scheduleNext();
			return;
		}

		this.current = question;
		this.selectedAnswer = null;
		this.lastOutcome = null;
		this.questionShownAtMs = nowMs;
		this.phase = "intro";
		this.timerSec = tuning.boss.introSec;
		this.callbacks.onIntro(question);
	}

	private openQuestion(nowMs: number): void {
		const question = this.current;

		if (question === null) {
			this.phase = "idle";
			this.scheduleNext();
			return;
		}

		const durationSec = computeBossQuestionSec(question);
		this.phase = "question";
		this.timerSec = durationSec;
		// Đồng hồ trả lời tính từ lúc THẤY ĐỀ, không tính 2.6s cắt cảnh.
		this.questionShownAtMs = nowMs;
		this.callbacks.onQuestion(question, durationSec);
	}

	/** Người chơi bấm đáp án trên modal boss. */
	answer(answerKey: string, nowMs: number): void {
		const question = this.current;

		if (question === null || this.phase !== "question") {
			return;
		}

		this.selectedAnswer = answerKey;
		this.resolve(answerKey === question.correctAnswer ? "correct" : "wrong", answerKey, nowMs);
	}

	private resolve(outcome: BossOutcome, selectedAnswer: string | null, nowMs: number): void {
		const question = this.current;

		if (question === null) {
			return;
		}

		this.answeredAtMs = nowMs;
		this.lastOutcome = outcome;
		this.phase = "outro";
		this.timerSec = tuning.boss.outroSec;
		this.callbacks.onResolved(question, outcome, selectedAnswer);
	}

	get selected(): string | null {
		return this.selectedAnswer;
	}
}
