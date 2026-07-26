// Ánh sáng thế giới: 1 HemisphereLight + 1 DirectionalLight đổ bóng BÁM PLAYER
// (plan §6.1). Preset Thấp không dùng shadow map mà dùng blob shadow — vệt tròn mờ
// dưới chân, gần như miễn phí nhưng vẫn "neo" nhân vật xuống mặt đường.
//
// Shadow camera cố ý RẤT HẸP (±7 unit quanh player): shadow map 512–1024px trải
// trên vùng nhỏ mới đủ nét; trải cả track thì bóng vỡ hạt.

import {
	CanvasTexture,
	DirectionalLight,
	HemisphereLight,
	Mesh,
	MeshBasicMaterial,
	PlaneGeometry,
	type Object3D,
	type Scene
} from "three";
import type { QualitySettings } from "@/core/Quality";
import type { BiomePalette } from "@/fx/Sky";

const SHADOW_HALF_EXTENT = 7;

/** Vệt bóng tròn mờ vẽ bằng canvas — không tốn file asset. */
function createBlobTexture(): CanvasTexture {
	const size = 128;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;

	const context = canvas.getContext("2d");

	if (context !== null) {
		const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
		gradient.addColorStop(0, "rgba(0,0,0,0.55)");
		gradient.addColorStop(0.6, "rgba(0,0,0,0.22)");
		gradient.addColorStop(1, "rgba(0,0,0,0)");
		context.fillStyle = gradient;
		context.fillRect(0, 0, size, size);
	}

	return new CanvasTexture(canvas);
}

export class WorldLighting {
	readonly sun: DirectionalLight;
	readonly ambient: HemisphereLight;
	readonly blobShadow: Mesh;

	private blobTexture: CanvasTexture | null = null;

	constructor(palette: BiomePalette, quality: QualitySettings) {
		this.ambient = new HemisphereLight(palette.horizon, palette.ground, 1.15);

		this.sun = new DirectionalLight(0xfff6e0, 1.75);
		this.sun.position.set(6, 12, 6);
		this.sun.target.position.set(0, 0, 0);

		this.blobTexture = createBlobTexture();
		this.blobShadow = new Mesh(
			new PlaneGeometry(1.5, 1.5),
			new MeshBasicMaterial({ map: this.blobTexture, transparent: true, depthWrite: false })
		);
		this.blobShadow.rotation.x = -Math.PI / 2;
		this.blobShadow.position.y = 0.02;
		this.blobShadow.renderOrder = 1;
		this.blobShadow.name = "blob-shadow";

		this.applyQuality(quality);
	}

	applyQuality(quality: QualitySettings): void {
		this.sun.castShadow = quality.shadows;
		this.blobShadow.visible = quality.blobShadow;

		if (quality.shadows === false) {
			return;
		}

		const mapSize = quality.shadowMapSize > 0 ? quality.shadowMapSize : 512;
		this.sun.shadow.mapSize.setScalar(mapSize);
		this.sun.shadow.camera.left = -SHADOW_HALF_EXTENT;
		this.sun.shadow.camera.right = SHADOW_HALF_EXTENT;
		this.sun.shadow.camera.top = SHADOW_HALF_EXTENT;
		this.sun.shadow.camera.bottom = -SHADOW_HALF_EXTENT;
		this.sun.shadow.camera.near = 1;
		this.sun.shadow.camera.far = 40;
		// Bù acne mà không tạo peter-panning thấy rõ ở tỉ lệ nhân vật ~1.75 unit.
		this.sun.shadow.bias = -0.0012;
		this.sun.shadow.normalBias = 0.02;
		this.sun.shadow.camera.updateProjectionMatrix();
	}

	attachTo(scene: Scene): void {
		scene.add(this.ambient, this.sun, this.sun.target, this.blobShadow);
	}

	/** Bám player mỗi frame để vùng bóng nét luôn nằm quanh nhân vật. */
	follow(target: Object3D): void {
		this.sun.position.set(target.position.x + 6, 12, target.position.z + 6);
		this.sun.target.position.copy(target.position);
		this.sun.target.updateMatrixWorld();

		this.blobShadow.position.x = target.position.x;
		this.blobShadow.position.z = target.position.z;
		// Nhảy cao thì bóng nhỏ và mờ đi — tín hiệu độ cao rẻ mà đọc được ngay.
		const height = Math.max(target.position.y, 0);
		const shrink = 1 / (1 + height * 0.55);
		this.blobShadow.scale.setScalar(shrink);
		(this.blobShadow.material as MeshBasicMaterial).opacity = shrink;
	}

	dispose(): void {
		this.blobShadow.geometry.dispose();
		(this.blobShadow.material as MeshBasicMaterial).dispose();
		this.blobTexture?.dispose();
		this.blobTexture = null;
	}
}
