// Player: gắn model + animator vào máy trạng thái chuyển động (PlayerMotion).
//
// Chia việc rõ ràng: PlayerMotion giữ SỐ (làn, độ cao, tư thế), Player giữ HÌNH
// (model, clip, squash-stretch, nhấp nháy bất tử). Nhờ vậy đổi model không đụng
// cảm giác điều khiển, và cảm giác điều khiển test được không cần WebGL.

import { Group, Object3D, type AnimationClip } from "three";
import { CharacterAnimator, type ClipName } from "@/core/CharacterAnimator";
import { PlayerMotion, type MotionCommand } from "@/entities/PlayerMotion";
import { tuning } from "@/tuning";
import type { PlayerPose, PlayerState } from "@/systems/Collision";

export class Player {
	readonly group = new Group();
	readonly motion = new PlayerMotion();

	private readonly animator: CharacterAnimator;
	private readonly model: Object3D;

	private invincibleRemainingSec = 0;
	private blinkPhase = 0;
	private squashRemainingSec = 0;
	private dead = false;

	/** Trạng thái tái sử dụng cho Collision — không cấp phát mỗi frame. */
	private readonly collisionState: PlayerState = {
		lane: 1,
		targetLane: 1,
		pose: "run",
		z: tuning.world.playerZ,
		halfDepth: 0.55
	};

	constructor(model: Object3D, clips: readonly AnimationClip[]) {
		this.model = model;
		CharacterAnimator.normalizeHeight(this.model);

		// Model quay mặt về phía camera (thế giới chạy tới, player nhìn về -z).
		this.model.rotation.y = Math.PI;

		this.model.traverse((child) => {
			child.castShadow = true;
			child.receiveShadow = false;
		});

		this.group.add(this.model);
		this.group.name = "player";

		this.animator = new CharacterAnimator(this.model, clips);
		this.animator.play("run");
	}

	/** Gốc của model — P2-2 nhuộm skin lên đây (`fx/CharacterSkin.ts`). */
	get modelRoot(): Object3D {
		return this.model;
	}

	get pose(): PlayerPose {
		return this.motion.pose;
	}

	get isInvincible(): boolean {
		return this.invincibleRemainingSec > 0;
	}

	get isDead(): boolean {
		return this.dead;
	}

	get missingClips(): readonly ClipName[] {
		return this.animator.missingClips;
	}

	/** Chuyển lệnh xuống máy trạng thái. false = chưa nhận được, giữ trong buffer. */
	command(action: MotionCommand): boolean {
		if (this.dead === true) {
			return true;
		}

		return this.motion.command(action);
	}

	/** Bị va chạm: mất tim → bất tử tạm thời + animation `hit`. */
	takeHit(): void {
		this.invincibleRemainingSec = tuning.player.invincibleSec;
		this.blinkPhase = 0;
		this.animator.play("hit", true);
	}

	/** Trả lời sai: vấp 1s, KHÔNG mất tim (plan §4.4 / Q2). */
	stumble(): void {
		this.motion.stumble();
		this.animator.play("hit", true);
	}

	die(): void {
		this.dead = true;
		this.animator.play("death", true);
	}

	revive(): void {
		this.dead = false;
		this.motion.reset();
		this.invincibleRemainingSec = tuning.player.invincibleSec;
		this.animator.play("run", true);
	}

	update(deltaSec: number, speedFactor: number): void {
		const events = this.motion.update(deltaSec);

		if (this.invincibleRemainingSec > 0) {
			this.invincibleRemainingSec = Math.max(this.invincibleRemainingSec - deltaSec, 0);
			this.blinkPhase += deltaSec * tuning.player.invincibleBlinkHz * Math.PI * 2;
			// Nhấp nháy bằng visible thay vì opacity: không cần material transparent,
			// nên không phá thứ tự vẽ và không tốn thêm draw call.
			this.model.visible = Math.sin(this.blinkPhase) > -0.3;
		} else {
			this.model.visible = true;
		}

		if (events.landed === true) {
			this.squashRemainingSec = tuning.player.landSquashSec;
		}

		this.updateAnimation(speedFactor);
		this.updateSquash(deltaSec);
		this.animator.update(deltaSec);
		this.syncTransform();
	}

	private updateAnimation(speedFactor: number): void {
		this.animator.setRunSpeed(speedFactor);

		if (this.dead === true) {
			return;
		}

		// Hit/stumble được ưu tiên giữ nguyên cho tới khi hết vấp.
		if (this.motion.isStumbling === true) {
			return;
		}

		const pose = this.motion.pose;

		if (pose === "jump") {
			this.animator.play("jump");
			return;
		}

		if (pose === "slide") {
			this.animator.play("slide");
			return;
		}

		this.animator.play("run");
	}

	private updateSquash(deltaSec: number): void {
		if (this.squashRemainingSec <= 0) {
			this.model.scale.y = this.model.scale.x;
			return;
		}

		this.squashRemainingSec = Math.max(this.squashRemainingSec - deltaSec, 0);

		// Bẹp xuống rồi bật lại: nửa đầu nén, nửa sau nhả.
		const progress = 1 - this.squashRemainingSec / tuning.player.landSquashSec;
		const amount = Math.sin(progress * Math.PI);
		const squash = 1 - (1 - tuning.player.landSquashScale) * amount;
		this.model.scale.y = this.model.scale.x * squash;
	}

	private syncTransform(): void {
		this.group.position.x = this.motion.x;
		this.group.position.y = this.motion.y;
		this.group.position.z = tuning.world.playerZ;

		// Nghiêng người nhẹ về hướng đang lướt — juice rẻ mà đọc rõ.
		const laneDelta = this.motion.targetLane - this.motion.lane;
		this.group.rotation.z = -laneDelta * 0.12 * (this.motion.isTweening ? 1 : 0);
	}

	/** Trạng thái cho Collision — cập nhật tại chỗ, không tạo object mới. */
	get collision(): PlayerState {
		this.collisionState.lane = this.motion.lane;
		this.collisionState.targetLane = this.motion.targetLane;
		this.collisionState.pose = this.motion.pose;
		return this.collisionState;
	}

	attachTo(parent: Object3D): void {
		parent.add(this.group);
	}

	dispose(): void {
		this.animator.dispose();
		this.group.clear();
	}
}
