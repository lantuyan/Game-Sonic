// Kho tiến trình mở khoá (P1-3) — nối `systems/unlockRules` (luật thuần) với
// `core/SaveData` (localStorage) và ví coin.
//
// Đây là NƠI DUY NHẤT ghi `endlessrunner-unlocks-v2`, y như Lives là nơi duy nhất
// trừ tim: mọi đường mở khoá (mua, đạt mốc, tự động sau ván) đều đi qua đây nên
// không có nhánh nào lỡ tay mở nhân vật mà quên trừ coin.

import { loadUnlocks, saveUnlocks, loadWallet, saveWallet, type UnlocksV2 } from "@/core/SaveData";
import {
	evaluateUnlock,
	getUnlockRule,
	signUnlocks,
	verifyUnlocks,
	UNLOCK_RULES,
	type UnlockProgress,
	type UnlockState
} from "@/systems/unlockRules";

export type PurchaseResult =
	| { ok: true; paidCoins: number }
	| { ok: false; reason: "unknown-character" | "already-unlocked" | "not-enough-coins" };

export class Unlocks {
	private state: UnlocksV2;

	constructor() {
		this.state = loadUnlocks(verifyUnlocks);
	}

	/** Đọc lại từ localStorage (tab khác vừa chơi xong, hoặc test vừa ghi tay). */
	reload(): void {
		this.state = loadUnlocks(verifyUnlocks);
	}

	get unlockedIds(): readonly string[] {
		return this.state.unlocked;
	}

	get progress(): UnlockProgress {
		return {
			coins: loadWallet().coins,
			gamesPlayed: this.state.gamesPlayed,
			correctAnswers: this.state.correctAnswers,
			bestLeaderboardRank: this.state.bestLeaderboardRank
		};
	}

	evaluate(characterId: string): UnlockState {
		return evaluateUnlock(characterId, this.state.unlocked, this.progress);
	}

	isUnlocked(characterId: string): boolean {
		return getUnlockRule(characterId) === undefined || this.state.unlocked.includes(characterId);
	}

	/**
	 * Ghi nhận một ván vừa xong. Trả về danh sách nhân vật VỪA mở nhờ mốc thành
	 * tích, để màn kết thúc bắn toast "Đã mở khoá …".
	 */
	recordGame(options: { correctAnswers: number; leaderboardRank?: number | null }): string[] {
		this.state.gamesPlayed += 1;
		this.state.correctAnswers += Math.max(options.correctAnswers, 0);

		const rank = options.leaderboardRank;

		if (typeof rank === "number" && Number.isFinite(rank) === true && rank > 0) {
			this.state.bestLeaderboardRank =
				this.state.bestLeaderboardRank === null ? rank : Math.min(this.state.bestLeaderboardRank, rank);
		}

		const newlyUnlocked = this.claimAchievements();
		this.persist();
		return newlyUnlocked;
	}

	/** Mở mọi nhân vật đã đạt mốc thành tích. KHÔNG trừ coin. */
	private claimAchievements(): string[] {
		const progress = this.progress;
		const unlockedNow: string[] = [];

		for (const rule of UNLOCK_RULES) {
			if (this.state.unlocked.includes(rule.characterId) === true) {
				continue;
			}

			if (evaluateUnlock(rule.characterId, this.state.unlocked, progress).status !== "claimable") {
				continue;
			}

			this.state.unlocked.push(rule.characterId);
			unlockedNow.push(rule.characterId);
		}

		return unlockedNow;
	}

	/** Mua bằng coin. Trừ ví NGAY trong cùng một lời gọi để không mở mà quên trừ. */
	purchase(characterId: string): PurchaseResult {
		const rule = getUnlockRule(characterId);

		if (rule === undefined) {
			return { ok: false, reason: "unknown-character" };
		}

		if (this.state.unlocked.includes(characterId) === true) {
			return { ok: false, reason: "already-unlocked" };
		}

		const state = this.evaluate(characterId);

		// Đạt mốc thành tích rồi thì mở miễn phí, không được trừ coin oan.
		if (state.status === "claimable") {
			this.state.unlocked.push(characterId);
			this.persist();
			return { ok: true, paidCoins: 0 };
		}

		const wallet = loadWallet();

		if (wallet.coins < rule.price) {
			return { ok: false, reason: "not-enough-coins" };
		}

		saveWallet({ ...wallet, coins: wallet.coins - rule.price });
		this.state.unlocked.push(characterId);
		this.persist();
		return { ok: true, paidCoins: rule.price };
	}

	private persist(): void {
		this.state.signature = signUnlocks(this.state.unlocked);
		saveUnlocks(this.state);
	}
}
