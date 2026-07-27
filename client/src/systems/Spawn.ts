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
import {
	isPatternAllowed,
	OBSTACLE_DEPTH,
	patternLength,
	type Pattern,
	type RunIntensity
} from "@/systems/patternRules";
import { bandBlocksLane, type ObstacleBand, type ObstacleKind } from "@/systems/Collision";
import { laneOffsetAt, type MotionSpec } from "@/systems/movingObstacles";
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
	/** P2-1 — null = đứng yên. Khác null thì `laneOffset` được tính lại mỗi frame. */
	motion: MotionSpec | null;
	laneOffset: number;
	moving: boolean;
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
	/** P2-1 — "da" của chướng ngại di động (xe/tàu/xe trượt tuyết theo biome). */
	moving: Mesh;
	coin: Mesh;
}

/**
 * Hệ số đưa một mẫu GLB về đúng bề rộng/chiều cao chuẩn (P1-2).
 *
 * x và z dùng CÙNG hệ số (giữ tỉ lệ mặt bằng, rào mỏng vẫn mỏng); riêng y ép theo
 * chiều cao mong muốn. Mẫu rỗng/dẹt → trả về scale 1 thay vì chia cho 0.
 */
function normalizeScale(template: Mesh, targetWidth: number, targetHeight: number): Vector3 {
	const geometry = template.geometry;
	geometry.computeBoundingBox();

	const box = geometry.boundingBox;

	if (box === null) {
		return new Vector3(1, 1, 1);
	}

	const width = Math.max(box.max.x - box.min.x, 1e-4);
	const height = Math.max(box.max.y - box.min.y, 1e-4);
	const horizontal = targetWidth / width;

	return new Vector3(horizontal, targetHeight / height, horizontal);
}

/**
 * Chuẩn hoá riêng cho chướng ngại DI ĐỘNG (P2-1) — và xoay nó cho đúng hướng đi.
 *
 * Xe/tàu trong mọi kit đều được dựng "đầu hướng theo trục dài", mà trục dài đó khi
 * thì là x (rào tàu Pirate), khi thì là z (chiếc taxi dài 2.75 theo z, rộng 1.5).
 * Vật này đi NGANG qua đường, nên trục dài phải nằm dọc trục x, nếu không nhìn như
 * chiếc xe đang trôi ngang trong khi mũi vẫn hướng về phía trước.
 *
 * Trả về cả hệ số lẫn góc xoay quanh y (0 hoặc 90°).
 */
function normalizeMovingScale(template: Mesh, targetLength: number, targetHeight: number): {
	scale: Vector3;
	rotationY: number;
} {
	const geometry = template.geometry;
	geometry.computeBoundingBox();

	const box = geometry.boundingBox;

	if (box === null) {
		return { scale: new Vector3(1, 1, 1), rotationY: 0 };
	}

	const sizeX = Math.max(box.max.x - box.min.x, 1e-4);
	const sizeY = Math.max(box.max.y - box.min.y, 1e-4);
	const sizeZ = Math.max(box.max.z - box.min.z, 1e-4);
	// Trục dài nằm ở z → xoay 90° để nó về trục x.
	const longest = Math.max(sizeX, sizeZ);
	const horizontal = targetLength / longest;

	return {
		scale: new Vector3(horizontal, targetHeight / sizeY, horizontal),
		rotationY: sizeZ > sizeX ? Math.PI / 2 : 0
	};
}

export class Spawn {
	readonly group = new Object3D();

	private readonly random: SeededRandom;
	private readonly patterns: Pattern[];
	private readonly obstacles: ObstacleSlot[] = [];
	private readonly coins: CoinSlot[] = [];

	private readonly obstacleMeshes: Record<ObstacleKind, InstancedMesh>;
	/** Hệ số ép mẫu GLB về kích thước chuẩn (xem `tuning.spawn.lowWidth`…). */
	private readonly obstacleScale: Record<ObstacleKind, Vector3>;
	/** P2-1 — lớp vẽ RIÊNG cho chướng ngại di động (+1 draw call, ngân sách 100). */
	private readonly movingMesh: InstancedMesh;
	private readonly movingScale: Vector3;
	private readonly movingRotationY: number;
	private readonly coinMesh: InstancedMesh;

	private readonly scratchMatrix = new Matrix4();
	private readonly scratchPosition = new Vector3();
	private readonly scratchQuaternion = new Quaternion();
	private readonly scratchScale = new Vector3(1, 1, 1);

	/**
	 * Độ khó hiện tại của ván (P2-1) — RunScene ghi vào mỗi frame qua `setIntensity`.
	 * Là object cố định, sửa tại chỗ: cấp phát mỗi frame là vi phạm quy tắc vàng #6.
	 */
	private readonly intensity: RunIntensity = { rampFactor: 1, stageIndex: 0, recovering: false };

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

		this.obstacleScale = {
			low: normalizeScale(templates.low, tuning.spawn.lowWidth, tuning.spawn.lowHeight),
			high: normalizeScale(templates.high, tuning.spawn.highWidth, tuning.spawn.highHeight),
			full: normalizeScale(templates.full, tuning.spawn.fullWidth, tuning.spawn.fullHeight)
		};

		const moving = normalizeMovingScale(templates.moving, tuning.spawn.movingLength, tuning.spawn.movingHeight);
		this.movingMesh = this.createInstanced(templates.moving, "obstacle-moving");
		this.movingScale = moving.scale;
		this.movingRotationY = moving.rotationY;

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
				nearMissAwarded: false,
				motion: null,
				laneOffset: 0,
				moving: false
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

	/**
	 * RunScene bơm "ván đang khó tới đâu" vào đây (P2-1) — sửa TẠI CHỖ, không tạo
	 * object mới, vì hàm này chạy mỗi frame.
	 */
	setIntensity(rampFactor: number, stageIndex: number): void {
		this.intensity.rampFactor = rampFactor;
		this.intensity.stageIndex = stageIndex;
	}

	reset(): void {
		for (const obstacle of this.obstacles) {
			obstacle.active = false;
			obstacle.consumed = false;
			obstacle.motion = null;
			obstacle.laneOffset = 0;
			obstacle.moving = false;
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
		this.intensity.recovering = this.densityPenaltySec > 0;

		const allowed = this.patterns.filter((pattern) => {
			if (pattern.id === this.lastPatternId) {
				return false;
			}

			// Luật khó/dễ (giảm mật độ sau khi mất tim + cửa pattern tổ hợp P2-1)
			// nằm trong patternRules để test được mà không phải dựng cả Spawn.
			return isPatternAllowed(pattern, this.intensity);
		});

		if (allowed.length > 0) {
			return allowed[Math.floor(this.random() * allowed.length)] ?? null;
		}

		// Không còn lựa chọn nào (vd mọi pattern dễ vừa dùng xong): rơi về tập hợp
		// lệ CƠ BẢN chứ không phải toàn bộ bảng — nếu không thì đúng lúc vừa mất tim
		// người chơi lại ăn ngay một pattern tổ hợp.
		const fallback = this.patterns.filter((pattern) => isPatternAllowed(pattern, this.intensity));
		const pool = fallback.length > 0 ? fallback : this.patterns;

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
			slot.motion = event.motion ?? null;
			slot.moving = event.motion !== undefined;
			slot.laneOffset =
				event.motion === undefined ? 0 : laneOffsetAt(event.motion, event.lane, (slot.zStart + slot.zEnd) / 2);
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
				(slot) => slot.active === true && bandBlocksLane(slot, lane) && z <= slot.zEnd && z >= slot.zStart
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

			// P2-1 — vị trí ngang của vật di động là HÀM CỦA z, nên chỉ cần đọc lại
			// sau khi z vừa đổi. Không cấp phát gì, không giữ đồng hồ riêng: tua
			// nhanh/chậm hay dừng thế giới đều tự khớp.
			if (obstacle.motion !== null) {
				obstacle.laneOffset = laneOffsetAt(
					obstacle.motion,
					obstacle.lane,
					(obstacle.zStart + obstacle.zEnd) / 2
				);
			}

			if (obstacle.zStart > tuning.world.recycleZ) {
				obstacle.active = false;
				obstacle.consumed = false;
				obstacle.motion = null;
				obstacle.laneOffset = 0;
				obstacle.moving = false;
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
		let usedMoving = 0;

		for (const obstacle of this.obstacles) {
			if (obstacle.active === false) {
				continue;
			}

			const isMoving = obstacle.moving === true;
			const mesh = isMoving === true ? this.movingMesh : this.obstacleMeshes[obstacle.kind];
			const index = isMoving === true ? usedMoving : usedByKind[obstacle.kind];

			if (isMoving === true) {
				usedMoving += 1;
			} else {
				usedByKind[obstacle.kind] += 1;
			}

			obstacle.instanceIndex = index;

			this.scratchPosition.set(
				// `laneToX` nhận số thực nên vật di động trượt mượt giữa hai làn.
				laneToX(obstacle.lane + obstacle.laneOffset),
				isMoving === true ? tuning.spawn.movingY : OBSTACLE_Y[obstacle.kind],
				(obstacle.zStart + obstacle.zEnd) / 2
			);

			if (isMoving === true) {
				this.scratchQuaternion.setFromAxisAngle(UP, this.movingRotationY);
				this.scratchScale.copy(this.movingScale);
			} else {
				this.scratchQuaternion.identity();
				this.scratchScale.copy(this.obstacleScale[obstacle.kind]);
			}

			this.scratchMatrix.compose(this.scratchPosition, this.scratchQuaternion, this.scratchScale);
			mesh.setMatrixAt(index, this.scratchMatrix);
		}

		for (const kind of ["low", "high", "full"] as const) {
			const mesh = this.obstacleMeshes[kind];
			mesh.count = usedByKind[kind];
			mesh.instanceMatrix.needsUpdate = true;
		}

		this.movingMesh.count = usedMoving;
		this.movingMesh.instanceMatrix.needsUpdate = true;

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
			movingObstacles: this.obstacles.filter((slot) => slot.active === true && slot.moving === true).length,
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

		this.movingMesh.dispose();
		this.coinMesh.dispose();
	}
}
