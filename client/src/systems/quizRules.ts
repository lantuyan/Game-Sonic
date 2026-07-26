// Luật của Cổng Toán (plan §4.3) — thuần số học, không import three.
//
// ⚠ Dữ liệu THẬT quyết định thiết kế ở đây: bank lớp 6/7 hiện 100% câu chỉ có 2
// đáp án. Vì vậy luật là `min(số đáp án khả dụng, 3)` cổng, làn còn lại ĐỂ TRỐNG —
// tuyệt đối không bịa thêm đáp án nhiễu (sẽ dạy sai học sinh).

import { tuning } from "@/tuning";
import type { LegacyQuestion } from "@/integration/questionBank.d";
import type { SeededRandom } from "@/core/random";

export type QuizMode = "gate" | "modal";

export interface GateLayout {
	/** Đúng 3 phần tử: khóa đáp án ("A"/"B"…) hoặc null = làn để trống. */
	lanes: (string | null)[];
	/** Làn chứa đáp án đúng. */
	correctLane: number;
}

/**
 * Chọn chế độ hỏi bài cho MỘT câu.
 *   · `quizMode: "modal"` của lớp (admin đặt) thắng tất cả;
 *   · đề dài hơn ngưỡng → modal (đọc trên cổng 3D không kịp).
 */
export function routeQuestion(question: LegacyQuestion, levelQuizMode: QuizMode = "gate"): QuizMode {
	if (levelQuizMode === "modal") {
		return "modal";
	}

	return question.question.length > tuning.quiz.modalLengthThreshold ? "modal" : "gate";
}

/**
 * Dựng bố cục cổng: `min(số đáp án khả dụng, 3)` cổng.
 * Đáp án đúng LUÔN có mặt; nhiễu bốc ngẫu nhiên từ các đáp án còn lại của chính
 * câu đó. Vị trí ngẫu nhiên để người chơi không đoán được theo thói quen.
 */
export function buildGateLayout(question: LegacyQuestion, random: SeededRandom): GateLayout {
	const available = question.availableAnswers.filter((key) => {
		const text = question.answers[key];
		return typeof text === "string" && text.trim() !== "";
	});

	const distractors = available.filter((key) => key !== question.correctAnswer);
	const gateCount = Math.min(available.length, tuning.quiz.maxGates);

	// Đáp án đúng + (gateCount - 1) nhiễu bốc ngẫu nhiên không lặp.
	const shuffledDistractors = distractors.slice();

	for (let index = shuffledDistractors.length - 1; index > 0; index -= 1) {
		const swapIndex = Math.floor(random() * (index + 1));
		const current = shuffledDistractors[index];
		const other = shuffledDistractors[swapIndex];

		if (current === undefined || other === undefined) {
			continue;
		}

		shuffledDistractors[index] = other;
		shuffledDistractors[swapIndex] = current;
	}

	const chosen = [question.correctAnswer, ...shuffledDistractors.slice(0, Math.max(gateCount - 1, 0))];

	// Trộn vị trí, rồi rải vào 3 làn — làn thừa để trống.
	for (let index = chosen.length - 1; index > 0; index -= 1) {
		const swapIndex = Math.floor(random() * (index + 1));
		const current = chosen[index];
		const other = chosen[swapIndex];

		if (current === undefined || other === undefined) {
			continue;
		}

		chosen[index] = other;
		chosen[swapIndex] = current;
	}

	const lanes: (string | null)[] = [null, null, null];

	if (chosen.length === 3) {
		lanes[0] = chosen[0] ?? null;
		lanes[1] = chosen[1] ?? null;
		lanes[2] = chosen[2] ?? null;
	} else if (chosen.length === 2) {
		// 2 cổng: đặt ở 2 trong 3 làn, chọn ngẫu nhiên làn bỏ trống.
		const emptyLane = Math.floor(random() * 3);
		let cursor = 0;

		for (let lane = 0; lane < 3; lane += 1) {
			if (lane === emptyLane) {
				continue;
			}

			lanes[lane] = chosen[cursor] ?? null;
			cursor += 1;
		}
	} else {
		lanes[1] = chosen[0] ?? null;
	}

	return { lanes, correctLane: lanes.indexOf(question.correctAnswer) };
}

/**
 * Thời lượng trạm (plan §4.3):
 *   clamp(base + đềDài/12, 6, 14) × clamp(avgAnswerMs/8000, 0.8, 1.3)
 * `avgAnswerMs` null (ván đầu, chưa có dữ liệu) → hệ số 1.0.
 */
export function computeStationDurationSec(question: LegacyQuestion, avgAnswerMs: number | null): number {
	const lengthPart = tuning.quiz.stationBaseSec + question.question.length / tuning.quiz.stationLengthDivisor;
	const base = Math.min(Math.max(lengthPart, tuning.quiz.stationMinSec), tuning.quiz.stationMaxSec);

	if (avgAnswerMs === null || Number.isFinite(avgAnswerMs) === false) {
		return base;
	}

	const raw = avgAnswerMs / tuning.quiz.answerTimeReferenceMs;
	const factor = Math.min(Math.max(raw, tuning.quiz.answerTimeFactorMin), tuning.quiz.answerTimeFactorMax);

	return base * factor;
}

/** Máy trạng thái "cổng mềm": lần 1 mỗi ván được cứu, từ lần 2 tính timeout. */
export class SoftGateTracker {
	private used = false;

	reset(): void {
		this.used = false;
	}

	/**
	 * Hết giờ trạm mà chưa chọn.
	 * Trả về "rescue" (mở modal 10s, KHÔNG tính timeout) hoặc "timeout".
	 */
	onStationExpired(): "rescue" | "timeout" {
		if (this.used === false) {
			this.used = true;
			return "rescue";
		}

		return "timeout";
	}

	get hasUsedRescue(): boolean {
		return this.used;
	}
}

/** Thống kê phiên chơi — cấu trúc như V1 (A1 §2.10) + `mode` cho thống kê V2. */
export interface SessionAnswer {
	questionId: string;
	status: "correct" | "wrong" | "timeout";
	mode: QuizMode;
	answeredMs: number;
	selectedAnswer: string | null;
}

export class SessionStatsRecorder {
	private readonly answers: SessionAnswer[] = [];
	private startedAtMs = 0;

	start(nowMs: number): void {
		this.answers.length = 0;
		this.startedAtMs = nowMs;
	}

	record(answer: SessionAnswer): void {
		this.answers.push(answer);
	}

	get list(): readonly SessionAnswer[] {
		return this.answers;
	}

	get correct(): number {
		return this.answers.filter((answer) => answer.status === "correct").length;
	}

	get wrong(): number {
		return this.answers.filter((answer) => answer.status === "wrong").length;
	}

	get timeout(): number {
		return this.answers.filter((answer) => answer.status === "timeout").length;
	}

	durationMs(nowMs: number): number {
		return Math.max(nowMs - this.startedAtMs, 0);
	}

	/** Payload đúng dạng `updateSkillProfileAfterGame` của V1. */
	toSessionStats(nowMs: number): { correct: number; wrong: number; timeout: number; durationMs: number } {
		return {
			correct: this.correct,
			wrong: this.wrong,
			timeout: this.timeout,
			durationMs: this.durationMs(nowMs)
		};
	}

	/** Payload đúng dạng `submitScore` của V1. */
	toScoreStats(score: number, nowMs: number): {
		score: number;
		correctCount: number;
		wrongCount: number;
		timeoutCount: number;
		durationMs: number;
	} {
		return {
			score,
			correctCount: this.correct,
			wrongCount: this.wrong,
			timeoutCount: this.timeout,
			durationMs: this.durationMs(nowMs)
		};
	}
}
