// Trình xem model nhanh cho DoD P0-3: `?debug&model=knight`.
//
// Xoay được bằng kéo chuột/ngón tay, chọn clip bằng phím 1–6, và in ra danh sách clip
// thực có trong GLB — dùng để mắt thường xác nhận từng nhân vật phát đủ animation
// sau khi pipeline lọc/đổi tên clip.

import {
	AnimationMixer,
	Box3,
	Color,
	DirectionalLight,
	GridHelper,
	Group,
	HemisphereLight,
	Scene,
	Vector3,
	type AnimationAction,
	type AnimationClip
} from "three";
import { AssetManager } from "@/core/AssetManager";
import { tuning } from "@/tuning";
import type { GameScene } from "@/scenes/Scene";
import type { GameContext } from "@/core/GameContext";

const BACKGROUND = 0x223357;

export class ModelViewerScene implements GameScene {
	readonly name = "model-viewer";
	readonly scene = new Scene();

	private readonly assets = new AssetManager();
	private readonly pivot = new Group();
	private readonly requestedModel: string;

	private mixer: AnimationMixer | null = null;
	private clips: AnimationClip[] = [];
	private activeAction: AnimationAction | null = null;
	private context: GameContext | null = null;
	private panel: HTMLDivElement | null = null;
	private spinPerSec = 0.6;
	private rotation = 0;
	private previousRotation = 0;

	private dragging = false;
	private lastPointerX = 0;

	private readonly handlePointerDown = (event: PointerEvent): void => {
		this.dragging = true;
		this.lastPointerX = event.clientX;
	};

	private readonly handlePointerMove = (event: PointerEvent): void => {
		if (this.dragging === false) {
			return;
		}

		this.rotation += (event.clientX - this.lastPointerX) * 0.01;
		this.previousRotation = this.rotation;
		this.lastPointerX = event.clientX;
	};

	private readonly handlePointerUp = (): void => {
		this.dragging = false;
	};

	private readonly handleKeyDown = (event: KeyboardEvent): void => {
		const index = Number.parseInt(event.key, 10) - 1;

		if (Number.isNaN(index) === false && index >= 0 && index < this.clips.length) {
			this.playClipAt(index);
			return;
		}

		if (event.key === " ") {
			this.spinPerSec = this.spinPerSec === 0 ? 0.6 : 0;
		}
	};

	constructor(modelName: string) {
		this.requestedModel = modelName;
		this.scene.background = new Color(BACKGROUND);
		this.scene.add(new HemisphereLight(0xffffff, 0x33456b, 1.2));

		const sun = new DirectionalLight(0xffffff, 1.6);
		sun.position.set(4, 8, 5);
		this.scene.add(sun);

		const grid = new GridHelper(10, 10, 0x6f88bb, 0x3c4d78);
		this.scene.add(grid);
		this.scene.add(this.pivot);
	}

	async enter(context: GameContext): Promise<void> {
		this.context = context;

		const camera = context.renderer.camera;
		camera.position.set(0, 1.6, 4.2);
		camera.lookAt(0, 0.9, 0);

		const canvas = context.renderer.domElement;
		canvas.addEventListener("pointerdown", this.handlePointerDown);
		canvas.addEventListener("pointermove", this.handlePointerMove);
		canvas.addEventListener("pointerup", this.handlePointerUp);
		window.addEventListener("keydown", this.handleKeyDown);

		const manifest = await this.assets.loadManifest();
		const character = manifest.characters.find((entry) => entry.id === this.requestedModel);
		const prop = manifest.props.find((entry) => entry.url.includes(`/${this.requestedModel}.glb`));
		const url = character?.url ?? prop?.url ?? null;

		if (url === null) {
			this.showPanel(
				`Không có model "${this.requestedModel}".<br />Nhân vật: ${manifest.characters
					.map((entry) => entry.id)
					.join(", ")}`
			);
			return;
		}

		const model = await this.assets.loadModel(url);
		const instance = model.scene;

		// Chuẩn hóa chiều cao như Player sẽ làm (P0-5) để xem đúng tỉ lệ thật.
		const box = new Box3().setFromObject(instance);
		const size = new Vector3();
		box.getSize(size);
		const scale = size.y > 0 ? tuning.player.targetHeight / size.y : 1;
		instance.scale.setScalar(scale);
		instance.position.y = -box.min.y * scale;

		this.pivot.add(instance);
		this.clips = model.clips;

		if (this.clips.length > 0) {
			this.mixer = new AnimationMixer(instance);
			this.playClipAt(0);
		}

		this.showPanel(
			[
				`<strong>${this.requestedModel}</strong> — ${(model.scene.children.length || 0)} node`,
				`clip (${this.clips.length}): ${this.clips.map((clip, index) => `${index + 1}·${clip.name}`).join(" ") || "—"}`,
				"kéo để xoay · phím 1–6 đổi clip · Space bật/tắt tự xoay"
			].join("<br />")
		);
	}

	private playClipAt(index: number): void {
		const mixer = this.mixer;
		const clip = this.clips[index];

		if (mixer === null || clip === undefined) {
			return;
		}

		const next = mixer.clipAction(clip);
		next.reset().fadeIn(0.15).play();
		this.activeAction?.fadeOut(0.15);
		this.activeAction = next;
	}

	private showPanel(html: string): void {
		if (this.panel === null) {
			this.panel = document.createElement("div");
			this.panel.style.cssText = [
				"position:fixed",
				"left:8px",
				"bottom:8px",
				"z-index:9999",
				"font:12px/1.5 ui-monospace,Menlo,monospace",
				"color:#d7e6ff",
				"background:rgba(8,16,32,.86)",
				"border:1px solid rgba(120,170,255,.35)",
				"border-radius:8px",
				"padding:8px 10px",
				"max-width:min(92vw,560px)"
			].join(";");
			this.context?.uiRoot.appendChild(this.panel);
		}

		this.panel.innerHTML = html;
	}

	update(deltaSec: number): void {
		this.previousRotation = this.rotation;

		if (this.dragging === false) {
			this.rotation += this.spinPerSec * deltaSec;
		}

		this.mixer?.update(deltaSec);
	}

	render(alpha: number): void {
		this.pivot.rotation.y = this.previousRotation + (this.rotation - this.previousRotation) * alpha;
	}

	poolCounts(): Record<string, number> {
		return { clips: this.clips.length };
	}

	exit(): void {
		const canvas = this.context?.renderer.domElement;
		canvas?.removeEventListener("pointerdown", this.handlePointerDown);
		canvas?.removeEventListener("pointermove", this.handlePointerMove);
		canvas?.removeEventListener("pointerup", this.handlePointerUp);
		window.removeEventListener("keydown", this.handleKeyDown);
		this.panel?.remove();
		this.panel = null;
		this.assets.dispose();
		this.context = null;
	}
}
