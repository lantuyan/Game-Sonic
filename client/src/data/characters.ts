// Bảng 4 nhân vật P0 + ánh xạ id cũ (plan §3 Q5, hợp đồng §7.3.3).
//
// HỢP ĐỒNG: khóa `endlessrunner-character-v1` GIỮ NGUYÊN TÊN. Chỉ GIÁ TRỊ được map
// từ id V1 sang id V2, rồi ghi đè lại — người chơi cũ mở lên thấy đúng nhân vật
// tương ứng chứ không bị reset về mặc định.

import { V1_STORAGE_KEYS } from "@/core/storageKeys";
import { readRaw, writeRaw } from "@/core/SaveData";

export interface CharacterDefinition {
	id: string;
	/** Giá trị từng được lưu bởi V1. */
	legacyId: string;
	label: string;
	description: string;
	url: string;
}

export const CHARACTERS: readonly CharacterDefinition[] = [
	{
		id: "knight",
		legacyId: "sonic",
		label: "Hiệp sĩ",
		description: "Nhanh nhẹn, đủ mọi động tác.",
		url: "models/characters/knight.glb"
	},
	{
		id: "robot",
		legacyId: "robot",
		label: "Rô-bốt",
		description: "Bạn cũ từ phiên bản trước.",
		url: "models/characters/robot.glb"
	},
	{
		id: "fox",
		legacyId: "horse",
		label: "Cáo",
		description: "Bốn chân, chạy êm.",
		url: "models/characters/fox.glb"
	},
	{
		id: "parrot",
		legacyId: "parrot",
		label: "Vẹt",
		description: "Nhẹ như gió.",
		url: "models/characters/parrot.glb"
	}
];

export const DEFAULT_CHARACTER_ID = "knight";

export function getCharacter(id: string): CharacterDefinition | undefined {
	return CHARACTERS.find((character) => character.id === id);
}

/**
 * Chuẩn hoá một giá trị bất kỳ đọc từ localStorage về id nhân vật V2.
 * Nhận: id V2 hợp lệ · id V1 cũ (`sonic`/`robot`/`horse`/`parrot`) · rác/null.
 */
export function resolveCharacterId(storedValue: string | null): string {
	if (storedValue === null) {
		return DEFAULT_CHARACTER_ID;
	}

	const trimmed = storedValue.trim().replace(/^"|"$/g, "").toLowerCase();

	if (trimmed === "") {
		return DEFAULT_CHARACTER_ID;
	}

	const direct = CHARACTERS.find((character) => character.id === trimmed);

	if (direct !== undefined) {
		return direct.id;
	}

	const legacy = CHARACTERS.find((character) => character.legacyId === trimmed);

	if (legacy !== undefined) {
		return legacy.id;
	}

	return DEFAULT_CHARACTER_ID;
}

/**
 * Đọc nhân vật đã chọn. Nếu giá trị đang là id V1 thì map sang V2 và GHI LẠI ngay
 * (migrate 1 lần), vẫn dùng đúng khóa `-v1` theo hợp đồng.
 */
export function loadSelectedCharacterId(): string {
	const stored = readRaw(V1_STORAGE_KEYS.character);
	const resolved = resolveCharacterId(stored);

	if (stored !== resolved) {
		writeRaw(V1_STORAGE_KEYS.character, resolved);
	}

	return resolved;
}

export function saveSelectedCharacterId(id: string): void {
	writeRaw(V1_STORAGE_KEYS.character, resolveCharacterId(id));
}
