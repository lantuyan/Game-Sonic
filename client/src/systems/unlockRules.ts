// Luật mở khoá nhân vật (P1-3) — THUẦN SỐ HỌC, không three, không DOM.
//
// Mỗi nhân vật khoá có HAI ĐƯỜNG mở, người chơi đi đường nào cũng được:
//   · mua bằng coin tích luỹ (`endlessrunner-wallet-v2`);
//   · đạt một mốc thành tích (số ván, số câu đúng, một lần vào top 10).
//
// Vì sao hai đường: em nào chơi nhiều mà toán chưa giỏi vẫn gom đủ coin; em nào
// giỏi toán thì mốc thành tích tới trước. Không em nào bị chặn cứng ở một cửa.
//
// Q6 đã chốt tiến trình là LOCAL-TRUST: dữ liệu nằm trên máy, sửa được nếu cố ý.
// Ta không giả vờ chống được điều đó — chỉ làm cho việc sửa không phải là thao tác
// một dòng hiển nhiên (xem `signUnlocks`), còn thứ THẬT SỰ quan trọng (bảng xếp
// hạng) thì đã có anti-cheat phía server ở P1-4.

export type UnlockCondition =
	| { kind: "coins"; amount: number }
	| { kind: "gamesPlayed"; amount: number }
	| { kind: "correctAnswers"; amount: number }
	| { kind: "leaderboardTop"; amount: number };

export interface UnlockRule {
	characterId: string;
	/** Giá coin — đường thứ nhất. */
	price: number;
	/** Mốc thành tích — đường thứ hai. */
	achievement: UnlockCondition;
	/** Câu mô tả mốc thành tích cho học sinh đọc. */
	achievementLabel: string;
}

/** Tiến trình dùng để chấm hai đường mở khoá. */
export interface UnlockProgress {
	coins: number;
	gamesPlayed: number;
	correctAnswers: number;
	bestLeaderboardRank: number | null;
}

export const DEFAULT_UNLOCK_PROGRESS: UnlockProgress = {
	coins: 0,
	gamesPlayed: 0,
	correctAnswers: 0,
	bestLeaderboardRank: null
};

/**
 * Giá: 300 / 500 / 800 coin theo task P1-3.
 * Với nhịp ~1 coin/nhặt + 5 coin/câu đúng, một ván 5 phút cho ~120–180 coin, nên
 * mốc 300 rơi vào khoảng ván thứ 2–3 — đủ gần để có động lực, đủ xa để có giá trị.
 */
export const UNLOCK_RULES: readonly UnlockRule[] = [
	{
		characterId: "mage",
		price: 300,
		achievement: { kind: "correctAnswers", amount: 50 },
		achievementLabel: "trả lời đúng 50 câu"
	},
	{
		characterId: "rogue",
		price: 500,
		achievement: { kind: "gamesPlayed", amount: 10 },
		achievementLabel: "chơi 10 ván"
	},
	{
		characterId: "barbarian",
		price: 800,
		achievement: { kind: "leaderboardTop", amount: 10 },
		achievementLabel: "một lần lọt top 10 bảng xếp hạng"
	}
];

export function getUnlockRule(characterId: string): UnlockRule | undefined {
	return UNLOCK_RULES.find((rule) => rule.characterId === characterId);
}

/** Nhân vật này có cần mở khoá không? (4 nhân vật P0 thì không.) */
export function isLockable(characterId: string): boolean {
	return getUnlockRule(characterId) !== undefined;
}

/** Mốc thành tích đã đạt chưa. */
export function meetsAchievement(condition: UnlockCondition, progress: UnlockProgress): boolean {
	if (condition.kind === "coins") {
		return progress.coins >= condition.amount;
	}

	if (condition.kind === "gamesPlayed") {
		return progress.gamesPlayed >= condition.amount;
	}

	if (condition.kind === "correctAnswers") {
		return progress.correctAnswers >= condition.amount;
	}

	// Hạng NHỎ hơn là tốt hơn: "top 10" nghĩa là rank ≤ 10.
	return progress.bestLeaderboardRank !== null && progress.bestLeaderboardRank <= condition.amount;
}

export type UnlockState =
	/** Không cần mở khoá (nhân vật P0). */
	| { status: "free" }
	/** Đã mở rồi. */
	| { status: "unlocked" }
	/** Đủ điều kiện thành tích — mở được ngay, không tốn coin. */
	| { status: "claimable"; reason: "achievement" }
	/** Đủ coin để mua. */
	| { status: "affordable"; price: number }
	/** Chưa đủ cả hai đường. */
	| { status: "locked"; price: number; missingCoins: number };

export function evaluateUnlock(
	characterId: string,
	unlockedIds: readonly string[],
	progress: UnlockProgress
): UnlockState {
	const rule = getUnlockRule(characterId);

	if (rule === undefined) {
		return { status: "free" };
	}

	if (unlockedIds.includes(characterId) === true) {
		return { status: "unlocked" };
	}

	// Thành tích được xét TRƯỚC coin: đã xứng đáng thì không bắt trả tiền nữa.
	if (meetsAchievement(rule.achievement, progress) === true) {
		return { status: "claimable", reason: "achievement" };
	}

	if (progress.coins >= rule.price) {
		return { status: "affordable", price: rule.price };
	}

	return { status: "locked", price: rule.price, missingCoins: rule.price - progress.coins };
}

/** Nhân vật này có được phép chọn để chơi không. */
export function canPlay(characterId: string, unlockedIds: readonly string[]): boolean {
	return isLockable(characterId) === false || unlockedIds.includes(characterId) === true;
}

// --- Chống sửa tay ở mức "không hiển nhiên" (Q6 local-trust) -----------------

/**
 * Chữ ký của danh sách đã mở khoá.
 *
 * KHÔNG phải bảo mật — không có bí mật nào giấu được trên máy người chơi, và
 * DoD P1-3 cũng chỉ yêu cầu "không mua được bằng cách sửa URL/console DỄ DÀNG".
 * Mục đích thật: một mục localStorage bị sửa tay sẽ có chữ ký sai và bị bỏ qua,
 * nên "mở hết nhân vật" không còn là việc sửa một chuỗi JSON hiển nhiên.
 *
 * Hàm băm là FNV-1a 32-bit trộn với một hằng số — đủ để không đoán ra bằng mắt.
 */
export function signUnlocks(ids: readonly string[]): string {
	const payload = `toan-runner:${[...ids].sort().join(",")}`;
	let hash = 0x811c9dc5;

	for (let index = 0; index < payload.length; index += 1) {
		hash ^= payload.charCodeAt(index);
		// hash × 16777619 theo số học 32-bit.
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}

	return hash.toString(36);
}

export function verifyUnlocks(ids: readonly string[], signature: string): boolean {
	return signUnlocks(ids) === signature;
}
