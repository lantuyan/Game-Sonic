// Đường chạy: pool 6–8 chunk tái chế vòng tròn (plan §4.2).
//
// Nguyên tắc sống còn (quy tắc vàng #6): TOÀN BỘ hình học được cấp phát MỘT LẦN
// lúc dựng. Trong game loop chỉ có: cộng z, ghi matrix vào InstancedMesh, và
// `setMatrixAt`. Không `new`, không `dispose`, không tạo mảng mới mỗi frame.
//
// Mặt đường dựng bằng code (không dùng tile Kenney): tile đường của Kenney chia ô
// vuông theo lưới thành phố, ghép lại thành 3 làn chạy dài sẽ hở mạch và tốn draw
// call. Một InstancedMesh phẳng + vạch kẻ cho hình ảnh sạch hơn và rẻ hơn nhiều.

import {
	BoxGeometry,
	Color,
	InstancedMesh,
	Matrix4,
	Mesh,
	MeshStandardMaterial,
	Object3D,
	PlaneGeometry,
	Quaternion,
	Vector3,
	type Group,
	type Scene
} from "three";
import { tuning } from "@/tuning";
import { applyCurvedWorld } from "@/fx/CurvedWorld";
import { BIOME_CITY_PARK, type BiomePalette } from "@/fx/Sky";
import type { ObstacleBand } from "@/systems/Collision";
import { createSeededRandom, type SeededRandom } from "@/core/random";

/** Mỗi loại trang trí là 1 InstancedMesh → 1 draw call cho cả trăm bản sao. */
interface DecorLayer {
	mesh: InstancedMesh;
	/** Slot đang dùng; slot chưa dùng bị đẩy ra ngoài tầm nhìn. */
	used: number;
	capacity: number;
}

export interface TrackDecorSource {
	/** Tên nhóm (để debug) */
	name: string;
	/** Mesh mẫu lấy từ GLB đã nạp. */
	template: Mesh;
	capacity: number;
}

const HIDDEN_SCALE = 0.0001;
const HIDDEN_POSITION = new Vector3(0, -9999, 0);
// Trục quay dùng lại — `new Vector3()` trong vòng lặp là cấp phát trong đường nóng.
const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);
/** Vạch kẻ đứt: 8 vạch/chunk cho nhịp lướt rõ mà không tốn thêm draw call. */
const DASHES_PER_CHUNK = 8;
const DASH_LENGTH = 2.4;

export class Track {
	readonly group: Object3D;

	private readonly roadMesh: InstancedMesh;
	private readonly laneLineMesh: InstancedMesh;
	private readonly groundMesh: Mesh;
	private readonly decorLayers: DecorLayer[] = [];
	private readonly palette: BiomePalette;
	private readonly random: SeededRandom;

	// Bộ đệm dùng lại — tránh cấp phát trong vòng lặp.
	private readonly scratchMatrix = new Matrix4();
	private readonly scratchPosition = new Vector3();
	private readonly scratchQuaternion = new Quaternion();
	private readonly scratchScale = new Vector3(1, 1, 1);

	private readonly chunkCount: number;
	private readonly chunkLength: number;
	/** z của mép GẦN nhất của từng chunk. Chunk chạy về phía +z. */
	private readonly chunkZ: number[] = [];

	/** Tổng quãng đường đã chạy (mét) — Score và Spawn dùng chung. */
	distanceM = 0;

	constructor(palette: BiomePalette = BIOME_CITY_PARK, seed = 1337) {
		this.palette = palette;
		this.random = createSeededRandom(seed);
		this.group = new Object3D();
		this.group.name = "track";

		this.chunkCount = Math.max(Math.round(tuning.world.chunkPoolSize), 4);
		this.chunkLength = tuning.world.chunkLengthM;

		const roadMaterial = new MeshStandardMaterial({
			color: new Color(palette.road),
			roughness: 0.92,
			metalness: 0
		});
		applyCurvedWorld(roadMaterial);

		// 1 instance / chunk: mặt đường phẳng nằm ngang.
		this.roadMesh = new InstancedMesh(
			new PlaneGeometry(tuning.world.roadWidth, this.chunkLength),
			roadMaterial,
			this.chunkCount
		);
		this.roadMesh.receiveShadow = true;
		this.roadMesh.frustumCulled = false;
		this.roadMesh.name = "road";
		this.group.add(this.roadMesh);

		const lineMaterial = new MeshStandardMaterial({
			color: new Color(palette.roadLine),
			roughness: 0.6,
			metalness: 0,
			emissive: new Color(palette.roadLine),
			emissiveIntensity: 0.12
		});
		applyCurvedWorld(lineMaterial);

		// Vạch kẻ ĐỨT thay vì liền: vạch đứt lướt về phía người chơi là tín hiệu tốc độ
		// đọc được ngay, còn vạch liền thì đứng yên về mặt thị giác. Vẫn 1 draw call.
		this.laneLineMesh = new InstancedMesh(
			new BoxGeometry(0.22, 0.02, DASH_LENGTH),
			lineMaterial,
			this.chunkCount * 2 * DASHES_PER_CHUNK
		);
		this.laneLineMesh.frustumCulled = false;
		this.laneLineMesh.name = "lane-lines";
		this.group.add(this.laneLineMesh);

		// Nền cỏ trải rộng hai bên — 1 mesh tĩnh, bám camera nên không cần tái chế.
		const groundMaterial = new MeshStandardMaterial({
			color: new Color(palette.ground),
			roughness: 1,
			metalness: 0
		});
		applyCurvedWorld(groundMaterial);
		this.groundMesh = new Mesh(new PlaneGeometry(320, 620), groundMaterial);
		this.groundMesh.rotation.x = -Math.PI / 2;
		this.groundMesh.position.y = -0.02;
		this.groundMesh.receiveShadow = true;
		this.groundMesh.frustumCulled = false;
		this.groundMesh.name = "ground";
		this.group.add(this.groundMesh);

		this.layoutChunks();
	}

	private layoutChunks(): void {
		for (let index = 0; index < this.chunkCount; index += 1) {
			// Chunk 0 ngay dưới chân player, các chunk sau trải về phía trước (-z).
			this.chunkZ[index] = tuning.world.recycleZ - index * this.chunkLength;
		}

		this.writeChunkMatrices();
	}

	private writeChunkMatrices(): void {
		const halfLength = this.chunkLength / 2;

		for (let index = 0; index < this.chunkCount; index += 1) {
			const nearZ = this.chunkZ[index] ?? 0;
			const centerZ = nearZ - halfLength;

			// Mặt đường: xoay phẳng, đặt tại tâm chunk.
			this.scratchPosition.set(0, 0, centerZ);
			this.scratchQuaternion.setFromAxisAngle(X_AXIS, -Math.PI / 2);
			this.scratchScale.set(1, 1, 1);
			this.scratchMatrix.compose(this.scratchPosition, this.scratchQuaternion, this.scratchScale);
			this.roadMesh.setMatrixAt(index, this.scratchMatrix);

			// Vạch kẻ NẰM GIỮA 3 làn: làn ở x = -offset, 0, +offset ⇒ vạch ở ±offset/2.
			this.scratchQuaternion.identity();
			const dashSpacing = this.chunkLength / DASHES_PER_CHUNK;

			for (let side = 0; side < 2; side += 1) {
				const offsetX = (side === 0 ? -1 : 1) * (tuning.world.laneOffsetX / 2);

				for (let dash = 0; dash < DASHES_PER_CHUNK; dash += 1) {
					const dashZ = nearZ - dash * dashSpacing - dashSpacing / 2;
					this.scratchPosition.set(offsetX, 0.012, dashZ);
					this.scratchMatrix.compose(this.scratchPosition, this.scratchQuaternion, this.scratchScale);
					this.laneLineMesh.setMatrixAt((index * 2 + side) * DASHES_PER_CHUNK + dash, this.scratchMatrix);
				}
			}
		}

		this.roadMesh.instanceMatrix.needsUpdate = true;
		this.laneLineMesh.instanceMatrix.needsUpdate = true;
	}

	/**
	 * Đăng ký một loại trang trí (cây, nhà, hàng rào…) thành 1 InstancedMesh.
	 * Gọi lúc nạp scene, KHÔNG gọi trong game loop.
	 */
	addDecorLayer(source: TrackDecorSource): void {
		const geometry = source.template.geometry;
		const material = source.template.material;
		const materials = Array.isArray(material) ? material : [material];

		for (const entry of materials) {
			applyCurvedWorld(entry);
		}

		const mesh = new InstancedMesh(geometry, material, source.capacity);
		mesh.name = `decor-${source.name}`;
		mesh.castShadow = true;
		mesh.receiveShadow = false;
		mesh.frustumCulled = false;

		// Ẩn toàn bộ slot lúc khởi tạo — chưa slot nào được dùng.
		for (let index = 0; index < source.capacity; index += 1) {
			this.hideInstance(mesh, index);
		}

		mesh.count = 0;
		mesh.instanceMatrix.needsUpdate = true;
		this.group.add(mesh);
		this.decorLayers.push({ mesh, used: 0, capacity: source.capacity });
	}

	private hideInstance(mesh: InstancedMesh, index: number): void {
		this.scratchPosition.copy(HIDDEN_POSITION);
		this.scratchQuaternion.identity();
		this.scratchScale.setScalar(HIDDEN_SCALE);
		this.scratchMatrix.compose(this.scratchPosition, this.scratchQuaternion, this.scratchScale);
		mesh.setMatrixAt(index, this.scratchMatrix);
	}

	/**
	 * Rải trang trí hai bên đường cho một dải z. Mỗi lần chunk được tái chế thì
	 * gọi lại cho đúng dải đó — vị trí sinh từ seed nên chạy lại vẫn y hệt.
	 */
	private scatterDecor(nearZ: number): void {
		const farZ = nearZ - this.chunkLength;
		const roadEdge = tuning.world.roadWidth / 2;

		for (const layer of this.decorLayers) {
			// Mỗi layer đặt 2–4 bản sao / chunk, chia đều 2 bên.
			const count = 2 + Math.floor(this.random() * 3);

			for (let item = 0; item < count; item += 1) {
				const slot = layer.used % layer.capacity;
				layer.used += 1;

				const side = this.random() < 0.5 ? -1 : 1;
				const distanceFromRoad = 1.6 + this.random() * 9;
				const x = side * (roadEdge + distanceFromRoad);
				const z = farZ + this.random() * this.chunkLength;
				const scale = 0.85 + this.random() * 0.5;

				this.scratchPosition.set(x, 0, z);
				this.scratchQuaternion.setFromAxisAngle(Y_AXIS, this.random() * Math.PI * 2);
				this.scratchScale.setScalar(scale);
				this.scratchMatrix.compose(this.scratchPosition, this.scratchQuaternion, this.scratchScale);
				layer.mesh.setMatrixAt(slot, this.scratchMatrix);
			}

			// Chỉ vẽ đúng số slot đã dùng. InstancedMesh vẫn xử lý vertex cho MỌI
			// instance kể cả slot ẩn (scale ~0), nên để `count` = capacity là trả tiền
			// tam giác cho những bản sao không ai nhìn thấy.
			layer.mesh.count = Math.min(layer.used, layer.capacity);
			layer.mesh.instanceMatrix.needsUpdate = true;
		}
	}

	/** Rải trang trí cho toàn bộ chunk đang có (gọi 1 lần sau khi addDecorLayer). */
	populateInitialDecor(): void {
		for (const nearZ of this.chunkZ) {
			this.scatterDecor(nearZ);
		}
	}

	/**
	 * Đẩy thế giới về phía player. Trả về số chunk vừa được tái chế trong bước này
	 * (Spawn dùng để biết khi nào cần sinh pattern mới).
	 */
	update(deltaSec: number, speedUnitsPerSec: number): number {
		const advance = speedUnitsPerSec * deltaSec;
		this.distanceM += advance;

		let recycled = 0;
		const totalLength = this.chunkCount * this.chunkLength;

		for (let index = 0; index < this.chunkCount; index += 1) {
			let nearZ = (this.chunkZ[index] ?? 0) + advance;

			// Chunk đã trôi qua sau lưng player → đẩy ra đầu hàng.
			if (nearZ - this.chunkLength > tuning.world.recycleZ) {
				nearZ -= totalLength;
				this.scatterDecor(nearZ);
				recycled += 1;
			}

			this.chunkZ[index] = nearZ;
		}

		this.writeChunkMatrices();
		return recycled;
	}

	/** Nền cỏ bám camera để không lộ mép. */
	syncGround(cameraZ: number): void {
		this.groundMesh.position.z = cameraZ - 260;
	}

	/** x thế giới của tâm làn (0 = trái, 1 = giữa, 2 = phải). */
	static laneToX(lane: number): number {
		return (lane - 1) * tuning.world.laneOffsetX;
	}

	get drawCallCount(): number {
		return 3 + this.decorLayers.length;
	}

	poolCounts(): Record<string, number> {
		return {
			chunks: this.chunkCount,
			decorLayers: this.decorLayers.length
		};
	}

	attachTo(scene: Scene | Group): void {
		scene.add(this.group);
	}

	dispose(): void {
		this.roadMesh.dispose();
		this.laneLineMesh.dispose();
		this.groundMesh.geometry.dispose();

		for (const layer of this.decorLayers) {
			layer.mesh.dispose();
		}

		this.decorLayers.length = 0;
	}
}

export type { ObstacleBand };
