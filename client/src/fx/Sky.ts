// Trời gradient bằng shader + fog CÙNG MÀU CHÂN TRỜI (plan §6.1).
//
// Vì sao không dùng HDRI/skybox texture: 0 KB tải về, đổi màu theo biome chỉ là
// đổi 3 uniform, và fog trùng màu chân trời khiến vật thể xa tan vào nền thay vì
// "bốc hơi" đột ngột — cách rẻ nhất để giấu điểm cắt tầm nhìn.

import {
	BackSide,
	Color,
	Fog,
	Mesh,
	ShaderMaterial,
	SphereGeometry,
	type Scene
} from "three";
import { tuning } from "@/tuning";

export interface BiomePalette {
	/** Màu đỉnh trời. */
	top: number;
	/** Màu chân trời — fog PHẢI dùng đúng màu này. */
	horizon: number;
	/** Màu dưới đường chân trời (đất/sương). */
	bottom: number;
	ground: number;
	road: number;
	roadLine: number;
}

/** Biome ① — Thành phố + Công viên (plan §3 Q4). */
export const BIOME_CITY_PARK: BiomePalette = {
	top: 0x2f7ce0,
	horizon: 0x9fd0ff,
	bottom: 0xd8ecff,
	ground: 0x4c9a4a,
	road: 0x5b6273,
	roadLine: 0xf2f4f8
};

const VERTEX_SHADER = /* glsl */ `
	varying vec3 vWorldDirection;

	void main() {
		// Hướng từ tâm ra đỉnh — đủ để nội suy gradient theo độ cao.
		vWorldDirection = normalize(position);
		gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	}
`;

const FRAGMENT_SHADER = /* glsl */ `
	uniform vec3 uTopColor;
	uniform vec3 uHorizonColor;
	uniform vec3 uBottomColor;
	uniform float uHorizonSharpness;

	varying vec3 vWorldDirection;

	void main() {
		float height = normalize(vWorldDirection).y;
		// smoothstep quanh y=0 tạo dải chân trời hẹp, sắc nét hơn mix tuyến tính.
		float aboveHorizon = smoothstep(0.0, uHorizonSharpness, height);
		float belowHorizon = smoothstep(0.0, uHorizonSharpness, -height);

		vec3 color = mix(uHorizonColor, uTopColor, aboveHorizon);
		color = mix(color, uBottomColor, belowHorizon);

		gl_FragColor = vec4(color, 1.0);
	}
`;

export class Sky {
	readonly mesh: Mesh;

	private readonly material: ShaderMaterial;

	constructor(palette: BiomePalette = BIOME_CITY_PARK) {
		this.material = new ShaderMaterial({
			uniforms: {
				uTopColor: { value: new Color(palette.top) },
				uHorizonColor: { value: new Color(palette.horizon) },
				uBottomColor: { value: new Color(palette.bottom) },
				uHorizonSharpness: { value: 0.35 }
			},
			vertexShader: VERTEX_SHADER,
			fragmentShader: FRAGMENT_SHADER,
			side: BackSide,
			depthWrite: false,
			// Trời không nhận fog, nếu không sẽ bị fog phủ lên chính nó.
			fog: false
		});

		// Bán kính đủ lớn để luôn nằm ngoài far plane của mọi vật thể track.
		this.mesh = new Mesh(new SphereGeometry(1, 24, 16), this.material);
		this.mesh.scale.setScalar(350);
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = -1;
		this.mesh.name = "sky";
	}

	/** Gắn trời + fog vào scene. Fog LUÔN lấy đúng màu chân trời. */
	attachTo(scene: Scene, palette: BiomePalette = BIOME_CITY_PARK): void {
		scene.add(this.mesh);
		scene.fog = new Fog(palette.horizon, tuning.world.fogNear, tuning.world.fogFar);
		scene.background = new Color(palette.horizon);
	}

	setPalette(scene: Scene, palette: BiomePalette): void {
		this.material.uniforms.uTopColor?.value.set(palette.top);
		this.material.uniforms.uHorizonColor?.value.set(palette.horizon);
		this.material.uniforms.uBottomColor?.value.set(palette.bottom);

		if (scene.fog instanceof Fog) {
			scene.fog.color.set(palette.horizon);
		}

		if (scene.background instanceof Color) {
			scene.background.set(palette.horizon);
		}
	}

	/** Trời bám camera để người chơi không bao giờ chạy tới "rìa" quả cầu. */
	followCamera(cameraZ: number): void {
		this.mesh.position.z = cameraZ;
	}

	/** Fog đọc lại từ tuning mỗi frame để `?debug` chỉnh được. */
	syncFog(scene: Scene): void {
		if (scene.fog instanceof Fog) {
			scene.fog.near = tuning.world.fogNear;
			scene.fog.far = tuning.world.fogFar;
		}
	}

	dispose(): void {
		this.mesh.geometry.dispose();
		this.material.dispose();
	}
}
