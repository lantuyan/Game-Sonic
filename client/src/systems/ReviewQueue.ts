// Hàng đợi ôn câu sai (plan §4.6, Q9) — cốt lõi giáo dục của V2.
//
// Vòng đời: sai/timeout → vào queue → trộn vào hàng đợi câu của 1–2 ván kế
// (ưu tiên ~30% đầu) → ĐÚNG 2 LẦN thì ra khỏi queue.
//
// Lưu ở `endlessrunner-review-queue-v2` (khóa mới, hậu tố -v2 theo hợp đồng).
// Thuần số học + localStorage → test được không cần trình duyệt thật.

import { V2_STORAGE_KEYS } from "@/core/storageKeys";
import { readJson, writeJson } from "@/core/SaveData";

export interface ReviewEntry {
	questionId: string;
	level: string;
	wrongCount: number;
	lastSeenAt: number;
	/** Số lần trả lời đúng LIÊN TIẾP kể từ khi vào queue. */
	correctStreak: number;
}

interface ReviewQueueData {
	entries: ReviewEntry[];
}

/** Đúng 2 lần thì coi như đã nắm, cho ra khỏi hàng đợi. */
export const CORRECT_STREAK_TO_GRADUATE = 2;
/** Trần kích thước hàng đợi — FIFO, bỏ mục cũ nhất khi tràn. */
export const MAX_QUEUE_SIZE = 30;
/** Tỉ lệ câu ôn trộn vào đầu hàng đợi mỗi ván. */
export const REVIEW_MIX_RATIO = 0.3;

const EMPTY: ReviewQueueData = { entries: [] };

export class ReviewQueue {
	private entries: ReviewEntry[] = [];

	constructor() {
		this.load();
	}

	private load(): void {
		const data = readJson<ReviewQueueData>(V2_STORAGE_KEYS.reviewQueue, EMPTY);
		this.entries = Array.isArray(data.entries) === true ? data.entries.filter(isValidEntry) : [];
	}

	private persist(): void {
		writeJson(V2_STORAGE_KEYS.reviewQueue, { entries: this.entries });
	}

	get all(): readonly ReviewEntry[] {
		return this.entries;
	}

	forLevel(level: string): ReviewEntry[] {
		return this.entries.filter((entry) => entry.level === level);
	}

	has(questionId: string): boolean {
		return this.entries.some((entry) => entry.questionId === questionId);
	}

	/** Trả lời SAI hoặc TIMEOUT: đưa vào queue (hoặc tăng đếm nếu đã có). */
	recordWrong(questionId: string, level: string, nowMs: number): void {
		const existing = this.entries.find((entry) => entry.questionId === questionId);

		if (existing !== undefined) {
			existing.wrongCount += 1;
			existing.lastSeenAt = nowMs;
			// Sai lại thì mất hết tiến độ đã tích — phải đúng lại từ đầu.
			existing.correctStreak = 0;
			this.persist();
			return;
		}

		this.entries.push({
			questionId,
			level,
			wrongCount: 1,
			lastSeenAt: nowMs,
			correctStreak: 0
		});

		// Tràn trần: bỏ mục CŨ NHẤT (FIFO) để queue không phình vô hạn.
		while (this.entries.length > MAX_QUEUE_SIZE) {
			this.entries.shift();
		}

		this.persist();
	}

	/**
	 * Trả lời ĐÚNG một câu đang trong queue. Đủ 2 lần đúng thì ra khỏi queue.
	 * Trả về true khi câu vừa "tốt nghiệp".
	 */
	recordCorrect(questionId: string, nowMs: number): boolean {
		const index = this.entries.findIndex((entry) => entry.questionId === questionId);

		if (index === -1) {
			return false;
		}

		const entry = this.entries[index];

		if (entry === undefined) {
			return false;
		}

		entry.correctStreak += 1;
		entry.lastSeenAt = nowMs;

		if (entry.correctStreak >= CORRECT_STREAK_TO_GRADUATE) {
			this.entries.splice(index, 1);
			this.persist();
			return true;
		}

		this.persist();
		return false;
	}

	/**
	 * Trộn câu ôn vào hàng đợi của ván mới.
	 *
	 * Hàng đợi được POP TỪ CUỐI (hợp đồng V1), nên "ưu tiên ra sớm" = đặt ở CUỐI
	 * mảng. Đây là chỗ rất dễ làm ngược — đặt ở đầu mảng thì câu ôn ra cuối ván
	 * hoặc không bao giờ ra.
	 */
	mixIntoQueue<Question extends { id: string }>(level: string, queue: Question[], allQuestions: Question[]): Question[] {
		const reviewIds = new Set(this.forLevel(level).map((entry) => entry.questionId));

		if (reviewIds.size === 0) {
			return queue;
		}

		const reviewQuestions = allQuestions.filter((question) => reviewIds.has(question.id));

		if (reviewQuestions.length === 0) {
			return queue;
		}

		const withoutReview = queue.filter((question) => reviewIds.has(question.id) === false);
		const mixCount = Math.max(1, Math.round(queue.length * REVIEW_MIX_RATIO));
		const selected = reviewQuestions.slice(0, mixCount);

		// `selected` nằm CUỐI mảng ⇒ được pop ra TRƯỚC.
		return [...withoutReview, ...selected];
	}

	clear(): void {
		this.entries = [];
		this.persist();
	}
}

function isValidEntry(value: unknown): value is ReviewEntry {
	if (value === null || typeof value !== "object") {
		return false;
	}

	const entry = value as Partial<ReviewEntry>;

	return (
		typeof entry.questionId === "string" &&
		entry.questionId !== "" &&
		typeof entry.level === "string" &&
		typeof entry.wrongCount === "number" &&
		typeof entry.correctStreak === "number"
	);
}
