// Scene nghiệm thu P0-2: sàn + cube quay, đủ để chứng minh fixed timestep, input
// và auto-quality chạy đúng. P0-4/P0-6 sẽ thay bằng RunScene thật.
//
// Cube CHỈ quay trong `update(dt)` với dt cố định → throttle CPU 4× không đổi
// tốc độ vật lý, chỉ giảm số frame hình.

import {
	BoxGeometry,
	Color,
	DirectionalLight,
	Fog,
	HemisphereLight,
	Mesh,
	MeshStandardMaterial,
	PlaneGeometry,
	Scene
} from "three";
import { tuning } from "@/tuning";
import type { GameScene } from "@/scenes/Scene";
import type { GameContext } from "@/core/GameContext";

const SKY_COLOR = 0x1b2a4a;
const CUBE_SPIN_PER_SEC = 1.1;

export class DemoScene implements GameScene {
	readonly name = "demo";
	readonly scene = new Scene();

	private readonly cube: Mesh;
	private readonly sun: DirectionalLight;
	private context: GameContext | null = null;

	/** Trạng thái vật lý: giữ giá trị trước + sau để `render(alpha)` nội suy. */
	private previousRotation = 0;
	private currentRotation = 0;
	private laneIndex = 1;
	private previousX = 0;
	private currentX = 0;
	private laneTweenSec = 0;
	private tweenFromX = 0;
	private tweenToX = 0;

	private removeActionListener: (() => void) | null = null;

	constructor() {
		this.scene.background = new Color(SKY_COLOR);
		this.scene.fog = new Fog(SKY_COLOR, tuning.world.fogNear, tuning.world.fogFar);

		this.scene.add(new HemisphereLight(0xffffff, 0x22345a, 1.15));

		this.sun = new DirectionalLight(0xffffff, 1.5);
		this.sun.position.set(6, 12, 6);
		this.sun.castShadow = true;
		this.scene.add(this.sun);

		const ground = new Mesh(
			new PlaneGeometry(tuning.world.roadWidth, 400),
			new MeshStandardMaterial({ color: 0x2f3f63, roughness: 0.95 })
		);
		ground.rotation.x = -Math.PI / 2;
		ground.position.z = -160;
		ground.receiveShadow = true;
		this.scene.add(ground);

		this.cube = new Mesh(
			new BoxGeometry(1.2, 1.2, 1.2),
			new MeshStandardMaterial({ color: 0xffc93c, roughness: 0.35, metalness: 0.1 })
		);
		this.cube.position.y = 0.9;
		this.cube.castShadow = true;
		this.scene.add(this.cube);
	}

	enter(context: GameContext): void {
		this.context = context;
		context.quality.reset();
		this.positionCamera();

		// Buffer được tiêu thụ trong update(); listener này chỉ để pause.
		this.removeActionListener = context.input.on((action) => {
			if (action === "pause") {
				if (context.engine.isPaused === true) {
					context.engine.resume();
					return;
				}

				context.engine.pause();
			}
		});
	}

	update(deltaSec: number): void {
		this.previousRotation = this.currentRotation;
		this.currentRotation += CUBE_SPIN_PER_SEC * deltaSec;

		this.consumeLaneInput();
		this.advanceLaneTween(deltaSec);
	}

	private consumeLaneInput(): void {
		const context = this.context;

		if (context === null) {
			return;
		}

		// Chỉ nhận lệnh đổi làn khi tween đã xong — lệnh đến sớm nằm lại trong buffer
		// 150ms và được tiêu thụ ở bước sau (không bị nuốt).
		if (this.laneTweenSec > 0) {
			return;
		}

		const action = context.input.consume(
			(candidate) => candidate === "laneLeft" || candidate === "laneRight"
		);

		if (action === null) {
			return;
		}

		const nextLane = Math.min(Math.max(this.laneIndex + (action === "laneLeft" ? -1 : 1), 0), 2);

		if (nextLane === this.laneIndex) {
			return;
		}

		this.laneIndex = nextLane;
		this.tweenFromX = this.currentX;
		this.tweenToX = (nextLane - 1) * tuning.world.laneOffsetX;
		this.laneTweenSec = tuning.player.laneTweenSec;
	}

	private advanceLaneTween(deltaSec: number): void {
		this.previousX = this.currentX;

		if (this.laneTweenSec <= 0) {
			return;
		}

		this.laneTweenSec = Math.max(this.laneTweenSec - deltaSec, 0);

		const progress = 1 - this.laneTweenSec / tuning.player.laneTweenSec;
		const eased = 1 - (1 - progress) ** 3;
		this.currentX = this.tweenFromX + (this.tweenToX - this.tweenFromX) * eased;
	}

	render(alpha: number): void {
		const rotation = this.previousRotation + (this.currentRotation - this.previousRotation) * alpha;
		this.cube.rotation.x = rotation * 0.7;
		this.cube.rotation.y = rotation;
		this.cube.position.x = this.previousX + (this.currentX - this.previousX) * alpha;
		this.sun.position.x = this.cube.position.x + 6;
	}

	private positionCamera(): void {
		const camera = this.context?.renderer.camera;

		if (camera === undefined) {
			return;
		}

		camera.position.set(0, tuning.world.cameraHeight, tuning.world.cameraDistance);
		camera.lookAt(0, tuning.world.cameraLookAtHeight, tuning.world.cameraLookAheadZ);
	}

	resize(): void {
		this.positionCamera();
	}

	poolCounts(): Record<string, number> {
		return { meshes: this.scene.children.length };
	}

	exit(): void {
		this.removeActionListener?.();
		this.removeActionListener = null;
		this.context = null;
	}
}
