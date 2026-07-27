// Kho nhiệm vụ ngày / huy hiệu / chuỗi ngày (P1-8).
//
// NƠI DUY NHẤT ghi `endlessrunner-missions-v2` và là nơi duy nhất cộng xu thưởng
// nhiệm vụ — cùng kỷ luật một-đường-đi như `Lives` với tim và `Unlocks` với xu
// mở khoá: không nhánh nào trao thưởng mà quên ghi lại.

import { readJson, writeJson, loadWallet, saveWallet, todayKey } from "@/core/SaveData";
import { V2_STORAGE_KEYS } from "@/core/storageKeys";
import { coinLedger } from "@/systems/economyLedger";
import {
	advanceStreak,
	generateDailyMissions,
	isMissionComplete,
	missionDelta,
	newlyEarnedBadges,
	nextStreakMilestone,
	streakMilestoneAt,
	streakRewardCoins,
	type BadgeDefinition,
	type StreakMilestone,
	type BadgeProgress,
	type DailyMissions,
	type MissionDefinition,
	type RunTotals,
	type StreakState
} from "@/systems/missionRules";

export interface MissionsStateV2 {
	daily: DailyMissions;
	earnedBadges: string[];
	streak: StreakState;
	/** Tích luỹ cả đời, để chấm huy hiệu. */
	correctTotal: number;
	correctByDifficulty: Record<string, number>;
}

const DEFAULT_STATE: MissionsStateV2 = {
	daily: { date: "", missions: [], entries: [] },
	earnedBadges: [],
	streak: { lastDate: "", days: 0 },
	correctTotal: 0,
	correctByDifficulty: {}
};

/** Kết quả một ván với hệ nhiệm vụ — App dùng để bắn toast. */
export interface MissionRunResult {
	completedMissions: MissionDefinition[];
	newBadges: BadgeDefinition[];
	/** Tổng xu trao trong ván này — GỒM cả thưởng mốc chuỗi ngày. */
	coinsAwarded: number;
	streakDays: number;
	/** P2-2 — mốc chuỗi ngày vừa chạm (null = hôm nay không chạm mốc nào). */
	streakMilestone: StreakMilestone | null;
	/** Xu riêng của mốc chuỗi ngày, để màn kết thúc nói rõ tiền tới từ đâu. */
	streakCoins: number;
}

function yesterdayKey(now: Date): string {
	const previous = new Date(now.getTime());
	previous.setDate(previous.getDate() - 1);
	return todayKey(previous);
}

export class Missions {
	private state: MissionsStateV2;

	constructor() {
		this.state = this.read();
	}

	private read(): MissionsStateV2 {
		const stored = readJson<MissionsStateV2>(V2_STORAGE_KEYS.missions, DEFAULT_STATE);

		return {
			daily:
				stored.daily !== null && typeof stored.daily === "object"
					? {
							date: typeof stored.daily.date === "string" ? stored.daily.date : "",
							missions: Array.isArray(stored.daily.missions) ? stored.daily.missions : [],
							entries: Array.isArray(stored.daily.entries) ? stored.daily.entries : []
						}
					: { date: "", missions: [], entries: [] },
			earnedBadges: Array.isArray(stored.earnedBadges) ? stored.earnedBadges.filter((id) => typeof id === "string") : [],
			streak:
				stored.streak !== null && typeof stored.streak === "object"
					? {
							lastDate: typeof stored.streak.lastDate === "string" ? stored.streak.lastDate : "",
							days: Number.isFinite(stored.streak.days) ? Math.max(stored.streak.days, 0) : 0
						}
					: { lastDate: "", days: 0 },
			correctTotal: Number.isFinite(stored.correctTotal) ? Math.max(stored.correctTotal, 0) : 0,
			correctByDifficulty:
				stored.correctByDifficulty !== null && typeof stored.correctByDifficulty === "object"
					? stored.correctByDifficulty
					: {}
		};
	}

	reload(): void {
		this.state = this.read();
	}

	/**
	 * Nhiệm vụ của HÔM NAY. Sang ngày mới thì sinh bộ mới và tiến độ về 0 — nhưng
	 * huy hiệu, chuỗi ngày và số câu tích luỹ thì KHÔNG đụng tới.
	 */
	today(now: Date = new Date()): DailyMissions {
		const key = todayKey(now);

		if (this.state.daily.date !== key) {
			const missions = generateDailyMissions(key);
			this.state.daily = {
				date: key,
				missions,
				entries: missions.map((mission) => ({ id: mission.id, progress: 0, claimed: false }))
			};
			this.persist();
		}

		return this.state.daily;
	}

	get badgeProgress(): BadgeProgress {
		return {
			correctTotal: this.state.correctTotal,
			correctByDifficulty: { ...this.state.correctByDifficulty },
			streakDays: this.state.streak.days
		};
	}

	get earnedBadgeIds(): readonly string[] {
		return this.state.earnedBadges;
	}

	get streakDays(): number {
		return this.state.streak.days;
	}

	/**
	 * Ghi nhận một ván. Cộng tiến độ, trả thưởng nhiệm vụ vừa xong, trao huy hiệu
	 * mới, và cập nhật chuỗi ngày — TẤT CẢ trong một lời gọi để không có trạng thái
	 * nửa vời nếu người chơi đóng tab giữa chừng.
	 */
	recordRun(totals: RunTotals, now: Date = new Date()): MissionRunResult {
		const daily = this.today(now);
		const completed: MissionDefinition[] = [];
		let coins = 0;

		for (const mission of daily.missions) {
			const entry = daily.entries.find((item) => item.id === mission.id);

			if (entry === undefined || entry.claimed === true) {
				continue;
			}

			entry.progress += missionDelta(mission, totals);

			if (isMissionComplete(mission, entry.progress) === true) {
				entry.claimed = true;
				coins += mission.reward;
				completed.push(mission);
			}
		}

		this.state.correctTotal += Math.max(totals.correctAnswers, 0);

		for (const [difficulty, count] of Object.entries(totals.correctByDifficulty)) {
			this.state.correctByDifficulty[difficulty] = (this.state.correctByDifficulty[difficulty] ?? 0) + count;
		}

		// Chuỗi ngày cập nhật TRƯỚC khi chấm huy hiệu, để huy hiệu "chơi 7 ngày liên
		// tiếp" được trao ngay trong ván khiến nó đạt mốc.
		const previousStreakDays = this.state.streak.days;
		this.state.streak = advanceStreak(this.state.streak, todayKey(now), yesterdayKey(now));

		// P2-2 — thưởng mốc chuỗi ngày. Cộng vào CÙNG biến `coins` để chỉ có đúng
		// một chỗ chạm ví trong cả hàm: hai lời gọi `saveWallet` là hai cơ hội để
		// một nhánh ghi đè nhánh kia (`loadWallet` của nhánh sau đọc trước khi nhánh
		// trước ghi xong thì phần thưởng đầu biến mất).
		const streakCoins = streakRewardCoins(previousStreakDays, this.state.streak.days);
		coins += streakCoins;

		const newBadges = newlyEarnedBadges(this.badgeProgress, this.state.earnedBadges);

		for (const badge of newBadges) {
			this.state.earnedBadges.push(badge.id);
		}

		if (coins > 0) {
			const wallet = loadWallet();
			saveWallet({ ...wallet, coins: wallet.coins + coins });
			// P2-3 — báo sổ cái server trong CÙNG nhánh đã cộng ví. Một bút toán cho
			// cả nhiệm vụ lẫn mốc chuỗi ngày, đúng như `coins` đã gộp làm một ở trên:
			// hai lời gọi là hai cơ hội để một cái bị mất mà không ai biết.
			coinLedger()?.record("mission", coins, "Nhiệm vụ ngày");
		}

		this.persist();

		return {
			completedMissions: completed,
			newBadges,
			coinsAwarded: coins,
			streakDays: this.state.streak.days,
			streakMilestone: streakCoins > 0 ? streakMilestoneAt(this.state.streak.days) : null,
			streakCoins
		};
	}

	/** Mốc chuỗi ngày kế tiếp — S13 dùng để nói "còn N ngày nữa". */
	get nextMilestone(): StreakMilestone | null {
		return nextStreakMilestone(this.state.streak.days);
	}

	private persist(): void {
		writeJson(V2_STORAGE_KEYS.missions, this.state);
	}
}
