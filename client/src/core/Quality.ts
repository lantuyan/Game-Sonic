// 3 preset chất lượng + auto-detect + tự hạ khi tụt fps (plan §7.1).
//
// Thứ tự hạ BẮT BUỘC: DPR (2 → 1.5 → 1) trước, rồi shadow, rồi bloom.
// Lý do: DPR là đòn bẩy fill-rate mạnh nhất trên GPU tích hợp của máy trường học,
// và hạ DPR ít "đổi hình" hơn là tắt bóng đổ giữa ván.

import { loadSettings, saveSettings, type QualityPresetName } from "@/core/SaveData";

export interface QualitySettings {
	pixelRatioCap: number;
	shadows: boolean;
	shadowMapSize: number;
	bloom: boolean;
	antialias: boolean;
	/** Hệ số mật độ particle (1 = đầy đủ). */
	particleScale: number;
	/** Preset Thấp dùng blob shadow (mặt tròn mờ) thay shadow map. */
	blobShadow: boolean;
}

export const QUALITY_PRESETS: Record<QualityPresetName, QualitySettings> = {
	low: {
		pixelRatioCap: 1,
		shadows: false,
		shadowMapSize: 0,
		bloom: false,
		antialias: false,
		particleScale: 0.4,
		blobShadow: true
	},
	medium: {
		pixelRatioCap: 1.5,
		shadows: true,
		shadowMapSize: 512,
		bloom: false,
		antialias: true,
		particleScale: 0.75,
		blobShadow: false
	},
	high: {
		pixelRatioCap: 2,
		shadows: true,
		shadowMapSize: 1024,
		bloom: true,
		antialias: true,
		particleScale: 1,
		blobShadow: false
	}
};

/** Các nấc hạ dần, áp theo đúng thứ tự (index 0 = đẹp nhất). */
const DEGRADE_STEPS: ReadonlyArray<(settings: QualitySettings) => QualitySettings> = [
	(settings) => ({ ...settings, pixelRatioCap: Math.min(settings.pixelRatioCap, 1.5) }),
	(settings) => ({ ...settings, pixelRatioCap: Math.min(settings.pixelRatioCap, 1) }),
	(settings) => ({ ...settings, bloom: false }),
	(settings) => ({ ...settings, shadows: false, blobShadow: true, shadowMapSize: 0 }),
	(settings) => ({ ...settings, particleScale: Math.min(settings.particleScale, 0.4), antialias: false })
];

/** Dưới ngưỡng này trong `SAMPLE_WINDOW_SEC` liên tiếp thì hạ 1 nấc. */
const DEGRADE_FPS_THRESHOLD = 48;
const SAMPLE_WINDOW_SEC = 3;
/** Sau khi hạ, chờ ổn định rồi mới xét tiếp — tránh hạ liền 5 nấc vì 1 cú giật. */
const COOLDOWN_SEC = 6;

export type QualityChangeListener = (settings: QualitySettings, presetName: QualityPresetName) => void;

export class Quality {
	private presetName: QualityPresetName;
	/** true khi người chơi tự chọn trong S11 → auto-quality không được đụng vào. */
	private manualOverride: boolean;
	private degradeIndex = 0;
	private settings: QualitySettings;

	private sampleSec = 0;
	private sampleFrames = 0;
	private cooldownSec = 0;
	private listener: QualityChangeListener | null = null;

	constructor() {
		const settings = loadSettings();

		this.manualOverride = settings.qualityPreset !== null;
		this.presetName = settings.qualityPreset ?? Quality.detectPreset();
		this.settings = { ...QUALITY_PRESETS[this.presetName] };
	}

	/**
	 * Đoán preset lần đầu bằng tín hiệu rẻ tiền có sẵn (không dựng WebGL context thử):
	 * số nhân CPU, RAM báo cáo, và devicePixelRatio. Đo fps thật sẽ tinh chỉnh tiếp
	 * trong 3 giây đầu ván qua `sample()`.
	 */
	static detectPreset(): QualityPresetName {
		const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
		const cores = navigator.hardwareConcurrency ?? 4;
		const memoryGb = navigatorWithMemory.deviceMemory ?? 4;

		if (cores <= 2 || memoryGb <= 2) {
			return "low";
		}

		if (cores >= 8 && memoryGb >= 8) {
			return "high";
		}

		return "medium";
	}

	get current(): QualitySettings {
		return this.settings;
	}

	get preset(): QualityPresetName {
		return this.presetName;
	}

	get isManual(): boolean {
		return this.manualOverride;
	}

	onChange(listener: QualityChangeListener | null): void {
		this.listener = listener;
	}

	/** Người chơi chọn tay ở S11 — lưu vào `endlessrunner-settings-v2`. */
	setPreset(presetName: QualityPresetName, manual = true): void {
		this.presetName = presetName;
		this.manualOverride = manual;
		this.degradeIndex = 0;
		this.settings = { ...QUALITY_PRESETS[presetName] };
		this.cooldownSec = COOLDOWN_SEC;

		if (manual === true) {
			const settings = loadSettings();
			saveSettings({ ...settings, qualityPreset: presetName });
		}

		this.listener?.(this.settings, this.presetName);
	}

	/**
	 * Gọi mỗi frame với delta THẬT (không phải fixed delta) để đo fps.
	 * Tự hạ 1 nấc khi fps trung bình 3s dưới ngưỡng.
	 */
	sample(realDeltaSec: number): void {
		if (realDeltaSec <= 0 || realDeltaSec > 1) {
			return;
		}

		if (this.cooldownSec > 0) {
			this.cooldownSec -= realDeltaSec;
			return;
		}

		this.sampleSec += realDeltaSec;
		this.sampleFrames += 1;

		if (this.sampleSec < SAMPLE_WINDOW_SEC) {
			return;
		}

		const averageFps = this.sampleFrames / this.sampleSec;
		this.sampleSec = 0;
		this.sampleFrames = 0;

		if (averageFps >= DEGRADE_FPS_THRESHOLD || this.degradeIndex >= DEGRADE_STEPS.length) {
			return;
		}

		// Người chơi chọn tay vẫn được bảo vệ khỏi máy quá yếu, nhưng KHÔNG ghi đè
		// lựa chọn đã lưu — chỉ hạ tạm trong phiên.
		const step = DEGRADE_STEPS[this.degradeIndex];
		this.degradeIndex += 1;

		if (step === undefined) {
			return;
		}

		this.settings = step(this.settings);
		this.cooldownSec = COOLDOWN_SEC;
		this.listener?.(this.settings, this.presetName);
	}

	/** Đưa về đúng preset (bắt đầu ván mới). */
	reset(): void {
		this.degradeIndex = 0;
		this.settings = { ...QUALITY_PRESETS[this.presetName] };
		this.sampleSec = 0;
		this.sampleFrames = 0;
		this.cooldownSec = SAMPLE_WINDOW_SEC;
		this.listener?.(this.settings, this.presetName);
	}
}
