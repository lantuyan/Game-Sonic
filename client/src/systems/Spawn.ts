// Sinh chướng ngại + coin theo pattern (plan §4.2).
//
// Toàn bộ chạy trên POOL cấp phát sẵn: obstacle và coin là InstancedMesh, mỗi
// frame chỉ ghi lại matrix. Không `new`, không `dispose` trong game loop.
//
// Luật chọn pattern:
//   · không lặp pattern 2 lần liền (V1 dùng luật "luôn đổi làn" nên đoán được);
//   · sau cụm khó (difficulty 3) chèn "thung lũng nghỉ" 5–8s;
//   · sau khi mất tim thì giảm mật độ trong vài giây.

import { InstancedMesh, Matrix4, Object3D, Quaternion, Vector3, type Mesh } from "three";
import { tuning } from "@/tuning";
import { applyCurvedWorld } from "@/fx/CurvedWorld";
import { createSeededRandom, randomRange, type SeededRandom } from "@/core/random";
import { OBSTACLE_DEPTH, patternLength, type Pattern } from "@/systems/patternRules";
import type { ObstacleBand, ObstacleKind } from "@/systems/Collision";
import { resetNearMiss, type NearMissBand } from "@/systems/NearMiss";
import { laneToX } from "@/entities/PlayerMotion";

export interface CoinSlot {
	active: boolean;
	lane: number;
	x: number;
	y: number;
	z: number;
	/** Đang bị hút về player (Magnet/Fever — P0-8). */
	attracted: boolean;
}

export interface ObstacleSlot extends ObstacleBand, NearMissBand {
	active: boolean;
	/** Chỉ số InstancedMesh theo loại. */
	instanceIndex: number;
}

const HIDDEN_POSITION = new Vector3(0, -9999, 0);
const UP = new Vector3(0, 1, 0);
const HIDDEN_SCALE = 0.0001;
const OBSTACLE_POOL_SIZE = 48;
const COIN_POOL_SIZE = 160;

/** Chiều cao đặt model theo loại chướng ngại. */
const OBSTACLE_Y: Record<ObstacleKind, number> = {
	low: 0,
	// Rào cao có khe dưới: nâng lên để người trượt chui lọt.
	high: 1.35,
	full: 0
};

export interface ObstacleTemplates {
	low: Mesh;
	high: Mesh;
	full: Mesh;
	coin: Mesh;
}

export class Spawn {
	readonly group = new Object3D();

	private readonly random: SeededRandom;
	private readonly patterns: Pattern[];
	private readonly obstacles: ObstacleSlot[] = [];
	private readonly coins: CoinSlot[] = [];

	private readonly obstacleMeshes: Record<ObstacleKind, InstancedMesh>;
	private readonly coinMesh: InstancedMesh;

	private readonly scratchMatrix = new Matrix4();
	private readonly scratchPosition = new Vector3();
	private readonly scratchQuaternion = new Quaternion();
	private readonly scratchScale = new Vector3(1, 1, 1);

	private lastPatternId: string | null = null;
	/** z của mép xa nhất đã sinh — pattern kế tiếp nối vào sau mốc này. */
	private frontierZ = -80;
	private reliefRemainingSec = 0;
	private densityPenaltySec = 0;
	/** Tắt rơi coin 10s sau khi trả lời sai (plan §4.4). */
	private noCoinRemainingSec = 0;
	private coinSpin = 0;

	constructor(patterns: Pattern[], templates: ObstacleTemplates, seed = 20260727) {
		this.patterns = patterns;
		this.random = createSeededRandom(seed);
		this.group.name = "spawn";

		this.obstacleMeshes = {
			low: this.createInstanced(templates.low, "obstacle-low"),
			high: this.createInstanced(templates.high, "obstacle-high"),
			full: this.createInstanced(templates.full, "obstacle-full")
		};

		this.coinMesh = this.createInstanced(templates.coin, "coin", COIN_POOL_SIZE);

		for (let index = 0; index < OBSTACLE_POOL_SIZE; index += 1) {
			this.obstacles.push({
				active: false,
				instanceIndex: index,
				lane: 1,
				kind: "full",
				zStart: 0,
				zEnd: 0,
				consumed: false,
				nearMissMin: Number.POSITIVE_INFINITY,
				nearMissAwarded: false
			});
		}

		for (let index = 0; index < COIN_POOL_SIZE; index += 1) {
			this.coins.push({ active: false, lane: 1, x: 0, y: 0, z: 0, attracted: false });
		}
	}

	private createInstanced(template: Mesh, name: string, capacity = OBSTACLE_POOL_SIZE): InstancedMesh {
		const materials = Array.isArray(template.material) ? template.material : [template.material];

		for (const material of materials) {
			applyCurvedWorld(material);
		}

		const mesh = new InstancedMesh(template.geometry, template.material, capacity);
		mesh.name = name;
		mesh.castShadow = true;
		mesh.frustumCulled = false;
		// Bắt đầu từ 0; writeMatrices() đặt lại count theo số instance thật mỗi frame.
		mesh.count = 0;

		for (let index = 0; index < capacity; index += 1) {
			this.hide(mesh, index);
		}

		mesh.instanceMatrix.needsUpdate = true;
		this.group.add(mesh);
		return mesh;
	}

	private hide(mesh: InstancedMesh, index: number): void {
		this.scratchPosition.copy(HIDDEN_POSITION);
		this.scratchQuaternion.identity();
		this.scratchScale.setScalar(HIDDEN_SCALE);
		this.scratchMatrix.compose(this.scratchPosition, this.scratchQuaternion, this.scratchScale);
		mesh.setMatrixAt(index, this.scratchMatrix);
	}

	reset(): void {
		for (const obstacle of this.obstacles) {
			obstacle.active = false;
			obstacle.consumed = false;
			resetNearMiss(obstacle);
		}

		for (const coin of this.coins) {
			coin.active = false;
			coin.attracted = false;
		}

		this.lastPatternId = null;
		this.frontierZ = -80;
		this.reliefRemainingSec = 0;
		this.densityPenaltySec = 0;
		this.noCoinRemainingSec = 0;
	}

	/** Sau khi mất tim: giảm mật độ trong vài giây (plan §4.4). */
	onPlayerHit(): void {
		this.densityPenaltySec = tuning.spawn.densityRecoverSec;
	}

	/** Sau khi trả lời sai: 10s không rơi coin (plan §4.4). */
	onWrongAnswer(): void {
		this.noCoinRemainingSec = tuning.scoring.wrongAnswerNoCoinSec;
	}

	/** Dọn sạch chướng ngại trong vùng trạm câu hỏi (telegraph — P0-7). */
	clearRange(zFrom: number, zTo: number): void {
		for (const obstacle of this.obstacles) {
			if (obstacle.active === false) {
				continue;
			}

			if (obstacle.zEnd >= zFrom && obstacle.zStart <= zTo) {
				// Chỉ cần tắt cờ: writeMatrices() nén lại chỉ số mỗi frame nên slot
				// vừa tắt tự biến mất khỏi dải instance đang vẽ.
				obstacle.active = false;
			}
		}
	}

	/**
	 * Mưa coin thưởng khi hạ được trùm (P1-1).
	 *
	 * Rải trên CẢ 3 LÀN ngay trước mặt để người chơi nhặt được kha khá mà không phải
	 * lạng lách — đây là lúc ăn mừng, không phải lúc thử phản xạ. Dùng đúng pool coin
	 * sẵn có nên không thêm draw call nào.
	 */
	coinRain(count: number): void {
		const startZ = -18;
		let placed = 0;

		for (let step = 0; placed < count && step < count; step += 1) {
			for (let lane = 0; lane < 3 && placed < count; lane += 1) {
				const slot = this.takeCoin();

				if (slot === null) {
					return;
				}

				slot.active = true;
				slot.attracted = false;
				slot.lane = lane;
				slot.x = laneToX(lane);
				slot.y = 0.7 + Math.sin(step * 0.8) * 0.35;
				slot.z = startZ - step * tuning.spawn.coinSpacing;
				placed += 1;
			}
		}
	}

	private pickPattern(): Pattern | null {
		const allowed = this.patterns.filter((pattern) => {
			if (pattern.id === this.lastPatternId) {
				return false;
			}

			// Sau khi mất tim chỉ cho pattern dễ.
			if (this.densityPenaltySec > 0 && pattern.difficulty > 1) {
				return false;
			}

			return true;
		});

		const pool = allowed.length > 0 ? allowed : this.patterns;
		return pool[Math.floor(this.random() * pool.length)] ?? null;
	}

	private takeObstacle(): ObstacleSlot | null {
		return this.obstacles.find((slot) => slot.active === false) ?? null;
	}

	private takeCoin(): CoinSlot | null {
		return this.coins.find((slot) => slot.active === false) ?? null;
	}

	private emitPattern(pattern: Pattern, baseZ: number): void {
		for (const event of pattern.events) {
			const slot = this.takeObstacle();

			if (slot === null) {
				return;
			}

			slot.active = true;
			slot.consumed = false;
			resetNearMiss(slot);
			slot.lane = event.lane;
			slot.kind = event.type;
			slot.zStart = baseZ - event.offset - OBSTACLE_DEPTH;
			slot.zEnd = baseZ - event.offset;
		}
	}

	/**
	 * Rải coin. Làn an toàn = làn không có chướng ngại trong đoạn này.
	 * Trên đoạn có rào thấp thì vẽ CUNG theo quỹ đạo nhảy để thưởng người dám nhảy.
	 */
	private emitCoins(fromZ: number, toZ: number): void {
		if (this.noCoinRemainingSec > 0) {
			return;
		}

		const lane = Math.floor(this.random() * 3);
		const arc = this.random() < 0.35;

		for (let z = fromZ; z > toZ; z -= tuning.spawn.coinSpacing) {
			const blocked = this.obstacles.some(
				(slot) => slot.active === true && slot.lane === lane && z <= slot.zEnd && z >= slot.zStart
			);

			if (blocked === true) {
				continue;
			}

			const slot = this.takeCoin();

			if (slot === null) {
				return;
			}

			const progress = (fromZ - z) / Math.max(fromZ - toZ, 1);
			slot.active = true;
			slot.attracted = false;
			slot.lane = lane;
			slot.x = laneToX(lane);
			slot.y = arc === true ? 0.7 + Math.sin(progress * Math.PI) * tuning.spawn.coinArcHeight : 0.7;
			slot.z = z;
		}
	}

	/** Đẩy thế giới + sinh thêm pattern khi cần. */
	update(deltaSec: number, advanceUnits: number): void {
		if (this.reliefRemainingSec > 0) {
			this.reliefRemainingSec = Math.max(this.reliefRemainingSec - deltaSec, 0);
		}

		if (this.densityPenaltySec > 0) {
			this.densityPenaltySec = Math.max(this.densityPenaltySec - deltaSec, 0);
		}

		if (this.noCoinRemainingSec > 0) {
			this.noCoinRemainingSec = Math.max(this.noCoinRemainingSec - deltaSec, 0);
		}

		this.coinSpin += deltaSec * 2.4;
		this.frontierZ += advanceUnits;

		for (const obstacle of this.obstacles) {
			if (obstacle.active === false) {
				continue;
			}

			obstacle.zStart += advanceUnits;
			obstacle.zEnd += advanceUnits;

			if (obstacle.zStart > tuning.world.recycleZ) {
				obstacle.active = false;
				obstacle.consumed = false;
				resetNearMiss(obstacle);
			}
		}

		for (const coin of this.coins) {
			if (coin.active === false) {
				continue;
			}

			coin.z += advanceUnits;

			if (coin.z > tuning.world.recycleZ) {
				coin.active = false;
				coin.attracted = false;
			}
		}

		this.fillAhead();
		this.writeMatrices();
	}

	private fillAhead(): void {
		// Giữ đường luôn có sẵn chướng ngại tới ~2 lần tầm nhìn fog.
		const targetZ = -tuning.world.fogFar * 1.4;

		while (this.frontierZ > targetZ) {
			if (this.reliefRemainingSec > 0) {
				// Thung lũng nghỉ: chỉ rải coin, không sinh chướng ngại.
				const gap = randomRange(this.random, tuning.spawn.patternGapMin, tuning.spawn.patternGapMax);
				this.emitCoins(this.frontierZ, this.frontierZ - gap);
				this.frontierZ -= gap;
				continue;
			}

			const pattern = this.pickPattern();

			if (pattern === null) {
				return;
			}

			this.emitPattern(pattern, this.frontierZ);
			this.lastPatternId = pattern.id;

			const length = patternLength(pattern);
			const gap = randomRange(this.random, tuning.spawn.patternGapMin, tuning.spawn.patternGapMax);
			this.emitCoins(this.frontierZ - length, this.frontierZ - length - gap);
			this.frontierZ -= length + gap;

			// Sau cụm khó thì nghỉ 5–8s (quy đổi ra giây theo tốc độ chuẩn).
			if (pattern.difficulty >= 3) {
				this.reliefRemainingSec = randomRange(
					this.random,
					tuning.spawn.reliefValleyMinSec,
					tuning.spawn.reliefValleyMaxSec
				);
			}
		}
	}

	private writeMatrices(): void {
		// Nén chỉ số theo từng loại rồi đặt `count` đúng số đang hiển thị: InstancedMesh
		// vẫn chạy vertex shader cho MỌI instance trong `count`, kể cả slot ẩn — để
		// count = capacity là trả tiền tam giác cho chướng ngại không tồn tại.
		const usedByKind: Record<ObstacleKind, number> = { low: 0, high: 0, full: 0 };

		for (const obstacle of this.obstacles) {
			if (obstacle.active === false) {
				continue;
			}

			const mesh = this.obstacleMeshes[obstacle.kind];
			const index = usedByKind[obstacle.kind];
			usedByKind[obstacle.kind] += 1;
			obstacle.instanceIndex = index;

			this.scratchPosition.set(
				laneToX(obstacle.lane),
				OBSTACLE_Y[obstacle.kind],
				(obstacle.zStart + obstacle.zEnd) / 2
			);
			this.scratchQuaternion.identity();
			this.scratchScale.setScalar(1);
			this.scratchMatrix.compose(this.scratchPosition, this.scratchQuaternion, this.scratchScale);
			mesh.setMatrixAt(index, this.scratchMatrix);
		}

		for (const kind of ["low", "high", "full"] as const) {
			const mesh = this.obstacleMeshes[kind];
			mesh.count = usedByKind[kind];
			mesh.instanceMatrix.needsUpdate = true;
		}

		let coinIndex = 0;

		for (const coin of this.coins) {
			if (coin.active === false) {
				continue;
			}

			this.scratchPosition.set(coin.x, coin.y, coin.z);
			this.scratchQuaternion.setFromAxisAngle(UP, this.coinSpin);
			this.scratchScale.setScalar(1);
			this.scratchMatrix.compose(this.scratchPosition, this.scratchQuaternion, this.scratchScale);
			this.coinMesh.setMatrixAt(coinIndex, this.scratchMatrix);
			coinIndex += 1;
		}

		this.coinMesh.count = coinIndex;
		this.coinMesh.instanceMatrix.needsUpdate = true;
	}

	get activeObstacles(): readonly ObstacleSlot[] {
		return this.obstacles;
	}

	get activeCoins(): CoinSlot[] {
		return this.coins;
	}

	poolCounts(): Record<string, number> {
		return {
			obstacles: this.obstacles.filter((slot) => slot.active === true).length,
			coins: this.coins.filter((slot) => slot.active === true).length
		};
	}

	attachTo(parent: Object3D): void {
		parent.add(this.group);
	}

	dispose(): void {
		for (const mesh of Object.values(this.obstacleMeshes)) {
			mesh.dispose();
		}

		this.coinMesh.dispose();
	}
}
