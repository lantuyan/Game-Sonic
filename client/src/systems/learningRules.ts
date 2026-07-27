// Luật học tập nâng cao (plan §4.6 — P1-5). THUẦN SỐ HỌC, không three, không DOM.
//
// Năm luật ở đây đều là "AI dạy học" ở dạng đơn giản nhất có thể: quy tắc rõ ràng,
// đọc ra được, giải thích được cho giáo viên. KHÔNG mô hình học máy — với 3 lớp và
// vài trăm câu hỏi thì quy tắc minh bạch vừa đủ chính xác vừa gỡ lỗi được.
//
//   1. micro-DDA          — 2 sai liên tiếp hạ 1 bậc, 3 đúng liên tiếp nâng 1 bậc;
//   2. tần suất cổng      — làm đúng nhiều thì gặp cổng dày hơn (25s), sai nhiều thì thưa (40s);
//   3. định tuyến modal   — đọc chậm + câu từ medium trở lên → modal, đừng bắt đọc trên cổng 3D;
//   4. câu hồi sinh       — hết tim thì được một câu easy để quay lại;
//   5. thưởng khiên       — trả lời đúng câu hard/expert được Khiên.

import { tuning } from "@/tuning";
import { DEFAULT_DIFFICULTY_ORDER } from "@/systems/bossRules";
import type { LegacyQuestion } from "@/integration/questionBank.d";
import type { SeededRandom } from "@/core/random";

// --- 1. micro-DDA ------------------------------------------------------------

/**
 * Điều chỉnh độ khó TRONG VÁN.
 *
 * Vì sao 2-sai/3-đúng chứ không đối xứng: hạ độ khó phải NHANH (một em đang bí thì
 * mỗi câu khó thêm là thêm một lần nản), còn nâng lên thì phải CHẮC (3 câu đúng
 * liên tiếp mới thật sự là "em này làm được", chứ 2 câu có thể là may).
 *
 * `shift` cộng vào `targetDifficultyIndex` cho lượt bốc KẾ TIẾP, và bị kẹp trong
 * ±`microDdaMaxShift` để không trôi khỏi trình độ thật của em sau một ván xui.
 */
export class MicroDda {
	private consecutiveWrong = 0;
	private consecutiveCorrect = 0;
	private currentShift = 0;

	reset(): void {
		this.consecutiveWrong = 0;
		this.consecutiveCorrect = 0;
		this.currentShift = 0;
	}

	registerCorrect(): void {
		this.consecutiveWrong = 0;
		this.consecutiveCorrect += 1;

		if (this.consecutiveCorrect >= tuning.learning.ddaRaiseStreak) {
			this.consecutiveCorrect = 0;
			this.currentShift = Math.min(this.currentShift + 1, tuning.learning.ddaMaxShift);
		}
	}

	/** Sai VÀ timeout đều tính — timeout cũng là "em chưa làm được câu này". */
	registerWrong(): void {
		this.consecutiveCorrect = 0;
		this.consecutiveWrong += 1;

		if (this.consecutiveWrong >= tuning.learning.ddaLowerStreak) {
			this.consecutiveWrong = 0;
			this.currentShift = Math.max(this.currentShift - 1, -tuning.learning.ddaMaxShift);
		}
	}

	get shift(): number {
		return this.currentShift;
	}
}

/**
 * Chọn câu KẾ TIẾP trong hàng đợi theo `shift` của micro-DDA.
 *
 * Hàng đợi đã được `orderQuestionsBySkill` của V1 sắp sẵn (câu hợp trình độ nằm ở
 * CUỐI, game pop từ cuối — hợp đồng §7.3.1). micro-DDA KHÔNG dựng lại hàng đợi mà
 * chỉ chọn trong đó một câu lệch `shift` bậc so với câu sắp tới. Nhờ vậy mọi công
 * việc lọc câu đã trả lời + trộn hàng đợi ôn tập vẫn được tôn trọng.
 *
 * Trả về CHỈ SỐ trong mảng, hoặc -1 khi hàng đợi rỗng.
 */
export function pickQueueIndexWithShift(
	queue: readonly LegacyQuestion[],
	shift: number,
	order: readonly string[] = DEFAULT_DIFFICULTY_ORDER
): number {
	if (queue.length === 0) {
		return -1;
	}

	const nextIndex = queue.length - 1;

	if (shift === 0) {
		return nextIndex;
	}

	const nextQuestion = queue[nextIndex];

	if (nextQuestion === undefined) {
		return nextIndex;
	}

	const baseIndex = Math.max(order.indexOf(nextQuestion.difficulty), 0);
	const desired = Math.min(Math.max(baseIndex + shift, 0), Math.max(order.length - 1, 0));

	let bestIndex = nextIndex;
	let bestDistance = Math.abs(baseIndex - desired);

	// Duyệt từ CUỐI về đầu: câu càng gần cuối càng hợp trình độ theo xếp hạng của V1,
	// nên khi hai câu cách `desired` bằng nhau thì câu ở cuối thắng.
	for (let index = queue.length - 1; index >= 0; index -= 1) {
		const question = queue[index];

		if (question === undefined) {
			continue;
		}

		const distance = Math.abs(Math.max(order.indexOf(question.difficulty), 0) - desired);

		if (distance < bestDistance) {
			bestDistance = distance;
			bestIndex = index;
		}
	}

	return bestIndex;
}

// --- 2. Tần suất cổng theo accuracy ------------------------------------------

/**
 * Khoảng cách giữa hai trạm, theo accuracy tích luỹ của em (plan §4.6).
 *
 * accuracy 1.0 → 25s (làm tốt thì cho gặp nhiều câu hơn);
 * accuracy 0.0 → 40s (đang chật vật thì cho thở, đừng dồn).
 * Chưa có dữ liệu (ván đầu) → giữa dải.
 *
 * ⚠ Dải 25–40s là quyết định đã chốt ở plan §4.3 — KHÔNG nới ra ngoài ở đây.
 */
export function computeGateIntervalSec(accuracy: number | null): number {
	const min = tuning.quiz.gateIntervalMinSec;
	const max = tuning.learning.gateIntervalCeilingSec;

	if (accuracy === null || Number.isFinite(accuracy) === false) {
		return (min + max) / 2;
	}

	const clamped = Math.min(Math.max(accuracy, 0), 1);
	return max - (max - min) * clamped;
}

// --- 3. Định tuyến modal cho em đọc chậm -------------------------------------

/**
 * Em đọc chậm (`avgAnswerMs` > 12s) mà gặp câu từ `medium` trở lên thì mở MODAL
 * thay vì cổng 3D: trên cổng thì đề trôi về phía mình, đọc không kịp là mất câu.
 * Câu `easy` vẫn để ở cổng — giữ nhịp chạy, và câu dễ thì đọc kịp.
 */
export function shouldRouteToModalForSlowReader(
	question: LegacyQuestion,
	avgAnswerMs: number | null,
	order: readonly string[] = DEFAULT_DIFFICULTY_ORDER
): boolean {
	if (avgAnswerMs === null || Number.isFinite(avgAnswerMs) === false) {
		return false;
	}

	if (avgAnswerMs <= tuning.learning.slowReaderMs) {
		return false;
	}

	return Math.max(order.indexOf(question.difficulty), 0) >= tuning.learning.slowReaderMinDifficultyIndex;
}

// --- 4. Câu hồi sinh ---------------------------------------------------------

export type RevivalOffer =
	/** Được hồi sinh miễn phí. */
	| { kind: "free" }
	/** Phải trả coin (lần thứ 2 trở đi trong ngày). */
	| { kind: "paid"; coins: number }
	/** Không đủ coin, hoặc đã hết lượt. */
	| { kind: "unavailable"; reason: "not-enough-coins" | "no-question" };

/**
 * Bốc câu hồi sinh: ưu tiên `easy`, chưa gặp trong ván.
 * Đây là lúc em vừa mất tim cuối — câu phải DỄ, mục đích là cho em quay lại chơi
 * chứ không phải sát hạch thêm một lần nữa.
 */
export function pickRevivalQuestion(
	questions: readonly LegacyQuestion[],
	random: SeededRandom,
	usedIds: ReadonlySet<string> = new Set(),
	order: readonly string[] = DEFAULT_DIFFICULTY_ORDER
): LegacyQuestion | null {
	const unused = questions.filter((question) => usedIds.has(question.id) === false);
	const pool = unused.length > 0 ? unused : questions;

	if (pool.length === 0) {
		return null;
	}

	// Bậc thấp nhất còn câu — thường là easy, nhưng bank chỉ có medium thì vẫn chạy.
	let bestIndex = Number.POSITIVE_INFINITY;

	for (const question of pool) {
		bestIndex = Math.min(bestIndex, Math.max(order.indexOf(question.difficulty), 0));
	}

	const easiest = pool.filter((question) => Math.max(order.indexOf(question.difficulty), 0) === bestIndex);
	return easiest[Math.floor(random() * easiest.length)] ?? null;
}

/**
 * Lần hồi sinh thứ mấy trong NGÀY và giá của nó.
 * Lần 1 miễn phí; từ lần 2 trả `revivalCoinCost` coin (plan §4.6: 100 coin).
 */
export function offerRevival(usedToday: number, coins: number): RevivalOffer {
	if (usedToday < tuning.learning.revivalFreePerDay) {
		return { kind: "free" };
	}

	if (coins >= tuning.learning.revivalCoinCost) {
		return { kind: "paid", coins: tuning.learning.revivalCoinCost };
	}

	return { kind: "unavailable", reason: "not-enough-coins" };
}

// --- 5. Thưởng khiên cho câu khó ---------------------------------------------

/** Trả lời ĐÚNG câu `hard`/`expert` → tặng 1 Khiên (plan §4.6). */
export function earnsShield(
	question: LegacyQuestion,
	correct: boolean,
	order: readonly string[] = DEFAULT_DIFFICULTY_ORDER
): boolean {
	if (correct === false) {
		return false;
	}

	return Math.max(order.indexOf(question.difficulty), 0) >= tuning.learning.shieldRewardMinDifficultyIndex;
}

// --- Thống kê bổ sung cho hồ sơ kỹ năng --------------------------------------

/**
 * Số liệu P1-5 thêm vào payload đồng bộ skill.
 *
 * `difficulty_weights` của bảng `skill_profiles` là JSONB nên THÊM khoá mới không
 * phá schema (DoD P1-5) — không cần migration, bản server cũ chỉ đơn giản bỏ qua.
 */
export interface LearningStats {
	/** Thời gian trả lời trung bình RIÊNG ở cổng 3D (khác modal — đọc khác nhau). */
	gateAnswerMs: number | null;
	/** Đúng/sai tách theo chế độ, để P1-6 biết cổng hay modal hợp với em hơn. */
	modeStats: {
		gate: { correct: number; total: number };
		modal: { correct: number; total: number };
	};
}

export class LearningStatsRecorder {
	private gateMsTotal = 0;
	private gateMsCount = 0;
	private readonly counts = {
		gate: { correct: 0, total: 0 },
		modal: { correct: 0, total: 0 }
	};

	reset(): void {
		this.gateMsTotal = 0;
		this.gateMsCount = 0;
		this.counts.gate = { correct: 0, total: 0 };
		this.counts.modal = { correct: 0, total: 0 };
	}

	record(mode: "gate" | "modal", correct: boolean, answeredMs: number): void {
		const bucket = this.counts[mode];
		bucket.total += 1;

		if (correct === true) {
			bucket.correct += 1;
		}

		if (mode === "gate" && Number.isFinite(answeredMs) === true && answeredMs > 0) {
			this.gateMsTotal += answeredMs;
			this.gateMsCount += 1;
		}
	}

	snapshot(): LearningStats {
		return {
			gateAnswerMs: this.gateMsCount > 0 ? Math.round(this.gateMsTotal / this.gateMsCount) : null,
			modeStats: {
				gate: { ...this.counts.gate },
				modal: { ...this.counts.modal }
			}
		};
	}

	/** Accuracy của ván này — dùng ngay trong ván cho luật tần suất cổng. */
	get accuracy(): number | null {
		const total = this.counts.gate.total + this.counts.modal.total;

		if (total === 0) {
			return null;
		}

		return (this.counts.gate.correct + this.counts.modal.correct) / total;
	}
}
