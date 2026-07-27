// Skin nhân vật (P2-2): đổi MÀU/VẬT LIỆU, không đổi model.
//
// Vì sao không tải model mới cho mỗi skin: xem phần đầu `systems/cosmeticRules.ts`
// — ngân sách. Ở đây chỉ có một cạm bẫy kỹ thuật và nó nghiêm trọng:
//
//   `Object3D.clone()` của three KHÔNG nhân bản material. Hai lần nạp cùng một
//   GLB (AssetManager có cache) dùng CHUNG một đối tượng material, nên nhuộm
//   thẳng lên nó là nhuộm luôn bản gốc trong cache: đổi nhân vật một lần rồi
//   quay lại sẽ thấy màu skin cũ dính vĩnh viễn, kể cả sau khi gỡ skin.
//
// Vì vậy mỗi mesh được cấp một material RIÊNG (clone đúng một lần, đánh dấu bằng
// `userData`) và màu gốc được nhớ lại để lần nhuộm sau nhân từ nguyên bản chứ
// không nhân chồng lên lần trước.

import { Color, Mesh, MeshStandardMaterial, type Material, type Object3D } from "three";
import { DEFAULT_SKIN_ID, getCosmetic } from "@/systems/cosmeticRules";

/** Ai đang sở hữu bản material này ("player"…). Khác chủ → phải tách bản mới. */
const OWNER_KEY = "toanRunnerSkinOwner";
/** Màu gốc của material, nhớ lại để nhuộm luôn tính từ nguyên bản. */
const BASE_COLOR_KEY = "toanRunnerBaseColor";
const BASE_EMISSIVE_KEY = "toanRunnerBaseEmissive";

const scratchColor = new Color();

/**
 * Nhuộm model theo skin. `skinId` không hợp lệ hoặc là "Nguyên bản" thì trả model
 * về đúng màu gốc — nên hàm này vừa là "mặc vào" vừa là "cởi ra".
 *
 * `ownerId` phân định ai sở hữu bản material đã tách: nhân vật người chơi và con
 * trùm có thể là CÙNG một GLB (`robot.glb`), và nếu dùng chung material thì nhuộm
 * người chơi sẽ nhuộm luôn con trùm.
 *
 * Gọi lúc nạp nhân vật, KHÔNG gọi trong game loop.
 */
export function applySkin(root: Object3D, skinId: string, ownerId = "player"): void {
	const skin = getCosmetic(skinId);
	const effective = skin !== undefined && skin.slot === "skin" ? skin : getCosmetic(DEFAULT_SKIN_ID);

	if (effective === undefined) {
		return;
	}

	root.traverse((child) => {
		const mesh = child as Mesh;

		if (mesh.isMesh !== true) {
			return;
		}

		if (Array.isArray(mesh.material) === true) {
			mesh.material = (mesh.material as Material[]).map((entry) =>
				tintOne(entry, effective.color, effective.emissive, effective.emissiveIntensity, ownerId)
			);
			return;
		}

		mesh.material = tintOne(
			mesh.material as Material,
			effective.color,
			effective.emissive,
			effective.emissiveIntensity,
			ownerId
		);
	});
}

function tintOne(
	material: Material,
	color: number,
	emissive: number,
	emissiveIntensity: number,
	ownerId: string
): Material {
	const owned = material.userData[OWNER_KEY] === ownerId ? material : cloneOnce(material, ownerId);
	const standard = owned as MeshStandardMaterial;

	if (standard.color === undefined) {
		// Material không có màu (vd ShaderMaterial của trời) — bỏ qua, không ném.
		return owned;
	}

	const base = owned.userData[BASE_COLOR_KEY] as number | undefined;
	scratchColor.setHex(base ?? 0xffffff);
	// NHÂN với màu gốc thay vì thay hẳn: giữ được sự tương phản giữa các phần của
	// model (áo giáp sáng, dây lưng tối) thay vì bôi nhân vật thành một khối màu.
	standard.color.setHex(color).multiply(scratchColor);

	if (standard.emissive !== undefined) {
		const baseEmissive = owned.userData[BASE_EMISSIVE_KEY] as number | undefined;
		standard.emissive.setHex(emissive === 0 ? (baseEmissive ?? 0x000000) : emissive);
		standard.emissiveIntensity = emissive === 0 ? 1 : Math.max(emissiveIntensity, 0);
	}

	return owned;
}

/** Tách material riêng cho chủ này và nhớ lại màu nguyên bản. */
function cloneOnce(material: Material, ownerId: string): Material {
	const copy = material.clone();
	const source = material as MeshStandardMaterial;

	copy.userData = { ...copy.userData, [OWNER_KEY]: ownerId };
	// Màu gốc phải lấy từ NGUYÊN BẢN chưa nhuộm: nếu bản đang cầm đã bị nhuộm bởi
	// một chủ khác thì `BASE_COLOR_KEY` của nó mới là nguyên bản, không phải `color`.
	const inheritedBase = material.userData[BASE_COLOR_KEY] as number | undefined;
	const inheritedEmissive = material.userData[BASE_EMISSIVE_KEY] as number | undefined;

	if (inheritedBase !== undefined) {
		copy.userData[BASE_COLOR_KEY] = inheritedBase;
	}

	if (inheritedEmissive !== undefined) {
		copy.userData[BASE_EMISSIVE_KEY] = inheritedEmissive;
	}

	if (source.color !== undefined && copy.userData[BASE_COLOR_KEY] === undefined) {
		copy.userData[BASE_COLOR_KEY] = source.color.getHex();
	}

	if (source.emissive !== undefined && copy.userData[BASE_EMISSIVE_KEY] === undefined) {
		copy.userData[BASE_EMISSIVE_KEY] = source.emissive.getHex();
	}

	return copy;
}
