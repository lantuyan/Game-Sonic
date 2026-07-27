// Đọc/ghi localStorage an toàn cho V2.
//
// HỢP ĐỒNG (plan §7.3.3): 5 khóa `-v1` do questionBank.js sở hữu — file này KHÔNG
// ghi vào chúng ngoài `endlessrunner-character-v1` (P0-5 phải map id nhân vật cũ,
// task ghi rõ "giữ nguyên KEY"). Mọi khóa mới đều mang hậu tố `-v2`.

import { V1_STORAGE_KEYS, V2_STORAGE_KEYS } from "@/core/storageKeys";

export type QualityPresetName = "low" | "medium" | "high";

export interface SettingsV2 {
	musicVolume: number;
	sfxVolume: number;
	/** null = để auto-quality tự quyết; chuỗi = người chơi đã chọn tay. */
	qualityPreset: QualityPresetName | null;
	lastLevel: string | null;
	/** P1-8 — rung nhẹ khi va chạm/sai (chỉ Android; iOS không hỗ trợ). */
	vibration: boolean;
}

export interface WalletV2 {
	coins: number;
	bestScore: number;
	bestScoreByLevel: Record<string, number>;
	/** Đã migrate cookie `highscoresonic` chưa (chỉ đọc 1 lần — plan §7.3.3). */
	migratedLegacyBestScore: boolean;
}

export const DEFAULT_SETTINGS: SettingsV2 = {
	musicVolume: 0.6,
	sfxVolume: 0.85,
	qualityPreset: null,
	lastLevel: null,
	// Mặc định BẬT: rung là phản hồi hữu ích, và tắt được ngay ở S11.
	vibration: true
};

export const DEFAULT_WALLET: WalletV2 = {
	coins: 0,
	bestScore: 0,
	bestScoreByLevel: {},
	migratedLegacyBestScore: false
};

function readStorage(): Storage | null {
	try {
		// Safari private mode ném ngay ở bước truy cập.
		const storage = window.localStorage;
		const probeKey = "__toanrunner_probe__";
		storage.setItem(probeKey, "1");
		storage.removeItem(probeKey);
		return storage;
	} catch {
		return null;
	}
}

const storage = readStorage();

export function readJson<Value>(key: string, fallbackValue: Value): Value {
	if (storage === null) {
		return fallbackValue;
	}

	try {
		const rawValue = storage.getItem(key);

		if (rawValue === null) {
			return fallbackValue;
		}

		const parsedValue = JSON.parse(rawValue) as unknown;

		if (parsedValue === null || typeof parsedValue !== "object") {
			return fallbackValue;
		}

		// Trộn với mặc định để dữ liệu cũ thiếu field không làm sập game.
		return { ...fallbackValue, ...(parsedValue as object) } as Value;
	} catch {
		return fallbackValue;
	}
}

export function writeJson(key: string, value: unknown): void {
	if (storage === null) {
		return;
	}

	try {
		storage.setItem(key, JSON.stringify(value));
	} catch {
		// Hết quota / chế độ riêng tư: bỏ qua, game vẫn chơi được.
	}
}

export function readRaw(key: string): string | null {
	if (storage === null) {
		return null;
	}

	try {
		return storage.getItem(key);
	} catch {
		return null;
	}
}

export function writeRaw(key: string, value: string): void {
	if (storage === null) {
		return;
	}

	try {
		storage.setItem(key, value);
	} catch {
		// Bỏ qua như trên.
	}
}

export function loadSettings(): SettingsV2 {
	const settings = readJson<SettingsV2>(V2_STORAGE_KEYS.settings, DEFAULT_SETTINGS);

	return {
		musicVolume: clampVolume(settings.musicVolume, DEFAULT_SETTINGS.musicVolume),
		sfxVolume: clampVolume(settings.sfxVolume, DEFAULT_SETTINGS.sfxVolume),
		qualityPreset: isQualityPreset(settings.qualityPreset) ? settings.qualityPreset : null,
		lastLevel: typeof settings.lastLevel === "string" ? settings.lastLevel : null,
		vibration: settings.vibration !== false
	};
}

export function saveSettings(settings: SettingsV2): void {
	writeJson(V2_STORAGE_KEYS.settings, settings);
}

/**
 * Số lần hồi sinh đã dùng HÔM NAY (P1-5).
 *
 * Lưu chung khoá `unlocks-v2` thay vì thêm khoá thứ sáu: cả hai đều là "tiến trình
 * ngoài ván", đọc/ghi cùng lúc, và một khoá ít hơn là một chỗ ít hỏng hơn.
 * `date` là chuỗi `YYYY-MM-DD` theo giờ MÁY người chơi — đúng cảm nhận "hôm nay"
 * của học sinh, không phải UTC.
 */
export interface RevivalUsage {
	date: string;
	count: number;
}

export function todayKey(now: Date): string {
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

/** Nhân vật đã mở khoá + tiến trình chấm mốc thành tích (P1-3). */
export interface UnlocksV2 {
	unlocked: string[];
	gamesPlayed: number;
	correctAnswers: number;
	/** Hạng tốt nhất từng đạt trên BXH; null = chưa từng lên bảng. */
	bestLeaderboardRank: number | null;
	/** Chữ ký của `unlocked` — xem `systems/unlockRules.signUnlocks`. */
	signature: string;
	/** P1-5 — số lần hồi sinh đã dùng trong ngày. */
	revival: RevivalUsage;
	/**
	 * P2-2 — ngoại hình (skin/trail) đã mua.
	 *
	 * Ký RIÊNG bằng `cosmeticSignature` chứ không nhét chung vào `signature`: chữ
	 * ký cũ đã nằm trên máy người chơi từ P1-3, gộp vào là mọi bản lưu hiện có
	 * thành "sai chữ ký" và cả lớp mất sạch nhân vật đã mua trong một lần cập nhật.
	 */
	cosmetics: string[];
	cosmeticSignature: string;
	/** Id đang trang bị. Chuẩn hoá lúc đọc ở `systems/cosmeticRules.resolveEquipped`. */
	equippedSkin: string;
	equippedTrail: string;
}

export const DEFAULT_UNLOCKS: UnlocksV2 = {
	unlocked: [],
	gamesPlayed: 0,
	correctAnswers: 0,
	bestLeaderboardRank: null,
	signature: "",
	revival: { date: "", count: 0 },
	cosmetics: [],
	cosmeticSignature: "",
	equippedSkin: "",
	equippedTrail: ""
};

/**
 * Đọc tiến trình mở khoá.
 *
 * `verify` do phía gọi truyền vào (systems/unlockRules) để file này không phải
 * biết luật mở khoá. Chữ ký sai → coi như CHƯA mở nhân vật nào, nhưng GIỮ NGUYÊN
 * số ván/số câu đúng: sửa tay danh sách nhân vật thì mất nhân vật, chứ không mất
 * luôn thành tích học tập của em đó.
 */
export function loadUnlocks(verify: (ids: readonly string[], signature: string) => boolean): UnlocksV2 {
	const stored = readJson<UnlocksV2>(V2_STORAGE_KEYS.unlocks, DEFAULT_UNLOCKS);
	const unlocked = Array.isArray(stored.unlocked)
		? stored.unlocked.filter((id): id is string => typeof id === "string")
		: [];
	const signature = typeof stored.signature === "string" ? stored.signature : "";
	const trusted = unlocked.length === 0 || verify(unlocked, signature);

	// Ngoại hình đi qua ĐÚNG cùng một cửa: sửa tay danh sách thì mất ngoại hình đã
	// mua, nhưng KHÔNG kéo theo mất nhân vật (và ngược lại) — hai chữ ký độc lập.
	const cosmetics = Array.isArray(stored.cosmetics)
		? stored.cosmetics.filter((id): id is string => typeof id === "string")
		: [];
	const cosmeticSignature = typeof stored.cosmeticSignature === "string" ? stored.cosmeticSignature : "";
	const cosmeticsTrusted = cosmetics.length === 0 || verify(cosmetics, cosmeticSignature);

	return {
		unlocked: trusted ? unlocked : [],
		gamesPlayed: Math.max(toFiniteNumber(stored.gamesPlayed, 0), 0),
		correctAnswers: Math.max(toFiniteNumber(stored.correctAnswers, 0), 0),
		bestLeaderboardRank:
			typeof stored.bestLeaderboardRank === "number" && Number.isFinite(stored.bestLeaderboardRank)
				? stored.bestLeaderboardRank
				: null,
		signature: trusted ? signature : "",
		revival: normalizeRevival(stored.revival),
		cosmetics: cosmeticsTrusted ? cosmetics : [],
		cosmeticSignature: cosmeticsTrusted ? cosmeticSignature : "",
		equippedSkin: typeof stored.equippedSkin === "string" ? stored.equippedSkin : "",
		equippedTrail: typeof stored.equippedTrail === "string" ? stored.equippedTrail : ""
	};
}

/**
 * Số lần hồi sinh chỉ có ý nghĩa trong NGÀY của nó — sang ngày mới thì đếm lại từ 0
 * mà không cần tác vụ dọn dẹp nào.
 */
function normalizeRevival(stored: unknown): RevivalUsage {
	if (stored === null || typeof stored !== "object") {
		return { date: "", count: 0 };
	}

	const value = stored as Partial<RevivalUsage>;

	return {
		date: typeof value.date === "string" ? value.date : "",
		count: Math.max(toFiniteNumber(value.count, 0), 0)
	};
}

export function saveUnlocks(unlocks: UnlocksV2): void {
	writeJson(V2_STORAGE_KEYS.unlocks, unlocks);
}

export function loadWallet(): WalletV2 {
	const wallet = readJson<WalletV2>(V2_STORAGE_KEYS.wallet, DEFAULT_WALLET);

	return {
		coins: toFiniteNumber(wallet.coins, 0),
		bestScore: toFiniteNumber(wallet.bestScore, 0),
		bestScoreByLevel:
			wallet.bestScoreByLevel !== null && typeof wallet.bestScoreByLevel === "object"
				? wallet.bestScoreByLevel
				: {},
		migratedLegacyBestScore: wallet.migratedLegacyBestScore === true
	};
}

export function saveWallet(wallet: WalletV2): void {
	writeJson(V2_STORAGE_KEYS.wallet, wallet);
}

/** Đọc cookie best score của V1 đúng 1 lần rồi thôi (plan §7.3.3). */
export function migrateLegacyBestScore(wallet: WalletV2): WalletV2 {
	if (wallet.migratedLegacyBestScore === true) {
		return wallet;
	}

	const legacyValue = readLegacyCookie("highscoresonic");
	const legacyScore = legacyValue === null ? 0 : Number.parseInt(legacyValue, 10);
	const migratedWallet: WalletV2 = {
		...wallet,
		bestScore: Number.isFinite(legacyScore) ? Math.max(wallet.bestScore, legacyScore) : wallet.bestScore,
		migratedLegacyBestScore: true
	};

	saveWallet(migratedWallet);
	return migratedWallet;
}

function readLegacyCookie(name: string): string | null {
	if (typeof document === "undefined") {
		return null;
	}

	for (const part of document.cookie.split(";")) {
		const separatorIndex = part.indexOf("=");

		if (separatorIndex === -1) {
			continue;
		}

		if (part.slice(0, separatorIndex).trim() === name) {
			return decodeURIComponent(part.slice(separatorIndex + 1).trim());
		}
	}

	return null;
}

export function isQualityPreset(value: unknown): value is QualityPresetName {
	return value === "low" || value === "medium" || value === "high";
}

function clampVolume(value: unknown, fallbackValue: number): number {
	const numericValue = Number(value);

	if (Number.isFinite(numericValue) === false) {
		return fallbackValue;
	}

	return Math.min(Math.max(numericValue, 0), 1);
}

function toFiniteNumber(value: unknown, fallbackValue: number): number {
	const numericValue = Number(value);
	return Number.isFinite(numericValue) ? numericValue : fallbackValue;
}

export { V1_STORAGE_KEYS, V2_STORAGE_KEYS };
