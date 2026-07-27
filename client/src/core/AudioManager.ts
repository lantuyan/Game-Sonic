// Âm thanh (plan §4, P0-11) — bọc Howler.
//
// Ba điều quan trọng:
//   1. **Throttle giọng**: ăn 20 coin/giây mà phát 20 lần cùng file thì tiếng bị
//      chồng méo và vỡ. Mỗi SFX có khoảng cách phát tối thiểu.
//   2. **Ducking**: hạ BGM −8dB khi telegraph/trạm/modal để đề bài "nổi" lên.
//   3. **Unlock theo gesture đầu**: iOS chặn autoplay; Howler tự lo phần lớn,
//      nhưng ta vẫn hoãn phát BGM tới lần tương tác đầu tiên.
//
// Volume nhạc và SFX TÁCH RIÊNG (S11) và lưu vào `endlessrunner-settings-v2`.

import { Howl, Howler } from "howler";
import { loadSettings, saveSettings } from "@/core/SaveData";

export type SfxName =
	| "ui-click"
	| "ui-back"
	| "ui-confirm"
	| "countdown"
	| "coin"
	| "powerup"
	| "fever"
	| "answer-correct"
	| "answer-wrong"
	| "game-over"
	| "new-record"
	| "hit"
	| "land"
	| "jump"
	| "gate-bell"
	// P1-1 — Boss Gate + near-miss.
	| "boss-appear"
	| "boss-defeat"
	| "near-miss";

export type BgmName = "bgm-menu" | "bgm-biome1" | "bgm-biome2" | "bgm-biome3";

/** Khoảng cách phát tối thiểu (ms) cho từng SFX — chống chồng tiếng. */
const THROTTLE_MS: Partial<Record<SfxName, number>> = {
	coin: 60,
	land: 120,
	jump: 120,
	hit: 200,
	// Cụm 2 chướng ngại sát nhau cho 2 near-miss trong cùng frame — throttle để
	// không nghe thành một tiếng "xoẹt" méo.
	"near-miss": 260
};

const DEFAULT_THROTTLE_MS = 40;
/** Ducking −8dB ≈ nhân biên độ 0.4 (plan §4). */
const DUCK_FACTOR = 0.4;
const DUCK_FADE_MS = 220;

export class AudioManager {
	private readonly sfx = new Map<SfxName, Howl>();
	private readonly bgm = new Map<BgmName, Howl>();
	private readonly lastPlayedAtMs = new Map<SfxName, number>();

	private musicVolume: number;
	private sfxVolume: number;
	private ducked = false;
	private bgmRate = 1;
	private unlocked = false;
	private currentBgm: BgmName | null = null;
	private pendingBgm: BgmName | null = null;
	private readonly baseUrl: string;

	private readonly handleFirstGesture = (): void => {
		this.unlocked = true;
		window.removeEventListener("pointerdown", this.handleFirstGesture);
		window.removeEventListener("keydown", this.handleFirstGesture);

		if (this.pendingBgm !== null) {
			const track = this.pendingBgm;
			this.pendingBgm = null;
			this.playBgm(track);
		}
	};

	constructor(baseUrl = import.meta.env.BASE_URL) {
		this.baseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

		const settings = loadSettings();
		this.musicVolume = settings.musicVolume;
		this.sfxVolume = settings.sfxVolume;

		window.addEventListener("pointerdown", this.handleFirstGesture, { once: true });
		window.addEventListener("keydown", this.handleFirstGesture, { once: true });
	}

	/** Nạp trước SFX. Lỗi nạp KHÔNG được làm sập game — chỉ mất tiếng. */
	preloadSfx(names: readonly SfxName[]): void {
		for (const name of names) {
			if (this.sfx.has(name) === true) {
				continue;
			}

			const howl = new Howl({
				src: [`${this.baseUrl}audio/${name}.ogg`],
				volume: this.sfxVolume,
				preload: true,
				html5: false,
				onloaderror: () => {
					console.warn(`[audio] không nạp được SFX "${name}"`);
				}
			});

			this.sfx.set(name, howl);
		}
	}

	play(name: SfxName): void {
		const howl = this.sfx.get(name);

		if (howl === undefined) {
			return;
		}

		// Throttle: bỏ qua lời gọi tới quá sớm sau lời gọi trước của CÙNG tiếng.
		const nowMs = performance.now();
		const lastMs = this.lastPlayedAtMs.get(name) ?? -Infinity;
		const minimumGap = THROTTLE_MS[name] ?? DEFAULT_THROTTLE_MS;

		if (nowMs - lastMs < minimumGap) {
			return;
		}

		this.lastPlayedAtMs.set(name, nowMs);
		howl.volume(this.sfxVolume);
		howl.play();
	}

	playBgm(name: BgmName): void {
		if (this.unlocked === false) {
			// Chưa có gesture nào: nhớ lại, phát ngay khi người chơi chạm/bấm.
			this.pendingBgm = name;
			return;
		}

		if (this.currentBgm === name) {
			return;
		}

		this.stopBgm();

		let howl = this.bgm.get(name);

		if (howl === undefined) {
			howl = new Howl({
				src: [`${this.baseUrl}audio/${name}.ogg`],
				volume: this.effectiveMusicVolume,
				loop: true,
				html5: true,
				onloaderror: () => {
					console.warn(`[audio] không nạp được BGM "${name}"`);
				}
			});
			this.bgm.set(name, howl);
		}

		howl.volume(this.effectiveMusicVolume);
		howl.rate(this.bgmRate);
		howl.play();
		this.currentBgm = name;
	}

	stopBgm(): void {
		if (this.currentBgm === null) {
			return;
		}

		this.bgm.get(this.currentBgm)?.stop();
		this.currentBgm = null;
	}

	private get effectiveMusicVolume(): number {
		return this.ducked === true ? this.musicVolume * DUCK_FACTOR : this.musicVolume;
	}

	/** Hạ BGM khi có đề trên màn (telegraph/trạm/modal), trả lại khi xong. */
	setDucked(ducked: boolean): void {
		if (this.ducked === ducked) {
			return;
		}

		this.ducked = ducked;

		if (this.currentBgm === null) {
			return;
		}

		const howl = this.bgm.get(this.currentBgm);
		howl?.fade(howl.volume(), this.effectiveMusicVolume, DUCK_FADE_MS);
	}

	get isDucked(): boolean {
		return this.ducked;
	}

	/**
	 * "Nhạc căng" của Boss Gate (P1-1) = tăng nhịp BGM đang phát.
	 *
	 * Không tải track boss riêng: ~250KB cho khoảng 10 giây mỗi 3 phút là món hời
	 * tệ trong ngân sách 10MB, còn nâng rate cho đúng cảm giác dồn dập và tốn 0 KB.
	 * Gọi `setBgmRate(1)` để trả lại bình thường.
	 */
	setBgmRate(rate: number): void {
		this.bgmRate = Number.isFinite(rate) === true && rate > 0 ? rate : 1;

		if (this.currentBgm === null) {
			return;
		}

		this.bgm.get(this.currentBgm)?.rate(this.bgmRate);
	}

	setMusicVolume(volume: number): void {
		this.musicVolume = clamp01(volume);
		this.persist();

		if (this.currentBgm !== null) {
			this.bgm.get(this.currentBgm)?.volume(this.effectiveMusicVolume);
		}
	}

	setSfxVolume(volume: number): void {
		this.sfxVolume = clamp01(volume);
		this.persist();
	}

	get music(): number {
		return this.musicVolume;
	}

	get effects(): number {
		return this.sfxVolume;
	}

	private persist(): void {
		const settings = loadSettings();
		saveSettings({ ...settings, musicVolume: this.musicVolume, sfxVolume: this.sfxVolume });
	}

	/** Tắt hẳn mọi tiếng (pause game / rời tab). */
	setMuted(muted: boolean): void {
		Howler.mute(muted);
	}

	dispose(): void {
		this.stopBgm();

		for (const howl of this.sfx.values()) {
			howl.unload();
		}

		for (const howl of this.bgm.values()) {
			howl.unload();
		}

		this.sfx.clear();
		this.bgm.clear();
		window.removeEventListener("pointerdown", this.handleFirstGesture);
		window.removeEventListener("keydown", this.handleFirstGesture);
	}
}

function clamp01(value: number): number {
	if (Number.isFinite(value) === false) {
		return 0;
	}

	return Math.min(Math.max(value, 0), 1);
}

/** Bộ SFX cần cho một ván — dùng ở RunScene. */
export const RUN_SFX: readonly SfxName[] = [
	"coin",
	"jump",
	"land",
	"hit",
	"answer-correct",
	"answer-wrong",
	"gate-bell",
	"powerup",
	"fever",
	"game-over",
	"new-record",
	"countdown",
	"boss-appear",
	"boss-defeat",
	"near-miss"
];
