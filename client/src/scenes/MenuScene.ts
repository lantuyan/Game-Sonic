// Nền 3D cho các màn menu: nhân vật đang chọn đứng trên bệ, tự xoay (turntable).
//
// Nhẹ có chủ đích — menu không được ăn pin/GPU như lúc chơi: không track, không
// spawn, không bóng đổ động, chỉ 1 nhân vật + sàn + trời gradient.

import { CircleGeometry, Mesh, MeshStandardMaterial, Object3D, Scene } from "three";
import { Sky } from "@/fx/Sky";
import { BIOME_CITY_PARK } from "@/fx/biomes";
import { WorldLighting } from "@/fx/WorldLighting";
import { AssetManager } from "@/core/AssetManager";
import { CharacterAnimator } from "@/core/CharacterAnimator";
import { loadSelectedCharacterId, getCharacter, CHARACTERS } from "@/data/characters";
import { tuning } from "@/tuning";
import type { GameScene } from "@/scenes/Scene";
import type { GameContext } from "@/core/GameContext";

const TURNTABLE_SPEED = 0.55;

export class MenuScene implements GameScene {
	readonly name = "menu";
	readonly scene = new Scene();

	private readonly assets = new AssetManager();
	private readonly sky = new Sky(BIOME_CITY_PARK);
	private readonly pivot = new Object3D();

	private lighting: WorldLighting | null = null;
	private animator: CharacterAnimator | null = null;
	private context: GameContext | null = null;
	private rotation = 0;
	private previousRotation = 0;
	private currentCharacterId: string | null = null;

	async enter(context: GameContext): Promise<void> {
		this.context = context;

		this.sky.attachTo(this.scene, BIOME_CITY_PARK);
		this.lighting = new WorldLighting(BIOME_CITY_PARK, context.quality.current);
		this.lighting.attachTo(this.scene);

		const platform = new Mesh(
			new CircleGeometry(2.2, 32),
			new MeshStandardMaterial({ color: 0x3d5480, roughness: 0.85 })
		);
		platform.rotation.x = -Math.PI / 2;
		platform.receiveShadow = true;
		this.scene.add(platform, this.pivot);

		this.frameCamera();
		await this.loadCharacter();
	}

	private async loadCharacter(): Promise<void> {
		const characterId = loadSelectedCharacterId();

		if (characterId === this.currentCharacterId) {
			return;
		}

		const character = getCharacter(characterId) ?? CHARACTERS[0];

		if (character === undefined) {
			return;
		}

		const model = await this.assets.loadModel(character.url);
		const instance = model.scene.clone(true);

		this.pivot.clear();
		CharacterAnimator.normalizeHeight(instance);
		instance.rotation.y = Math.PI;
		this.pivot.add(instance);

		this.animator = new CharacterAnimator(instance, model.clips);
		this.animator.play("idle");
		this.currentCharacterId = characterId;
	}

	/** Menu gọi lại khi người chơi đổi nhân vật ở S4. */
	refreshCharacter(): void {
		void this.loadCharacter();
	}

	update(deltaSec: number): void {
		this.previousRotation = this.rotation;
		this.rotation += TURNTABLE_SPEED * deltaSec;
		this.animator?.update(deltaSec);
	}

	render(alpha: number): void {
		this.pivot.rotation.y = this.previousRotation + (this.rotation - this.previousRotation) * alpha;
		this.lighting?.follow(this.pivot);
		this.frameCamera();
	}

	/**
	 * Lùi camera theo tỉ lệ khung hình.
	 *
	 * Camera phối cảnh giữ FOV DỌC cố định, nên ở khung dọc hẹp (360×640) bề ngang
	 * bị cắt và nhân vật "phình" ra chỉ còn thấy cái đầu. Lùi thêm khi aspect < 1
	 * để luôn thấy trọn nhân vật.
	 */
	private frameCamera(): void {
		const camera = this.context?.renderer.camera;

		if (camera === undefined) {
			return;
		}

		const aspect = camera.aspect > 0 ? camera.aspect : 1;
		const portrait = aspect < 1;

		// Khung dọc: bảng nút chiếm ~nửa dưới màn hình, nên vừa lùi camera (FOV dọc
		// cố định làm nhân vật bị cắt ngang) vừa HẠ điểm nhìn xuống — ngắm thấp thì
		// nhân vật hiện lên NỬA TRÊN khung, không bị bảng che.
		const distance = portrait === true ? 4.4 / Math.max(aspect, 0.45) : 4.4;
		const cameraY = portrait === true ? 1.5 : 1.9;
		const lookAtY = portrait === true ? 0.1 : 1;

		camera.position.set(0, cameraY, distance);
		camera.lookAt(0, lookAtY, 0);
		this.sky.followCamera(camera.position.z);
	}

	poolCounts(): Record<string, number> {
		return { targetHeight: tuning.player.targetHeight };
	}

	exit(): void {
		this.animator?.dispose();
		this.animator = null;
		this.sky.dispose();
		this.lighting?.dispose();
		this.assets.dispose();
		this.context = null;
	}
}
