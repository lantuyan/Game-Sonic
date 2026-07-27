// Trùm chặn đường + khiên năng lượng (P1-1).
//
// Model: dùng lại `models/characters/robot.glb` đã có trong ngân sách P0 thay vì tải
// thêm bộ Quaternius. Lý do rất thực tế: robot đã qua pipeline P0-3 (301KB, có clip
// Idle/Death), phóng to 2.4× đọc ra ngay là "kẻ chặn đường", và giữ nguyên ngân sách
// 10MB initial. Khi P1-2 có biome mới, mỗi biome đổi MÀU KHIÊN thay vì đổi model.
//
// Khiên là một quả cầu trong suốt bọc ngoài — vỡ khiên là tín hiệu "đã thắng" rõ
// nhất mà không cần particle system riêng.

import {
	AdditiveBlending,
	AnimationMixer,
	BackSide,
	Color,
	Group,
	Mesh,
	MeshBasicMaterial,
	SphereGeometry,
	type AnimationClip,
	type Object3D
} from "three";
import { tuning } from "@/tuning";

const SHIELD_COLOR_IDLE = 0x38bdf8;
const SHIELD_COLOR_BREAK = 0xfacc15;

export class BossVisual {
	readonly group = new Group();

	private readonly shield: Mesh;
	private readonly shieldMaterial: MeshBasicMaterial;
	private readonly mixer: AnimationMixer | null;

	private active = false;
	private shieldScale = 1;
	private breaking = false;
	private bobPhase = 0;

	constructor(model: Object3D, clips: readonly AnimationClip[] = []) {
		model.scale.setScalar(tuning.boss.scale);
		model.traverse((child) => {
			const mesh = child as Mesh;

			if (mesh.isMesh === true) {
				mesh.castShadow = true;
			}
		});

		this.shieldMaterial = new MeshBasicMaterial({
			color: new Color(SHIELD_COLOR_IDLE),
			transparent: true,
			opacity: 0.28,
			blending: AdditiveBlending,
			depthWrite: false,
			side: BackSide
		});

		this.shield = new Mesh(new SphereGeometry(1, 20, 14), this.shieldMaterial);
		this.shield.scale.setScalar(tuning.player.targetHeight * tuning.boss.scale * 0.78);
		this.shield.position.y = tuning.player.targetHeight * tuning.boss.scale * 0.6;

		this.group.add(model, this.shield);
		this.group.visible = false;
		this.group.name = "boss";

		// Robot.glb có clip Idle; thiếu clip cũng không sao — boss vẫn bập bênh bằng code.
		if (clips.length > 0) {
			this.mixer = new AnimationMixer(model);
			const idle = clips.find((clip) => /idle/i.test(clip.name)) ?? clips[0];

			if (idle !== undefined) {
				this.mixer.clipAction(idle).play();
			}

			return;
		}

		this.mixer = null;
	}

	/** Trùm hiện ra ở xa và trôi về phía player trong lúc cắt cảnh. */
	appear(): void {
		this.active = true;
		this.breaking = false;
		this.shieldScale = 1;
		this.group.visible = true;
		this.group.position.set(0, 0, -tuning.boss.spawnDistance);
		this.group.rotation.y = Math.PI;
		this.shieldMaterial.color.setHex(SHIELD_COLOR_IDLE);
		this.shieldMaterial.opacity = 0.28;
		this.shield.visible = true;
	}

	/** Thắng: khiên phồng lên rồi tan. */
	breakShield(): void {
		this.breaking = true;
		this.shieldMaterial.color.setHex(SHIELD_COLOR_BREAK);
	}

	hide(): void {
		this.active = false;
		this.group.visible = false;
	}

	get isActive(): boolean {
		return this.active;
	}

	get z(): number {
		return this.group.position.z;
	}

	/**
	 * @param approach 0 → đứng ở `spawnDistance`, 1 → đã tới `stopDistance`.
	 * @param fleeing  true → trùm bỏ chạy về phía trước (thua hoặc đã bị phá khiên).
	 */
	update(deltaSec: number, approach: number, fleeing: boolean): void {
		if (this.active === false) {
			return;
		}

		this.mixer?.update(deltaSec);
		this.bobPhase += deltaSec * 2.6;

		const eased = Math.min(Math.max(approach, 0), 1);
		const targetZ = -tuning.boss.spawnDistance + (tuning.boss.spawnDistance - tuning.boss.stopDistance) * eased;
		this.group.position.z = fleeing === true ? this.group.position.z - deltaSec * 46 : targetZ;
		this.group.position.y = Math.sin(this.bobPhase) * 0.12;

		if (this.breaking === false) {
			this.shield.scale.setScalar(
				tuning.player.targetHeight * tuning.boss.scale * (0.78 + Math.sin(this.bobPhase * 1.7) * 0.02)
			);
			return;
		}

		// Khiên vỡ: phồng nhanh + mờ dần rồi tắt hẳn.
		this.shieldScale += deltaSec * 2.6;
		this.shield.scale.setScalar(tuning.player.targetHeight * tuning.boss.scale * 0.78 * this.shieldScale);
		this.shieldMaterial.opacity = Math.max(0.28 - (this.shieldScale - 1) * 0.5, 0);

		if (this.shieldMaterial.opacity <= 0) {
			this.shield.visible = false;
		}
	}

	attachTo(parent: Object3D): void {
		parent.add(this.group);
	}

	dispose(): void {
		this.mixer?.stopAllAction();
		this.shield.geometry.dispose();
		this.shieldMaterial.dispose();
		this.group.clear();
	}
}
