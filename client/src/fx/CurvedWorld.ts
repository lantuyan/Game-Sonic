// Bẻ cong thế giới bằng vertex shader (plan §4.2) — thủ thuật chủ lực của
// Subway Surfers: đường THẲNG về logic (va chạm/làn vẫn tính trên trục z phẳng),
// chỉ HÌNH bị uốn để che pop-in ở rìa tầm nhìn và tạo cảm giác tốc độ.
//
// Áp bằng `onBeforeCompile` cho mọi material của track/props, nên không cần viết
// lại toàn bộ shader PBR của three.

import type { Material, WebGLProgramParametersWithUniforms, WebGLRenderer } from "three";
import { tuning } from "@/tuning";

/** Uniform dùng CHUNG cho mọi material — đổi 1 chỗ là cả thế giới đổi theo. */
const curveUniforms = {
	uCurveX: { value: tuning.curvedWorld.curveX },
	uCurveY: { value: tuning.curvedWorld.curveY },
	uCurveEnabled: { value: tuning.curvedWorld.enabled }
};

const patchedMaterials = new WeakSet<Material>();

const VERTEX_DECLARATIONS = /* glsl */ `
	uniform float uCurveX;
	uniform float uCurveY;
	uniform float uCurveEnabled;
`;

// Uốn theo bình phương khoảng cách trước mặt player: gần thì gần như phẳng,
// xa thì cong hẳn xuống + dạt ngang → chân trời "rơi" đi như đường cong quả đất.
const VERTEX_BODY = /* glsl */ `
	#include <begin_vertex>

	if (uCurveEnabled > 0.5) {
		vec4 curveWorldPosition = modelMatrix * vec4(transformed, 1.0);
		float curveDepth = curveWorldPosition.z - cameraPosition.z;
		float curveDistanceSq = curveDepth * curveDepth;

		vec4 curveOffset = vec4(
			uCurveX * curveDistanceSq,
			-uCurveY * curveDistanceSq,
			0.0,
			0.0
		);

		transformed += (inverse(modelMatrix) * curveOffset).xyz;
	}
`;

/**
 * Gắn hiệu ứng cong vào 1 material. Gọi được nhiều lần trên cùng material
 * (đã vá thì bỏ qua), an toàn khi material dùng chung giữa nhiều mesh.
 */
export function applyCurvedWorld(material: Material): void {
	if (patchedMaterials.has(material) === true) {
		return;
	}

	patchedMaterials.add(material);

	const previousOnBeforeCompile = material.onBeforeCompile.bind(material);

	material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) => {
		previousOnBeforeCompile(shader, renderer);

		shader.uniforms.uCurveX = curveUniforms.uCurveX;
		shader.uniforms.uCurveY = curveUniforms.uCurveY;
		shader.uniforms.uCurveEnabled = curveUniforms.uCurveEnabled;

		shader.vertexShader = shader.vertexShader
			.replace("#include <common>", `#include <common>\n${VERTEX_DECLARATIONS}`)
			.replace("#include <begin_vertex>", VERTEX_BODY);
	};

	// Buộc three biên dịch lại chương trình khi material đã từng được dùng.
	material.needsUpdate = true;
}

/**
 * Đồng bộ uniform với `tuning` — gọi mỗi frame (rẻ: chỉ gán 3 số) để panel
 * `?debug` bật/tắt và chỉnh độ cong thấy hiệu quả ngay.
 */
export function syncCurvedWorldUniforms(): void {
	curveUniforms.uCurveX.value = tuning.curvedWorld.curveX;
	curveUniforms.uCurveY.value = tuning.curvedWorld.curveY;
	curveUniforms.uCurveEnabled.value = tuning.curvedWorld.enabled;
}

/**
 * Tính offset hình học mà shader áp cho một điểm ở khoảng cách `depth`.
 * CPU dùng để đặt những thứ phải "dính" vào mặt đường cong (bóng blob, cổng,
 * particle) — cùng công thức với shader nên không lệch.
 */
export function curveOffsetAt(depth: number): { x: number; y: number } {
	if (tuning.curvedWorld.enabled < 0.5) {
		return { x: 0, y: 0 };
	}

	const distanceSq = depth * depth;

	return {
		x: tuning.curvedWorld.curveX * distanceSq,
		y: -tuning.curvedWorld.curveY * distanceSq
	};
}
