// Quản lý AnimationMixer + crossfade giữa 6 clip chuẩn.
//
// Hai điều học từ V1 (docs/v2/A1 §3.2) được giữ lại:
//   1. Tốc độ clip `run` scale theo tốc độ game — nhân vật "guồng chân" nhanh hơn
//      khi chạy nhanh, thiếu cái này là cảm giác trượt băng.
//   2. Chuẩn hóa chiều cao bằng Box3 đo ĐÚNG MỘT LẦN lúc nạp, không phải mỗi frame.
//
// Clip thiếu (fox/parrot không có jump/slide) tự rơi về `run` — pipeline P0-3 đã
// ghi rõ danh sách fallback vào assets.json.

import { AnimationMixer, Box3, LoopOnce, LoopRepeat, Vector3, type AnimationAction, type AnimationClip, type Object3D } from "three";
import { tuning } from "@/tuning";

export type ClipName = "idle" | "run" | "jump" | "slide" | "death" | "hit";

/** Clip chạy một lần rồi giữ khung cuối, thay vì lặp vô hạn. */
const ONE_SHOT_CLIPS: ReadonlySet<ClipName> = new Set<ClipName>(["jump", "hit", "death"]);

export class CharacterAnimator {
	private readonly mixer: AnimationMixer;
	private readonly actionsByName = new Map<ClipName, AnimationAction>();
	private readonly fallbacks: ClipName[] = [];

	private currentName: ClipName | null = null;
	private currentAction: AnimationAction | null = null;

	constructor(root: Object3D, clips: readonly AnimationClip[]) {
		this.mixer = new AnimationMixer(root);

		for (const clip of clips) {
			const name = clip.name as ClipName;
			const action = this.mixer.clipAction(clip);

			if (ONE_SHOT_CLIPS.has(name) === true) {
				action.setLoop(LoopOnce, 1);
				action.clampWhenFinished = true;
			} else {
				action.setLoop(LoopRepeat, Number.POSITIVE_INFINITY);
			}

			this.actionsByName.set(name, action);
		}
	}

	/**
	 * Chuẩn hóa chiều cao model về `tuning.player.targetHeight`.
	 * Đo Box3 MỘT LẦN — port cách làm của V1 (A1 §3.2), tránh đo mỗi frame.
	 * Trả về hệ số scale đã áp.
	 */
	static normalizeHeight(root: Object3D): number {
		const box = new Box3().setFromObject(root);
		const size = new Vector3();
		box.getSize(size);

		if (size.y <= 0) {
			return 1;
		}

		const scale = tuning.player.targetHeight / size.y;
		root.scale.setScalar(scale);
		// Đặt chân sát mặt đất y=0 sau khi scale.
		root.position.y = -box.min.y * scale;
		return scale;
	}

	has(name: ClipName): boolean {
		return this.actionsByName.has(name);
	}

	/** Clip thiếu thì dùng `run`; ghi lại để `?debug` hiển thị. */
	private resolve(name: ClipName): { action: AnimationAction | null; resolvedName: ClipName } {
		const direct = this.actionsByName.get(name);

		if (direct !== undefined) {
			return { action: direct, resolvedName: name };
		}

		if (this.fallbacks.includes(name) === false) {
			this.fallbacks.push(name);
		}

		return { action: this.actionsByName.get("run") ?? null, resolvedName: "run" };
	}

	/**
	 * Chuyển sang clip khác với crossfade.
	 * `force` để phát lại clip one-shot đang chạy (vd trúng đòn 2 lần liên tiếp).
	 */
	play(name: ClipName, force = false): void {
		const { action, resolvedName } = this.resolve(name);

		if (action === null) {
			return;
		}

		if (this.currentName === resolvedName && force === false) {
			return;
		}

		const fadeSec = tuning.player.animCrossFadeSec;

		action.reset();
		action.enabled = true;
		action.setEffectiveWeight(1);
		action.play();

		if (this.currentAction !== null && this.currentAction !== action) {
			this.currentAction.crossFadeTo(action, fadeSec, false);
		} else if (this.currentAction === action) {
			action.fadeIn(fadeSec);
		}

		this.currentAction = action;
		this.currentName = resolvedName;
	}

	/**
	 * Nhịp guồng chân theo tốc độ game (giữ hiệu ứng tốt của V1).
	 * `speedFactor` = hệ số tốc độ nền hiện tại (1.0 = tốc độ chuẩn).
	 */
	setRunSpeed(speedFactor: number): void {
		const runAction = this.actionsByName.get("run");

		if (runAction === undefined) {
			return;
		}

		runAction.timeScale = Math.min(
			Math.max(speedFactor, tuning.player.runClipSpeedMin),
			tuning.player.runClipSpeedMax
		);
	}

	update(deltaSec: number): void {
		this.mixer.update(deltaSec);
	}

	get current(): ClipName | null {
		return this.currentName;
	}

	/** Danh sách clip đã phải fallback — `?debug` hiển thị để không "thiếu âm thầm". */
	get missingClips(): readonly ClipName[] {
		return this.fallbacks;
	}

	dispose(): void {
		this.mixer.stopAllAction();
		this.actionsByName.clear();
	}
}
