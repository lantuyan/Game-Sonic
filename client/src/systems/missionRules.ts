// Nhiệm vụ ngày + huy hiệu + chuỗi ngày chăm chỉ (P1-8) — THUẦN SỐ HỌC.
//
// Nguyên tắc xuyên suốt phần này, và là lý do nó khác hầu hết game khác:
// **KHÔNG phạt khi gãy chuỗi.** Một đứa trẻ nghỉ hai hôm vì ốm, vì đi chơi, vì
// nhà mất mạng — quay lại mà thấy mất sạch thành quả là bài học sai hoàn toàn.
// Chuỗi ngày ở đây chỉ cộng thêm, tối đa 7 ngày, và gãy thì đơn giản là bắt đầu
// lại từ 1. Huy hiệu đã trao thì KHÔNG BAO GIỜ lấy lại.

import { tuning } from "@/tuning";
import { createSeededRandom } from "@/core/random";

// --- Nhiệm vụ ngày -----------------------------------------------------------

export type MissionKind =
	/** Trả lời đúng N câu. */
	| "correctAnswers"
	/** Chạy được N mét. */
	| "distance"
	/** Trả lời đúng N câu của một độ khó. */
	| "correctByDifficulty"
	/** Nhặt N xu. */
	| "coins"
	/** Lướt sát chướng ngại N lần. */
	| "nearMiss";

export interface MissionDefinition {
	id: string;
	kind: MissionKind;
	target: number;
	reward: number;
	label: string;
	/** Chỉ dùng cho `correctByDifficulty`. */
	difficulty?: string;
}

export interface MissionProgressEntry {
	id: string;
	progress: number;
	claimed: boolean;
}

export interface DailyMissions {
	date: string;
	missions: MissionDefinition[];
	entries: MissionProgressEntry[];
}

/**
 * Bể nhiệm vụ. Mỗi mục là một HÀM sinh, để cùng một loại có thể ra mức khó khác
 * nhau theo ngày mà không phải liệt kê tay hàng chục biến thể.
 */
const MISSION_POOL: Array<(pick: (min: number, max: number) => number) => MissionDefinition> = [
	(pick) => {
		const target = pick(6, 12);
		return {
			id: `correct-${target}`,
			kind: "correctAnswers",
			target,
			reward: target * 8,
			label: `Trả lời đúng ${target} câu`
		};
	},
	(pick) => {
		const target = pick(1200, 2500);
		return {
			id: `distance-${target}`,
			kind: "distance",
			target,
			reward: Math.round(target / 25),
			label: `Chạy ${target} mét`
		};
	},
	(pick) => {
		const target = pick(2, 4);
		return {
			id: `hard-${target}`,
			kind: "correctByDifficulty",
			difficulty: "hard",
			target,
			reward: target * 25,
			label: `Trả lời đúng ${target} câu khó`
		};
	},
	(pick) => {
		const target = pick(3, 6);
		return {
			id: `medium-${target}`,
			kind: "correctByDifficulty",
			difficulty: "medium",
			target,
			reward: target * 15,
			label: `Trả lời đúng ${target} câu trung bình`
		};
	},
	(pick) => {
		const target = pick(60, 140);
		return {
			id: `coins-${target}`,
			kind: "coins",
			target,
			reward: Math.round(target / 2),
			label: `Nhặt ${target} xu`
		};
	},
	(pick) => {
		const target = pick(4, 8);
		return {
			id: `nearmiss-${target}`,
			kind: "nearMiss",
			target,
			reward: target * 10,
			label: `Lướt sát chướng ngại ${target} lần`
		};
	}
];

/** Biến chuỗi ngày `YYYY-MM-DD` thành hạt giống số — cùng ngày cho cùng nhiệm vụ. */
export function dateSeed(dateKey: string): number {
	let hash = 0x811c9dc5;

	for (let index = 0; index < dateKey.length; index += 1) {
		hash ^= dateKey.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}

	return hash >>> 0;
}

/**
 * Sinh 3 nhiệm vụ của ngày.
 *
 * Tất định theo NGÀY, không theo thiết bị: cả lớp cùng nhận một bộ nhiệm vụ, nên
 * các em nói chuyện được với nhau về nó — và không em nào cảm thấy mình bị giao
 * việc khó hơn bạn.
 */
export function generateDailyMissions(dateKey: string): MissionDefinition[] {
	const random = createSeededRandom(dateSeed(dateKey));
	const pick = (min: number, max: number): number => min + Math.floor(random() * (max - min + 1));
	const available = MISSION_POOL.slice();
	const chosen: MissionDefinition[] = [];

	for (let slot = 0; slot < tuning.missions.perDay && available.length > 0; slot += 1) {
		const index = Math.floor(random() * available.length);
		const factory = available.splice(index, 1)[0];

		if (factory !== undefined) {
			chosen.push(factory(pick));
		}
	}

	return chosen;
}

/** Số liệu một ván, dùng để cộng tiến độ nhiệm vụ. */
export interface RunTotals {
	correctAnswers: number;
	distanceM: number;
	coins: number;
	nearMisses: number;
	correctByDifficulty: Record<string, number>;
}

export function emptyRunTotals(): RunTotals {
	return { correctAnswers: 0, distanceM: 0, coins: 0, nearMisses: 0, correctByDifficulty: {} };
}

/** Phần tiến độ mà MỘT ván đóng góp cho MỘT nhiệm vụ. */
export function missionDelta(mission: MissionDefinition, totals: RunTotals): number {
	if (mission.kind === "correctAnswers") {
		return totals.correctAnswers;
	}

	if (mission.kind === "distance") {
		return Math.floor(totals.distanceM);
	}

	if (mission.kind === "coins") {
		return totals.coins;
	}

	if (mission.kind === "nearMiss") {
		return totals.nearMisses;
	}

	return totals.correctByDifficulty[mission.difficulty ?? ""] ?? 0;
}

export function isMissionComplete(mission: MissionDefinition, progress: number): boolean {
	return progress >= mission.target;
}

// --- Huy hiệu ----------------------------------------------------------------

export type BadgeKind = "correctTotal" | "difficultyTotal" | "streakDays";

export interface BadgeDefinition {
	id: string;
	kind: BadgeKind;
	threshold: number;
	label: string;
	description: string;
	difficulty?: string;
}

/**
 * Huy hiệu theo MỐC TÍCH LUỸ, không theo thành tích so với bạn bè.
 * Cạnh tranh đã có ở bảng xếp hạng; chỗ này để mỗi em thấy mình đang tiến lên so
 * với chính mình.
 */
export const BADGES: readonly BadgeDefinition[] = [
	{ id: "first-10", kind: "correctTotal", threshold: 10, label: "Khởi động", description: "Trả lời đúng 10 câu" },
	{ id: "first-50", kind: "correctTotal", threshold: 50, label: "Chăm chỉ", description: "Trả lời đúng 50 câu" },
	{ id: "first-200", kind: "correctTotal", threshold: 200, label: "Kiên trì", description: "Trả lời đúng 200 câu" },
	{ id: "first-500", kind: "correctTotal", threshold: 500, label: "Cao thủ", description: "Trả lời đúng 500 câu" },
	{
		id: "hard-25",
		kind: "difficultyTotal",
		difficulty: "hard",
		threshold: 25,
		label: "Không ngại khó",
		description: "Trả lời đúng 25 câu khó"
	},
	{
		id: "expert-10",
		kind: "difficultyTotal",
		difficulty: "expert",
		threshold: 10,
		label: "Đỉnh cao",
		description: "Trả lời đúng 10 câu cực khó"
	},
	{ id: "streak-3", kind: "streakDays", threshold: 3, label: "Đều đặn", description: "Chơi 3 ngày liên tiếp" },
	{ id: "streak-7", kind: "streakDays", threshold: 7, label: "Trọn tuần", description: "Chơi 7 ngày liên tiếp" }
];

export interface BadgeProgress {
	correctTotal: number;
	correctByDifficulty: Record<string, number>;
	streakDays: number;
}

export function badgeValue(badge: BadgeDefinition, progress: BadgeProgress): number {
	if (badge.kind === "correctTotal") {
		return progress.correctTotal;
	}

	if (badge.kind === "streakDays") {
		return progress.streakDays;
	}

	return progress.correctByDifficulty[badge.difficulty ?? ""] ?? 0;
}

/** Huy hiệu vừa đạt mà CHƯA có trong danh sách đã trao. */
export function newlyEarnedBadges(progress: BadgeProgress, earnedIds: readonly string[]): BadgeDefinition[] {
	return BADGES.filter(
		(badge) => earnedIds.includes(badge.id) === false && badgeValue(badge, progress) >= badge.threshold
	);
}

// --- Chuỗi ngày chăm chỉ -----------------------------------------------------

export interface StreakState {
	/** Ngày chơi gần nhất, `YYYY-MM-DD`. */
	lastDate: string;
	days: number;
}

/**
 * Cập nhật chuỗi ngày.
 *
 *   · cùng ngày        → giữ nguyên (chơi 10 ván trong một ngày vẫn là 1 ngày);
 *   · ngày liền kề     → +1, trần `tuning.missions.streakCapDays` (7);
 *   · cách quãng       → về 1. KHÔNG phạt, không mất huy hiệu đã trao.
 *
 * `previousDayKey` do phía gọi tính (SaveData.todayKey của hôm qua) để hàm này
 * không phải biết gì về Date — nhờ vậy test bơm ngày được, không phụ thuộc đồng hồ.
 */
export function advanceStreak(state: StreakState, todayKey: string, yesterdayKey: string): StreakState {
	if (state.lastDate === todayKey) {
		return state;
	}

	if (state.lastDate === yesterdayKey) {
		return { lastDate: todayKey, days: Math.min(state.days + 1, tuning.missions.streakCapDays) };
	}

	return { lastDate: todayKey, days: 1 };
}

// --- Mốc thưởng theo chuỗi ngày (P2-2) ---------------------------------------

export interface StreakMilestone {
	day: number;
	coins: number;
	label: string;
}

/**
 * Mốc thưởng xu theo ngày thứ mấy của chuỗi.
 *
 * Đường cong CỐ Ý dốc về cuối (20 → 40 → 90 → 200): ngày 2 chỉ cần đủ để người
 * chơi phát hiện ra "à, quay lại có quà", còn ngày 7 phải đáng để nhớ. Tổng một
 * chuỗi trọn vẹn là 350 xu — hơn món ngoại hình đắt nhất (250, xem
 * `systems/cosmeticRules.ts`), nên bảy ngày đi học đều đổi được một thứ NHÌN THẤY
 * ĐƯỢC, mà vẫn chưa đủ mua một bạn chạy mới (300 trở lên) chỉ bằng cách điểm danh.
 *
 * KHÔNG có mốc nào vượt quá `tuning.missions.streakCapDays` (7). Trần đó là quyết
 * định thiết kế của P1-8 ("không biến việc nghỉ một hôm thành mất mát lớn") và
 * task này không mở lại nó — thêm mốc ngày 30 là ép trẻ con đi học đủ tháng.
 * Hệ quả cần thiết: chạm trần rồi thì `days` không tăng nữa nên không mốc nào
 * trả lại lần hai — không có vòng lặp cày xu.
 */
export const STREAK_MILESTONES: readonly StreakMilestone[] = [
	{ day: 2, coins: 20, label: "Ngày thứ 2 liên tiếp" },
	{ day: 3, coins: 40, label: "Ngày thứ 3 liên tiếp" },
	{ day: 5, coins: 90, label: "Ngày thứ 5 liên tiếp" },
	{ day: 7, coins: 200, label: "Trọn tuần chăm chỉ" }
];

/** Mốc rơi ĐÚNG vào ngày này (null = ngày không có mốc). */
export function streakMilestoneAt(day: number): StreakMilestone | null {
	return STREAK_MILESTONES.find((milestone) => milestone.day === day) ?? null;
}

/** Mốc kế tiếp để hiển thị "còn N ngày nữa" (null = đã lấy hết). */
export function nextStreakMilestone(day: number): StreakMilestone | null {
	return STREAK_MILESTONES.find((milestone) => milestone.day > day) ?? null;
}

/**
 * Thưởng khi chuỗi ngày đi từ `previousDays` lên `currentDays`.
 *
 * Nhận CẢ HAI đầu chứ không chỉ ngày hiện tại, vì đó là chỗ duy nhất phân biệt
 * được "hôm nay vừa lên ngày 3" với "hôm nay chơi ván thứ tư trong ngày 3".
 * Chuỗi tụt (gãy rồi bắt đầu lại) trả 0 — không phạt, cũng không thưởng lại.
 */
export function streakRewardCoins(previousDays: number, currentDays: number): number {
	if (currentDays <= previousDays) {
		return 0;
	}

	let coins = 0;

	// Cộng dồn mọi mốc nằm trong khoảng vừa vượt qua: chuỗi chỉ tăng từng ngày một
	// nên bình thường chỉ có 0 hoặc 1 mốc, nhưng cứ tính đúng để không phụ thuộc
	// vào giả định đó.
	for (const milestone of STREAK_MILESTONES) {
		if (milestone.day > previousDays && milestone.day <= currentDays) {
			coins += milestone.coins;
		}
	}

	return coins;
}
