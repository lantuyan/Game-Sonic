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
	lastLevel: null
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
		lastLevel: typeof settings.lastLevel === "string" ? settings.lastLevel : null
	};
}

export function saveSettings(settings: SettingsV2): void {
	writeJson(V2_STORAGE_KEYS.settings, settings);
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
