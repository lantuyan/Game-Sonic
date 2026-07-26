// MODULE DUY NHẤT biết đến WebGL (Q18) — đổi sang WebGPU sau này chỉ sửa ở đây.

import {
	ACESFilmicToneMapping,
	PCFSoftShadowMap,
	PerspectiveCamera,
	SRGBColorSpace,
	Scene,
	WebGLRenderer
} from "three";
import { tuning } from "@/tuning";
import type { QualitySettings } from "@/core/Quality";

export interface RendererStats {
	drawCalls: number;
	triangles: number;
	programs: number;
	geometries: number;
	textures: number;
}

export class Renderer {
	readonly camera: PerspectiveCamera;

	private readonly container: HTMLElement;
	private readonly renderer: WebGLRenderer;
	private readonly stats: RendererStats = {
		drawCalls: 0,
		triangles: 0,
		programs: 0,
		geometries: 0,
		textures: 0
	};

	private pixelRatioCap = 2;

	private readonly handleResize = (): void => {
		this.resize();
	};

	constructor(container: HTMLElement, quality: QualitySettings) {
		this.container = container;

		this.renderer = new WebGLRenderer({
			antialias: quality.antialias,
			powerPreference: "high-performance",
			// Không cần alpha/stencil: tiết kiệm băng thông trên GPU tích hợp.
			alpha: false,
			stencil: false
		});
		this.renderer.outputColorSpace = SRGBColorSpace;
		this.renderer.toneMapping = ACESFilmicToneMapping;
		this.renderer.toneMappingExposure = 1.05;
		this.renderer.shadowMap.enabled = quality.shadows;
		this.renderer.shadowMap.type = PCFSoftShadowMap;
		this.renderer.setClearColor(0x0f1d38, 1);

		this.camera = new PerspectiveCamera(tuning.world.cameraFov, 1, 0.1, 400);

		container.appendChild(this.renderer.domElement);
		this.applyQuality(quality);
		this.resize();
		window.addEventListener("resize", this.handleResize);
		window.addEventListener("orientationchange", this.handleResize);
	}

	get domElement(): HTMLCanvasElement {
		return this.renderer.domElement;
	}

	/** Renderer thật — CHỈ dùng cho post-processing (fx/PostFX.ts). */
	get webglRenderer(): WebGLRenderer {
		return this.renderer;
	}

	applyQuality(quality: QualitySettings): void {
		this.pixelRatioCap = quality.pixelRatioCap;
		this.renderer.shadowMap.enabled = quality.shadows;
		this.renderer.shadowMap.needsUpdate = true;
		this.updatePixelRatio();
	}

	/** Auto-quality hạ DPR TRƯỚC khi đụng tới shadow/bloom (plan §7.1). */
	setPixelRatioCap(cap: number): void {
		if (cap === this.pixelRatioCap) {
			return;
		}

		this.pixelRatioCap = cap;
		this.updatePixelRatio();
	}

	private updatePixelRatio(): void {
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.pixelRatioCap));
	}

	resize(): void {
		const width = Math.max(this.container.clientWidth, 1);
		const height = Math.max(this.container.clientHeight, 1);

		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(width, height, false);
		this.updatePixelRatio();
	}

	render(scene: Scene): void {
		this.renderer.render(scene, this.camera);
	}

	/** Đọc `renderer.info` cho `?debug`. Gọi sau render. */
	readStats(): RendererStats {
		const info = this.renderer.info;
		this.stats.drawCalls = info.render.calls;
		this.stats.triangles = info.render.triangles;
		this.stats.programs = info.programs === null ? 0 : info.programs.length;
		this.stats.geometries = info.memory.geometries;
		this.stats.textures = info.memory.textures;
		return this.stats;
	}

	dispose(): void {
		window.removeEventListener("resize", this.handleResize);
		window.removeEventListener("orientationchange", this.handleResize);
		this.renderer.dispose();
		this.renderer.domElement.remove();
	}
}
