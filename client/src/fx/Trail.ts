// Vệt chạy phía sau nhân vật (P2-2) — phần HÌNH của `fx/trailPath.ts`.
//
// Một dải ruy-băng phẳng nằm ngang, dựng bằng MỘT BufferGeometry duy nhất được
// cấp phát sẵn trong constructor. Mỗi frame chỉ ghi số vào `Float32Array` đã có
// rồi bật cờ `needsUpdate` — không `new`, không `dispose`, không tạo mảng
// (quy tắc vàng #6). Số tam giác vẽ ra điều khiển bằng `setDrawRange`, nên vệt
// ngắn không tốn gì hơn vệt dài, và 0 điểm thì không vẽ gì cả.
//
// Đúng 1 draw call, và chỉ tồn tại khi người chơi có trang bị trail.

import {
	AdditiveBlending,
	BufferAttribute,
	BufferGeometry,
	Color,
	DoubleSide,
	Mesh,
	MeshBasicMaterial,
	type Object3D
} from "three";
import { TrailPath } from "@/fx/trailPath";
import { tuning } from "@/tuning";
import { getCosmetic } from "@/systems/cosmeticRules";

export class Trail {
	readonly mesh: Mesh;

	private readonly path: TrailPath;
	private readonly positions: Float32Array;
	private readonly colors: Float32Array;
	private readonly geometry: BufferGeometry;
	private readonly material: MeshBasicMaterial;

	/** Màu đầu/đuôi của trail đang trang bị, tách sẵn thành RGB 0–1. */
	private headColor = new Color(0xffffff);
	private tailColor = new Color(0xffffff);
	private enabled = false;

	constructor() {
		const capacity = Math.max(Math.floor(tuning.cosmetic.trailPointCapacity), 2);
		this.path = new TrailPath(capacity);

		// 2 đỉnh mỗi điểm (mép trái + mép phải của dải).
		this.positions = new Float32Array(capacity * 2 * 3);
		this.colors = new Float32Array(capacity * 2 * 3);

		this.geometry = new BufferGeometry();
		this.geometry.setAttribute("position", new BufferAttribute(this.positions, 3));
		this.geometry.setAttribute("color", new BufferAttribute(this.colors, 3));
		this.geometry.setIndex(buildStripIndices(capacity));
		this.geometry.setDrawRange(0, 0);

		this.material = new MeshBasicMaterial({
			vertexColors: true,
			transparent: true,
			opacity: tuning.cosmetic.trailOpacity,
			depthWrite: false,
			// DoubleSide là BẮT BUỘC, không phải cho chắc: dải nằm ngang trong mặt
			// phẳng XZ và thứ tự đỉnh của nó cho pháp tuyến hướng XUỐNG, nên với
			// FrontSide mặc định thì camera (ở trên) chỉ thấy mặt sau và bị cull —
			// vệt biến mất hoàn toàn mà không có một lỗi nào trong console.
			side: DoubleSide,
			// Cộng sáng: vệt là ÁNH SÁNG chứ không phải vật thể, nên nó phải hoà vào
			// nền chứ không được che mất vạch kẻ đường phía dưới.
			blending: AdditiveBlending
		});

		this.mesh = new Mesh(this.geometry, this.material);
		this.mesh.name = "player-trail";
		// Vệt trải dọc cả chục unit phía sau, frustum culling theo bounding sphere
		// tính một lần lúc dựng sẽ cắt nhầm ngay khi người chơi đổi làn.
		this.mesh.frustumCulled = false;
		this.mesh.visible = false;
		this.mesh.renderOrder = 2;
	}

	attachTo(parent: Object3D): void {
		parent.add(this.mesh);
	}

	/** Đổi trail đang trang bị. `trail-none` (hoặc id lạ) → tắt hẳn, không vẽ gì. */
	setCosmetic(cosmeticId: string): void {
		const item = getCosmetic(cosmeticId);
		const active = item !== undefined && item.slot === "trail" && item.price > 0;

		this.enabled = active;
		this.mesh.visible = active;
		this.path.reset();
		this.geometry.setDrawRange(0, 0);

		if (item !== undefined) {
			this.headColor.setHex(item.color);
			this.tailColor.setHex(item.tailColor);
		}
	}

	reset(): void {
		this.path.reset();
		this.geometry.setDrawRange(0, 0);
	}

	/**
	 * @param advanceUnits quãng đường thế giới vừa đi trong frame này;
	 * @param x,y vị trí player (z cố định — thế giới mới là thứ chuyển động).
	 */
	update(advanceUnits: number, x: number, y: number): void {
		if (this.enabled === false) {
			return;
		}

		this.path.update(
			advanceUnits,
			x,
			y,
			tuning.cosmetic.trailSpacingUnits,
			tuning.cosmetic.trailMaxLengthUnits
		);

		const count = this.path.length;

		if (count < 2) {
			this.geometry.setDrawRange(0, 0);
			return;
		}

		const halfWidth = tuning.cosmetic.trailHalfWidth;
		const maxLength = Math.max(tuning.cosmetic.trailMaxLengthUnits, 0.01);

		for (let index = 0; index < count; index += 1) {
			const px = this.path.pointX(index);
			const py = this.path.pointY(index) + tuning.cosmetic.trailHeightOffset;
			const pz = this.path.pointZ(index);

			// Thon dần về đuôi: bề rộng và độ sáng cùng tắt theo một hệ số, nên vệt
			// "tan" chứ không bị cắt cụt ở điểm cuối.
			const fade = Math.max(1 - pz / maxLength, 0);
			const width = halfWidth * fade;
			const base = index * 6;

			this.positions[base] = px - width;
			this.positions[base + 1] = py;
			this.positions[base + 2] = pz;
			this.positions[base + 3] = px + width;
			this.positions[base + 4] = py;
			this.positions[base + 5] = pz;

			const red = this.tailColor.r + (this.headColor.r - this.tailColor.r) * fade;
			const green = this.tailColor.g + (this.headColor.g - this.tailColor.g) * fade;
			const blue = this.tailColor.b + (this.headColor.b - this.tailColor.b) * fade;

			this.colors[base] = red * fade;
			this.colors[base + 1] = green * fade;
			this.colors[base + 2] = blue * fade;
			this.colors[base + 3] = red * fade;
			this.colors[base + 4] = green * fade;
			this.colors[base + 5] = blue * fade;
		}

		this.geometry.attributes.position!.needsUpdate = true;
		this.geometry.attributes.color!.needsUpdate = true;
		// (count − 1) ô, mỗi ô 2 tam giác = 6 chỉ số.
		this.geometry.setDrawRange(0, (count - 1) * 6);
	}

	dispose(): void {
		this.mesh.removeFromParent();
		this.geometry.dispose();
		this.material.dispose();
	}
}

/**
 * Chỉ số của dải tam giác, dựng MỘT LẦN cho sức chứa tối đa.
 * Vệt ngắn hơn thì `setDrawRange` cắt bớt, không phải dựng lại chỉ số.
 */
function buildStripIndices(capacity: number): BufferAttribute {
	const indices = new Uint16Array(Math.max(capacity - 1, 0) * 6);

	for (let cell = 0; cell < capacity - 1; cell += 1) {
		const left = cell * 2;
		const offset = cell * 6;

		indices[offset] = left;
		indices[offset + 1] = left + 1;
		indices[offset + 2] = left + 2;
		indices[offset + 3] = left + 1;
		indices[offset + 4] = left + 3;
		indices[offset + 5] = left + 2;
	}

	return new BufferAttribute(indices, 1);
}
