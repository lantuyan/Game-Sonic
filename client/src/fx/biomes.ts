// Danh mục biome (plan §3 Q4 / §4.2). Boss Gate thắng hay thua đều CHUYỂN BIOME —
// đó là phần thưởng thị giác cho việc sống sót hết một chặng.
//
// Mỗi biome tự khai đủ 4 thứ: bảng màu, BGM, props chướng ngại, trang trí hai bên.
// Nhờ vậy thêm biome ④ ở P2 chỉ là thêm một phần tử vào mảng — RunScene không phải
// biết biome nào là biome nào.
//
// NGÂN SÁCH (DoD P1-2): mỗi biome ≤3MB, <100 draw call. Số draw call = 3 (đường,
// vạch, nền) + số lớp `decor` + 4 lớp chướng ngại (P2-1 thêm lớp di động) + coin +
// player + cổng. Vì vậy `decor` giữ ở 6–8 lớp, đúng như biome ① của P0.

import type { BgmName } from "@/core/AudioManager";

/**
 * Bảng màu một biome. Sống ở đây chứ không ở fx/Sky.ts vì đây là DỮ LIỆU thuần —
 * nhờ vậy `node --test` nạp được mà không kéo theo three/WebGL.
 */
export interface BiomePalette {
	/** Màu đỉnh trời. */
	top: number;
	/** Màu chân trời — fog PHẢI dùng đúng màu này. */
	horizon: number;
	/** Màu dưới đường chân trời (đất/sương). */
	bottom: number;
	ground: number;
	road: number;
	roadLine: number;
}

/** Biome ① — Thành phố + Công viên (plan §3 Q4). */
export const BIOME_CITY_PARK: BiomePalette = {
	top: 0x2f7ce0,
	horizon: 0x9fd0ff,
	bottom: 0xd8ecff,
	ground: 0x4c9a4a,
	road: 0x5b6273,
	roadLine: 0xf2f4f8
};

/** Biome ② — Bãi biển (Kenney Pirate Kit). */
export const BIOME_BEACH: BiomePalette = {
	top: 0x1fa2d8,
	horizon: 0xbfeaf5,
	bottom: 0xf3e2b8,
	// Cát, không phải cỏ.
	ground: 0xe8cf95,
	// Lối ván gỗ trên cát — tương phản đủ với nền cát sáng để vẫn thấy rõ mép đường.
	road: 0x9a6f42,
	roadLine: 0xfff6df
};

/** Biome ③ — Núi tuyết (Kenney Holiday Kit). */
export const BIOME_SNOW: BiomePalette = {
	// Xanh mùa đông TRONG, không phải xám chiều tà: 0x4f6d9e cho ra bầu trời u ám,
	// đọc ra "sắp bão" chứ không phải "ngày tuyết đẹp" — sai tông cho game trẻ em.
	top: 0x7ba7d9,
	horizon: 0xdfe9f5,
	bottom: 0xf4f8ff,
	ground: 0xeef4fb,
	road: 0x77839a,
	roadLine: 0xffffff
};

/** Biome ④ — Không gian (Kenney Space Kit). */
export const BIOME_SPACE: BiomePalette = {
	// Không dùng đen tuyền: trời đen làm mọi prop low-poly mất viền và bầu không khí
	// hoá ra u ám. Tím-xanh đậm vẫn đọc ra "vũ trụ" mà vẫn còn tương phản cho vật thể.
	top: 0x141634,
	horizon: 0x4a3a7a,
	bottom: 0x2a2350,
	// Đất đá hành tinh đỏ cam — tương phản mạnh với trời tím, đúng chất tranh bìa
	// truyện khoa học viễn tưởng cho trẻ con.
	ground: 0x8a5a4a,
	road: 0x3d4a63,
	roadLine: 0x7fe6ff
};

export interface BiomeDecorSource {
	name: string;
	url: string;
	capacity: number;
}

export interface BiomeDefinition {
	id: string;
	/** Tên hiện trên banner "Chặng mới". */
	label: string;
	palette: BiomePalette;
	bgm: BgmName;
	/**
	 * 3 loại chướng ngại đọc-được-ngay (plan §4.2) — mỗi biome một bộ "da" — cộng
	 * `moving` của P2-1.
	 *
	 * `moving` về LUẬT là loại `full` (không tư thế nào né được, chỉ đổi làn); nó
	 * tách ra thành khai báo riêng vì cần một model đọc-ra-được-là-đang-chạy: chiếc
	 * thùng của biome trôi ngang trông như lỗi đồ hoạ, còn chiếc xe thì không.
	 */
	obstacles: { low: string; high: string; full: string; moving: string };
	/** Trang trí hai bên đường — mỗi mục là 1 InstancedMesh (1 draw call). */
	decor: BiomeDecorSource[];
}

export const BIOMES: readonly BiomeDefinition[] = [
	{
		id: "city-park",
		label: "Thành phố & Công viên",
		palette: BIOME_CITY_PARK,
		bgm: "bgm-biome1",
		obstacles: {
			low: "models/props/obstacle-low-fence.glb",
			high: "models/props/obstacle-high-sign.glb",
			full: "models/props/obstacle-full-crate.glb",
			// Chiếc taxi băng ngang đường — đọc ra "xe đang chạy" ngay từ xa.
			moving: "models/props/obstacle-move-city.glb"
		},
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
	},
	{
		id: "beach",
		label: "Bãi biển",
		palette: BIOME_BEACH,
		bgm: "bgm-biome2",
		obstacles: {
			low: "models/props/obstacle-low-beach.glb",
			// Pirate Kit không có vật nào đọc ra "thanh chắn trên cao"; dùng lại biển
			// báo của biome ① còn hơn dạy học sinh một tín hiệu mơ hồ ở 15 unit/s.
			high: "models/props/obstacle-high-sign.glb",
			full: "models/props/obstacle-full-beach.glb",
			// Khẩu pháo có bánh xe — vật DUY NHẤT trong Pirate Kit tự di chuyển được.
			moving: "models/props/obstacle-move-beach.glb"
		},
		decor: [
			{ name: "palm-a", url: "models/props/palm-a.glb", capacity: 20 },
			{ name: "palm-b", url: "models/props/palm-b.glb", capacity: 20 },
			{ name: "rocks-sand-a", url: "models/props/rocks-sand-a.glb", capacity: 16 },
			{ name: "rocks-sand-b", url: "models/props/rocks-sand-b.glb", capacity: 16 },
			{ name: "beach-tower", url: "models/props/beach-tower.glb", capacity: 6 },
			{ name: "beach-boat", url: "models/props/beach-boat.glb", capacity: 8 },
			{ name: "beach-flag", url: "models/props/beach-flag.glb", capacity: 10 }
		]
	},
	{
		id: "snow",
		label: "Núi tuyết",
		palette: BIOME_SNOW,
		bgm: "bgm-biome3",
		obstacles: {
			low: "models/props/obstacle-low-snow.glb",
			high: "models/props/obstacle-high-snow.glb",
			full: "models/props/obstacle-full-snow.glb",
			// Xe trượt tuyết lao ngang dốc — chuyển động ngang là bản chất của nó.
			moving: "models/props/obstacle-move-snow.glb"
		},
		decor: [
			{ name: "pine-a", url: "models/props/pine-a.glb", capacity: 20 },
			{ name: "pine-b", url: "models/props/pine-b.glb", capacity: 20 },
			{ name: "pine-c", url: "models/props/pine-c.glb", capacity: 16 },
			{ name: "snowman", url: "models/props/snowman.glb", capacity: 8 },
			{ name: "snow-pile", url: "models/props/snow-pile.glb", capacity: 16 },
			{ name: "snow-rocks", url: "models/props/snow-rocks.glb", capacity: 12 },
			{ name: "snow-lantern", url: "models/props/snow-lantern.glb", capacity: 10 }
		]
	},
	{
		id: "space",
		label: "Không gian",
		palette: BIOME_SPACE,
		bgm: "bgm-biome4",
		obstacles: {
			// Thanh ray dẹt sát đất → nhảy; khung cổng ép mỏng treo cao → trượt;
			// thiên thạch khối vuông → đổi làn. Ba silhouette của plan §4.2 giữ nguyên,
			// chỉ đổi "da" — đúng khuôn P1-2.
			low: "models/props/obstacle-low-space.glb",
			high: "models/props/obstacle-high-space.glb",
			full: "models/props/obstacle-full-space.glb",
			// Tàu bay là hình ảnh duy nhất mà chuyển động ngang trông TỰ NHIÊN — không
			// bánh xe, không ma sát, nên mắt không đòi hỏi lời giải thích nào.
			moving: "models/props/obstacle-move-space.glb"
		},
		decor: [
			{ name: "space-rock-a", url: "models/props/space-rock-a.glb", capacity: 20 },
			{ name: "space-crystal-a", url: "models/props/space-crystal-a.glb", capacity: 18 },
			{ name: "space-crystal-b", url: "models/props/space-crystal-b.glb", capacity: 18 },
			{ name: "space-crater", url: "models/props/space-crater.glb", capacity: 16 },
			{ name: "space-rover", url: "models/props/space-rover.glb", capacity: 10 },
			{ name: "space-dish", url: "models/props/space-dish.glb", capacity: 8 },
			{ name: "space-hangar", url: "models/props/space-hangar.glb", capacity: 6 }
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

/** Mọi GLB một biome cần — dùng để nạp trước lúc cắt cảnh boss (DoD: đổi chặng <100ms). */
export function biomeAssetUrls(index: number): string[] {
	const biome = biomeAt(index);
	return [
		biome.obstacles.low,
		biome.obstacles.high,
		biome.obstacles.full,
		biome.obstacles.moving,
		...biome.decor.map((item) => item.url)
	];
}
