// Scene chạy chính. P0-4 dựng THẾ GIỚI (track + trời + ánh sáng + camera auto-run);
// P0-5 gắn Player, P0-6 gắn Spawn/Score/tim, P0-7 gắn Cổng Toán.
//
// Chế độ `?autorun` chạy không cần người chơi — dùng để đo hiệu năng 2.000m (DoD P0-4).

import { Object3D, Scene } from "three";
import { Track } from "@/systems/Track";
import { Sky, BIOME_CITY_PARK } from "@/fx/Sky";
import { WorldLighting } from "@/fx/WorldLighting";
import { syncCurvedWorldUniforms } from "@/fx/CurvedWorld";
import { AssetManager } from "@/core/AssetManager";
import { tuning } from "@/tuning";
import type { GameScene } from "@/scenes/Scene";
import type { GameContext } from "@/core/GameContext";
import type { Mesh } from "three";

/** Trang trí hai bên đường của biome ① — mỗi mục là 1 InstancedMesh (1 draw call). */
const DECOR_SOURCES = [
	{ name: "tree-a", url: "models/props/tree-a.glb", capacity: 26 },
	{ name: "tree-b", url: "models/props/tree-b.glb", capacity: 26 },
	{ name: "tree-c", url: "models/props/tree-c.glb", capacity: 20 },
	{ name: "building-a", url: "models/props/building-a.glb", capacity: 14 },
	{ name: "building-b", url: "models/props/building-b.glb", capacity: 14 },
	{ name: "building-c", url: "models/props/building-c.glb", capacity: 14 },
	{ name: "fence", url: "models/props/fence.glb", capacity: 22 },
	{ name: "streetlight", url: "models/props/streetlight.glb", capacity: 16 }
];

export class RunScene implements GameScene {
	readonly name = "run";
	readonly scene = new Scene();

	private readonly assets = new AssetManager();
	private readonly sky = new Sky(BIOME_CITY_PARK);
	private readonly track = new Track(BIOME_CITY_PARK);
	private readonly playerAnchor = new Object3D();

	private lighting: WorldLighting | null = null;
	private context: GameContext | null = null;

	/** Hệ số tốc độ nền (P0-6 sẽ nối vào gameSpeed × adaptive). */
	speedFactor = 1;

	private cameraX = 0;
	private previousCameraX = 0;

	async enter(context: GameContext): Promise<void> {
		this.context = context;

		this.sky.attachTo(this.scene, BIOME_CITY_PARK);
		this.track.attachTo(this.scene);

		this.lighting = new WorldLighting(BIOME_CITY_PARK, context.quality.current);
		this.lighting.attachTo(this.scene);

		this.playerAnchor.position.set(0, 0, tuning.world.playerZ);
		this.scene.add(this.playerAnchor);

		context.quality.onChange((settings) => {
			context.renderer.applyQuality(settings);
			this.lighting?.applyQuality(settings);
		});

		await this.loadDecor();
		this.positionCamera(0);
	}

	private async loadDecor(): Promise<void> {
		const loaded = await Promise.all(
			DECOR_SOURCES.map(async (source) => ({
				source,
				model: await this.assets.loadModel(source.url)
			}))
		);

		for (const entry of loaded) {
			// Kenney prop = 1 mesh duy nhất; lấy mesh đầu tiên tìm được làm mẫu instancing.
			let template: Mesh | null = null;

			entry.model.scene.traverse((child) => {
				if (template === null && (child as Mesh).isMesh === true) {
					template = child as Mesh;
				}
			});

			if (template === null) {
				console.warn(`[RunScene] ${entry.source.url} không có mesh nào — bỏ qua lớp trang trí.`);
				continue;
			}

			this.track.addDecorLayer({
				name: entry.source.name,
				template,
				capacity: entry.source.capacity
			});
		}

		this.track.populateInitialDecor();
	}

	/** Tốc độ thế giới hiện tại, theo unit/giây. */
	get speedUnitsPerSec(): number {
		return this.speedFactor * tuning.speed.unitsPerSecondAtOne;
	}

	get distanceM(): number {
		return this.track.distanceM;
	}

	update(deltaSec: number): void {
		this.previousCameraX = this.cameraX;
		this.track.update(deltaSec, this.speedUnitsPerSec);

		// Camera bám ngang theo player nhưng mềm — giữ cảm giác "đu" chứ không dính cứng.
		const targetX = this.playerAnchor.position.x * tuning.world.cameraLaneFollow;
		const smoothing = 1 - Math.exp(-tuning.world.cameraSmoothing * deltaSec);
		this.cameraX += (targetX - this.cameraX) * smoothing;
	}

	render(alpha: number): void {
		syncCurvedWorldUniforms();
		this.sky.syncFog(this.scene);
		this.positionCamera(this.previousCameraX + (this.cameraX - this.previousCameraX) * alpha);
		this.lighting?.follow(this.playerAnchor);
	}

	private positionCamera(cameraX: number): void {
		const camera = this.context?.renderer.camera;

		if (camera === undefined) {
			return;
		}

		camera.fov = tuning.world.cameraFov;
		camera.position.set(cameraX, tuning.world.cameraHeight, tuning.world.playerZ + tuning.world.cameraDistance);
		camera.lookAt(cameraX * 0.6, tuning.world.cameraLookAtHeight, tuning.world.cameraLookAheadZ);
		camera.updateProjectionMatrix();

		this.sky.followCamera(camera.position.z);
		this.track.syncGround(camera.position.z);
	}

	/** Neo để P0-5 gắn model player vào. */
	get anchor(): Object3D {
		return this.playerAnchor;
	}

	poolCounts(): Record<string, number> {
		return this.track.poolCounts();
	}

	exit(): void {
		this.track.dispose();
		this.sky.dispose();
		this.lighting?.dispose();
		this.assets.dispose();
		this.context?.quality.onChange(null);
		this.context = null;
	}
}
