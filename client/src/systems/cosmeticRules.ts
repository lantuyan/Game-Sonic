// Ngoại hình mua được: SKIN (đổi màu nhân vật) + TRAIL (vệt chạy phía sau) — P2-2.
// THUẦN SỐ HỌC, không three, không DOM — cùng khuôn với `systems/unlockRules.ts`.
//
// Vì sao skin là ĐỔI MÀU chứ không phải model mới: ngân sách initial sau P2-1 đã
// là 6.24 MB / 10 MB, mà mỗi nhân vật bị chặn ≤500 KB (plan §6.3). Bốn skin bằng
// model là +2 MB cho một thứ thuần trang trí, trong khi bốn skin bằng tint là
// **0 byte** tải về và vẫn đọc ra ngay từ xa — cái người chơi thật sự nhìn thấy
// khi nhân vật cao 1.75 unit chạy ở 15 unit/s là MÀU, không phải chi tiết mesh.
//
// Vì sao skin dùng chung cho mọi nhân vật (không khoá theo từng con): một em mua
// "Ánh vàng" rồi đổi sang Vẹt mà mất skin thì cảm giác là bị lừa. Skin thuộc về
// NGƯỜI CHƠI, nhân vật chỉ là chỗ mặc vào.

export type CosmeticSlot = "skin" | "trail";

export interface CosmeticDefinition {
	id: string;
	slot: CosmeticSlot;
	label: string;
	description: string;
	/** 0 = mặc định, luôn có sẵn, không mua. */
	price: number;
	/**
	 * Màu chính (0xRRGGBB).
	 *   · skin  — nhân vào màu material gốc, nên 0xffffff = giữ nguyên nguyên bản;
	 *   · trail — màu dải ruy-băng.
	 */
	color: number;
	/** Màu phát sáng của skin (0 = không phát sáng). Trail không dùng. */
	emissive: number;
	/** Cường độ phát sáng 0–1. */
	emissiveIntensity: number;
	/** Màu thứ hai của trail — dải chuyển màu từ `color` sang màu này về cuối đuôi. */
	tailColor: number;
}

export const DEFAULT_SKIN_ID = "skin-classic";
export const DEFAULT_TRAIL_ID = "trail-none";

/**
 * Giá đặt THẤP HƠN nhân vật (300/500/800 của P1-3) một cách có chủ ý: ngoại hình
 * không cho thêm sức mạnh nào, nên nó phải là món thưởng vặt mua được sớm, chứ
 * không phải mục tiêu cạnh tranh với việc mở một bạn chạy mới.
 */
export const COSMETICS: readonly CosmeticDefinition[] = [
	{
		id: DEFAULT_SKIN_ID,
		slot: "skin",
		label: "Nguyên bản",
		description: "Màu gốc của nhân vật.",
		price: 0,
		color: 0xffffff,
		emissive: 0x000000,
		emissiveIntensity: 0,
		tailColor: 0xffffff
	},
	{
		id: "skin-gold",
		slot: "skin",
		label: "Ánh vàng",
		description: "Ánh kim rực rỡ, nhìn từ xa cũng thấy.",
		price: 150,
		color: 0xffc94d,
		emissive: 0x3a2a00,
		emissiveIntensity: 0.12,
		tailColor: 0xffffff
	},
	{
		id: "skin-shadow",
		slot: "skin",
		label: "Bóng đêm",
		description: "Tím thẫm, viền lạnh.",
		price: 150,
		color: 0x6b5bd6,
		emissive: 0x1b0f3a,
		emissiveIntensity: 0.18,
		tailColor: 0xffffff
	},
	{
		id: "skin-neon",
		slot: "skin",
		label: "Dạ quang",
		description: "Xanh lơ phát sáng — hợp chặng Không gian.",
		price: 250,
		color: 0x5ff0d6,
		emissive: 0x0f7d6a,
		emissiveIntensity: 0.35,
		tailColor: 0xffffff
	},
	{
		id: DEFAULT_TRAIL_ID,
		slot: "trail",
		label: "Không vệt",
		description: "Chạy gọn gàng, không để lại gì.",
		price: 0,
		color: 0xffffff,
		emissive: 0x000000,
		emissiveIntensity: 0,
		tailColor: 0xffffff
	},
	{
		id: "trail-spark",
		slot: "trail",
		label: "Vệt lửa",
		description: "Dải cam nóng kéo dài sau lưng.",
		price: 120,
		color: 0xffa23a,
		emissive: 0x000000,
		emissiveIntensity: 0,
		tailColor: 0xff3b2f
	},
	{
		id: "trail-frost",
		slot: "trail",
		label: "Vệt băng",
		description: "Dải xanh lạnh, mờ dần về cuối.",
		price: 120,
		color: 0x8fe4ff,
		emissive: 0x000000,
		emissiveIntensity: 0,
		tailColor: 0x2b6bd6
	},
	{
		id: "trail-rainbow",
		slot: "trail",
		label: "Vệt cầu vồng",
		description: "Chuyển màu từ hồng sang xanh lá.",
		price: 250,
		color: 0xff6bd6,
		emissive: 0x000000,
		emissiveIntensity: 0,
		tailColor: 0x5ff06b
	}
];

export function getCosmetic(id: string): CosmeticDefinition | undefined {
	return COSMETICS.find((item) => item.id === id);
}

export function cosmeticsForSlot(slot: CosmeticSlot): CosmeticDefinition[] {
	return COSMETICS.filter((item) => item.slot === slot);
}

export function defaultCosmeticId(slot: CosmeticSlot): string {
	return slot === "skin" ? DEFAULT_SKIN_ID : DEFAULT_TRAIL_ID;
}

/** Món giá 0 thì ai cũng có — không cần lưu vào danh sách sở hữu. */
export function isFreeCosmetic(id: string): boolean {
	return (getCosmetic(id)?.price ?? -1) === 0;
}

export function ownsCosmetic(id: string, ownedIds: readonly string[]): boolean {
	if (getCosmetic(id) === undefined) {
		return false;
	}

	return isFreeCosmetic(id) === true || ownedIds.includes(id) === true;
}

export type CosmeticState =
	/** Miễn phí, luôn dùng được. */
	| { status: "free" }
	| { status: "owned" }
	| { status: "affordable"; price: number }
	| { status: "locked"; price: number; missingCoins: number };

export function evaluateCosmetic(id: string, ownedIds: readonly string[], coins: number): CosmeticState {
	const item = getCosmetic(id);

	if (item === undefined) {
		return { status: "locked", price: Number.POSITIVE_INFINITY, missingCoins: Number.POSITIVE_INFINITY };
	}

	if (item.price === 0) {
		return { status: "free" };
	}

	if (ownedIds.includes(id) === true) {
		return { status: "owned" };
	}

	if (coins >= item.price) {
		return { status: "affordable", price: item.price };
	}

	return { status: "locked", price: item.price, missingCoins: item.price - coins };
}

/**
 * Chuẩn hoá một id đang trang bị đọc từ localStorage.
 *
 * Ba cách hỏng đều rơi về mặc định thay vì làm sập game hoặc cho mặc đồ chưa mua:
 * id rác · id đúng nhưng sai ô (mặc trail vào ô skin) · id đúng nhưng CHƯA sở hữu
 * (dữ liệu bị sửa tay, hoặc chữ ký sai nên danh sách sở hữu bị bỏ).
 */
export function resolveEquipped(slot: CosmeticSlot, storedId: unknown, ownedIds: readonly string[]): string {
	if (typeof storedId !== "string") {
		return defaultCosmeticId(slot);
	}

	const item = getCosmetic(storedId);

	if (item === undefined || item.slot !== slot || ownsCosmetic(storedId, ownedIds) === false) {
		return defaultCosmeticId(slot);
	}

	return storedId;
}
