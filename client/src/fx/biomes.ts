// Danh mục biome (plan §3 Q4 / §4.2). Boss Gate thắng hay thua đều CHUYỂN BIOME —
// đó là phần thưởng thị giác cho việc sống sót hết một chặng.
//
// P0 chỉ có biome ① (Thành phố + Công viên). P1-2 thêm ② Bãi biển và ③ Núi tuyết;
// vòng lặp quay vòng nên dù chỉ có 1 biome thì `nextBiomeIndex` vẫn trả về hợp lệ
// và chặng mới chạy tiếp — không có nhánh "chưa có biome" nào phải xử lý riêng.

import { BIOME_CITY_PARK, type BiomePalette } from "@/fx/Sky";
import type { BgmName } from "@/core/AudioManager";

export interface BiomeDefinition {
	id: string;
	/** Tên hiện trên banner "Chặng mới". */
	label: string;
	palette: BiomePalette;
	bgm: BgmName;
	/** Lớp trang trí hai bên đường — mỗi mục là 1 InstancedMesh (1 draw call). */
	decor: { name: string; url: string; capacity: number }[];
}

export const BIOMES: readonly BiomeDefinition[] = [
	{
		id: "city-park",
		label: "Thành phố & Công viên",
		palette: BIOME_CITY_PARK,
		bgm: "bgm-biome1",
		decor: [
			// Capacity = số bản sao TỐI ĐA hiển thị cùng lúc, cũng là trần tam giác của
			// lớp đó. Nhà Kenney nặng hơn cây nhiều lần nên capacity thấp hơn hẳn.
			{ name: "tree-a", url: "models/props/tree-a.glb", capacity: 20 },
			{ name: "tree-b", url: "models/props/tree-b.glb", capacity: 20 },
			{ name: "tree-c", url: "models/props/tree-c.glb", capacity: 16 },
			{ name: "building-a", url: "models/props/building-a.glb", capacity: 8 },
			{ name: "building-b", url: "models/props/building-b.glb", capacity: 8 },
			{ name: "building-c", url: "models/props/building-c.glb", capacity: 8 },
			{ name: "fence", url: "models/props/fence.glb", capacity: 18 },
			{ name: "streetlight", url: "models/props/streetlight.glb", capacity: 12 }
		]
	}
];

export function biomeAt(index: number): BiomeDefinition {
	const biome = BIOMES[((index % BIOMES.length) + BIOMES.length) % BIOMES.length];

	if (biome === undefined) {
		throw new Error("Bảng BIOMES rỗng — phải có ít nhất biome ①.");
	}

	return biome;
}

/** Biome kế tiếp trong vòng lặp. */
export function nextBiomeIndex(current: number): number {
	return (current + 1) % BIOMES.length;
}
