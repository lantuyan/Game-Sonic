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
import { Player } from "@/entities/Player";
import { Spawn, type ObstacleTemplates } from "@/systems/Spawn";
import { Score } from "@/systems/Score";
import { Lives } from "@/systems/Lives";
import { SpeedController } from "@/systems/Speed";
import { findCollision } from "@/systems/Collision";
import patternData from "@/data/patterns.json";
import type { Pattern } from "@/systems/patternRules";
import { loadSelectedCharacterId, getCharacter, CHARACTERS } from "@/data/characters";
import { tuning } from "@/tuning";
import type { GameScene } from "@/scenes/Scene";
import type { GameContext } from "@/core/GameContext";
import type { Mesh } from "three";

/** Trang trí hai bên đường của biome ① — mỗi mục là 1 InstancedMesh (1 draw call). */
const DECOR_SOURCES = [
	// Capacity = số bản sao TỐI ĐA hiển thị cùng lúc, và cũng là trần tam giác của
	// lớp đó. Nhà Kenney nặng hơn cây nhiều lần nên để capacity thấp hơn hẳn.
	{ name: "tree-a", url: "models/props/tree-a.glb", capacity: 20 },
	{ name: "tree-b", url: "models/props/tree-b.glb", capacity: 20 },
	{ name: "tree-c", url: "models/props/tree-c.glb", capacity: 16 },
	{ name: "building-a", url: "models/props/building-a.glb", capacity: 8 },
	{ name: "building-b", url: "models/props/building-b.glb", capacity: 8 },
	{ name: "building-c", url: "models/props/building-c.glb", capacity: 8 },
	{ name: "fence", url: "models/props/fence.glb", capacity: 18 },
	{ name: "streetlight", url: "models/props/streetlight.glb", capacity: 12 }
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
	private player: Player | null = null;
	private removeActionListener: (() => void) | null = null;

	private spawn: Spawn | null = null;
	private readonly score = new Score();
	private readonly lives = new Lives();
	private readonly speed = new SpeedController();
	private gameOver = false;
	private lastPublishedScore = 0;

	/** Hệ số tốc độ hiện tại — do SpeedController quyết định (plan §4.5). */
	get speedFactor(): number {
		return this.speed.current;
	}

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

		// P0-7 sẽ thay bằng gameSpeed/adaptiveFactor thật lấy qua questionBridge.
		this.speed.start({ gameSpeed: 1, adaptiveFactor: 1 });
		this.score.reset();
		this.lives.reset();
		context.events.emit("lives:changed", { lives: this.lives.current });

		await Promise.all([this.loadDecor(), this.loadPlayer(), this.loadSpawn()]);
		this.bindDevCharacterSwap(context);
		this.positionCamera(0);
	}

	private async loadPlayer(): Promise<void> {
		const characterId = loadSelectedCharacterId();
		const character = getCharacter(characterId) ?? CHARACTERS[0];

		if (character === undefined) {
			throw new Error("Bảng CHARACTERS rỗng — không có nhân vật nào để nạp.");
		}

		const model = await this.assets.loadModel(character.url);
		this.player = new Player(model.scene, model.clips);
		this.player.attachTo(this.playerAnchor);
	}

	private async loadSpawn(): Promise<void> {
		const [low, high, full, coin] = await Promise.all([
			this.assets.loadModel("models/props/obstacle-low-fence.glb"),
			this.assets.loadModel("models/props/obstacle-high-sign.glb"),
			this.assets.loadModel("models/props/obstacle-full-crate.glb"),
			this.assets.loadModel("models/props/coin.glb")
		]);

		const templates: ObstacleTemplates = {
			low: firstMesh(low.scene, "obstacle-low-fence"),
			high: firstMesh(high.scene, "obstacle-high-sign"),
			full: firstMesh(full.scene, "obstacle-full-crate"),
			coin: firstMesh(coin.scene, "coin")
		};

		this.spawn = new Spawn(patternData.patterns as Pattern[], templates);
		this.spawn.attachTo(this.scene);
	}

	/** Dev-only: phím Q/E đổi nhân vật ngay trong ván để soi animation (DoD P0-5). */
	private bindDevCharacterSwap(context: GameContext): void {
		if (context.debug === false) {
			return;
		}

		const handleKey = (event: KeyboardEvent): void => {
			if (event.code !== "KeyQ" && event.code !== "KeyE") {
				return;
			}

			const current = loadSelectedCharacterId();
			const index = CHARACTERS.findIndex((entry) => entry.id === current);
			const step = event.code === "KeyQ" ? -1 : 1;
			const next = CHARACTERS[(index + step + CHARACTERS.length) % CHARACTERS.length];

			if (next === undefined) {
				return;
			}

			void this.swapCharacter(next.id);
		};

		window.addEventListener("keydown", handleKey);
		this.removeActionListener = () => {
			window.removeEventListener("keydown", handleKey);
		};
	}

	private async swapCharacter(characterId: string): Promise<void> {
		const character = getCharacter(characterId);

		if (character === undefined) {
			return;
		}

		const { saveSelectedCharacterId } = await import("@/data/characters");
		saveSelectedCharacterId(character.id);

		const model = await this.assets.loadModel(character.url);
		this.player?.dispose();
		this.playerAnchor.clear();
		// Model trong cache dùng chung, phải clone để 2 lần nạp không giẫm lên nhau.
		this.player = new Player(model.scene.clone(true), model.clips);
		this.player.attachTo(this.playerAnchor);
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

		if (this.gameOver === false) {
			this.speed.update(deltaSec);
			this.lives.update(deltaSec);
		}

		const advance = this.speedUnitsPerSec * deltaSec;
		this.track.update(deltaSec, this.speedUnitsPerSec);
		this.spawn?.update(deltaSec, advance);
		this.consumeInput();
		this.player?.update(deltaSec, this.speedFactor);

		this.score.setDistance(this.track.distanceM);
		this.checkCollisions();
		this.collectCoins();
		this.publishScore();

		// Camera bám ngang theo player nhưng mềm — giữ cảm giác "đu" chứ không dính cứng.
		const targetX = (this.player?.motion.x ?? 0) * tuning.world.cameraLaneFollow;
		const smoothing = 1 - Math.exp(-tuning.world.cameraSmoothing * deltaSec);
		this.cameraX += (targetX - this.cameraX) * smoothing;
	}

	private checkCollisions(): void {
		const player = this.player;
		const spawn = this.spawn;
		const context = this.context;

		if (player === null || spawn === null || context === null || this.gameOver === true) {
			return;
		}

		const active = spawn.activeObstacles.filter((slot) => slot.active === true);
		const hit = findCollision(player.collision, active);

		if (hit === null) {
			return;
		}

		hit.consumed = true;
		const result = this.lives.takeHit();

		if (result === "ignored") {
			return;
		}

		this.speed.onHit();
		spawn.onPlayerHit();

		if (result === "dead") {
			this.gameOver = true;
			player.die();
			context.events.emit("lives:changed", { lives: 0 });
			const snapshot = this.score.snapshot();
			context.events.emit("game:over", { score: snapshot.total, coins: snapshot.coins });
			return;
		}

		player.takeHit();
		context.events.emit("player:hit", { livesLeft: this.lives.current });
		context.events.emit("lives:changed", { lives: this.lives.current });
	}

	private collectCoins(): void {
		const player = this.player;
		const spawn = this.spawn;
		const context = this.context;

		if (player === null || spawn === null || context === null) {
			return;
		}

		const playerX = player.motion.x;
		const playerY = player.motion.y;
		let gained = 0;

		for (const coin of spawn.activeCoins) {
			if (coin.active === false) {
				continue;
			}

			const dz = coin.z - tuning.world.playerZ;

			if (Math.abs(dz) > 1) {
				continue;
			}

			if (Math.abs(coin.x - playerX) > 1 || Math.abs(coin.y - playerY) > 1.3) {
				continue;
			}

			coin.active = false;
			gained += this.score.addCoin(1);
		}

		if (gained > 0) {
			context.events.emit("coins:changed", { coins: this.score.snapshot().coins, delta: gained });
		}
	}

	private publishScore(): void {
		const context = this.context;

		if (context === null) {
			return;
		}

		const total = this.score.total;

		if (total === this.lastPublishedScore) {
			return;
		}

		context.events.emit("score:changed", { score: total, delta: total - this.lastPublishedScore });
		this.lastPublishedScore = total;
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

	/**
	 * Tiêu thụ lệnh từ input buffer. Lệnh bị PlayerMotion từ chối (đang tween/đang
	 * nhảy) được TRẢ LẠI buffer, nên bấm sớm 100ms vẫn ăn — đúng luật 150ms plan §4.1.
	 */
	private consumeInput(): void {
		const context = this.context;
		const player = this.player;

		if (context === null || player === null) {
			return;
		}

		context.input.consumeIf(
			(candidate) =>
				candidate === "laneLeft" || candidate === "laneRight" || candidate === "jump" || candidate === "slide",
			(action) => player.command(action as "laneLeft" | "laneRight" | "jump" | "slide")
		);
	}

	get anchor(): Object3D {
		return this.playerAnchor;
	}

	poolCounts(): Record<string, number> {
		return { ...this.track.poolCounts(), ...(this.spawn?.poolCounts() ?? {}) };
	}

	exit(): void {
		this.removeActionListener?.();
		this.removeActionListener = null;
		this.player?.dispose();
		this.player = null;
		this.spawn?.dispose();
		this.spawn = null;
		this.track.dispose();
		this.sky.dispose();
		this.lighting?.dispose();
		this.assets.dispose();
		this.context?.quality.onChange(null);
		this.context = null;
	}
}

/** Lấy mesh đầu tiên trong một GLB đã nạp để dùng làm mẫu cho InstancedMesh. */
function firstMesh(root: Object3D, label: string): Mesh {
	let found: Mesh | null = null;

	root.traverse((child) => {
		if (found === null && (child as Mesh).isMesh === true) {
			found = child as Mesh;
		}
	});

	if (found === null) {
		throw new Error(`Model "${label}" không có mesh nào để instancing.`);
	}

	return found;
}
