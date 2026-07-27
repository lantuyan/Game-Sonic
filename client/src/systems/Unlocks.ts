// Kho tiến trình mở khoá (P1-3) — nối `systems/unlockRules` (luật thuần) với
// `core/SaveData` (localStorage) và ví coin.
//
// Đây là NƠI DUY NHẤT ghi `endlessrunner-unlocks-v2`, y như Lives là nơi duy nhất
// trừ tim: mọi đường mở khoá (mua, đạt mốc, tự động sau ván) đều đi qua đây nên
// không có nhánh nào lỡ tay mở nhân vật mà quên trừ coin.

import { loadUnlocks, saveUnlocks, loadWallet, saveWallet, todayKey, type UnlocksV2 } from "@/core/SaveData";
import {
	evaluateUnlock,
	getUnlockRule,
	signUnlocks,
	verifyUnlocks,
	UNLOCK_RULES,
	type UnlockProgress,
	type UnlockState
} from "@/systems/unlockRules";
import {
	defaultCosmeticId,
	evaluateCosmetic,
	getCosmetic,
	ownsCosmetic,
	resolveEquipped,
	type CosmeticSlot,
	type CosmeticState
} from "@/systems/cosmeticRules";

export type PurchaseResult =
	| { ok: true; paidCoins: number }
	| { ok: false; reason: "unknown-character" | "already-unlocked" | "not-enough-coins" };

export type CosmeticPurchaseResult =
	| { ok: true; paidCoins: number }
	| { ok: false; reason: "unknown-cosmetic" | "already-owned" | "not-enough-coins" };

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

	// --- Ngoại hình: skin + trail (P2-2) --------------------------------------
	//
	// Cùng một kỷ luật một-đường-đi như nhân vật: đây là NƠI DUY NHẤT ghi quyền sở
	// hữu ngoại hình và là nơi duy nhất trừ xu cho nó. Cửa hàng chỉ gọi vào đây.

	get ownedCosmeticIds(): readonly string[] {
		return this.state.cosmetics;
	}

	ownsCosmetic(id: string): boolean {
		return ownsCosmetic(id, this.state.cosmetics);
	}

	evaluateCosmetic(id: string): CosmeticState {
		return evaluateCosmetic(id, this.state.cosmetics, loadWallet().coins);
	}

	/** Id đang trang bị, đã chuẩn hoá (rác/chưa mua → mặc định). */
	equipped(slot: CosmeticSlot): string {
		const stored = slot === "skin" ? this.state.equippedSkin : this.state.equippedTrail;
		return resolveEquipped(slot, stored, this.state.cosmetics);
	}

	/**
	 * Trang bị một món. Trả về false khi món không tồn tại, sai ô, hoặc chưa mua —
	 * mặc đồ chưa mua phải bị chặn Ở ĐÂY, không phải ở tầng UI.
	 */
	equip(id: string): boolean {
		const item = getCosmetic(id);

		if (item === undefined || ownsCosmetic(id, this.state.cosmetics) === false) {
			return false;
		}

		if (item.slot === "skin") {
			this.state.equippedSkin = id;
		} else {
			this.state.equippedTrail = id;
		}

		this.persist();
		return true;
	}

	/** Gỡ về mặc định (Nguyên bản / Không vệt). */
	unequip(slot: CosmeticSlot): void {
		if (slot === "skin") {
			this.state.equippedSkin = defaultCosmeticId("skin");
		} else {
			this.state.equippedTrail = defaultCosmeticId("trail");
		}

		this.persist();
	}

	/** Mua bằng xu. Trừ ví NGAY trong cùng lời gọi, y như `purchase`. */
	purchaseCosmetic(id: string): CosmeticPurchaseResult {
		const item = getCosmetic(id);

		if (item === undefined) {
			return { ok: false, reason: "unknown-cosmetic" };
		}

		if (ownsCosmetic(id, this.state.cosmetics) === true) {
			return { ok: false, reason: "already-owned" };
		}

		const wallet = loadWallet();

		if (wallet.coins < item.price) {
			return { ok: false, reason: "not-enough-coins" };
		}

		saveWallet({ ...wallet, coins: wallet.coins - item.price });
		this.state.cosmetics.push(id);
		// Mua xong mặc luôn: bắt bấm thêm một nút nữa mới thấy thứ vừa trả tiền là
		// một bước thừa mà ai cũng phải làm.
		if (item.slot === "skin") {
			this.state.equippedSkin = id;
		} else {
			this.state.equippedTrail = id;
		}

		this.persist();
		return { ok: true, paidCoins: item.price };
	}

	// --- Hồi sinh (P1-5) ------------------------------------------------------

	/** Số lần hồi sinh đã dùng HÔM NAY. Sang ngày mới tự về 0. */
	revivalUsedToday(now: Date = new Date()): number {
		return this.state.revival.date === todayKey(now) ? this.state.revival.count : 0;
	}

	/**
	 * Ghi nhận một lần hồi sinh. `coinCost > 0` thì trừ ví NGAY trong cùng lời gọi,
	 * cùng lý do như `purchase`: không để nhánh nào cho sống lại mà quên trừ.
	 * Trả về false khi không đủ coin — khi đó KHÔNG ghi nhận gì.
	 */
	consumeRevival(coinCost: number, now: Date = new Date()): boolean {
		if (coinCost > 0) {
			const wallet = loadWallet();

			if (wallet.coins < coinCost) {
				return false;
			}

			saveWallet({ ...wallet, coins: wallet.coins - coinCost });
		}

		const key = todayKey(now);
		this.state.revival =
			this.state.revival.date === key
				? { date: key, count: this.state.revival.count + 1 }
				: { date: key, count: 1 };

		this.persist();
		return true;
	}

	private persist(): void {
		this.state.signature = signUnlocks(this.state.unlocked);
		this.state.cosmeticSignature = signUnlocks(this.state.cosmetics);
		saveUnlocks(this.state);
	}
}
