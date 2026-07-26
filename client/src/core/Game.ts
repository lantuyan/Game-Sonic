// App shell: sở hữu Engine/Renderer/Quality/Input/DebugOverlay và scene đang chạy.
// Đây là nơi DUY NHẤT nối các mảnh core lại với nhau.

import { Engine } from "@/core/Engine";
import { Renderer } from "@/core/Renderer";
import { Quality } from "@/core/Quality";
import { Input } from "@/core/Input";
import { EventBus } from "@/core/EventBus";
import { DebugOverlay, isDebugEnabled } from "@/debug/DebugOverlay";
import type { GameContext, GameEvents } from "@/core/GameContext";
import type { GameScene } from "@/scenes/Scene";

const EMPTY_POOLS: Record<string, number> = {};

export class Game {
	readonly context: GameContext;

	private readonly engine: Engine;
	private readonly renderer: Renderer;
	private readonly quality: Quality;
	private readonly input: Input;
	private readonly debugOverlay: DebugOverlay | null;

	private activeScene: GameScene | null = null;

	constructor(container: HTMLElement, uiRoot: HTMLElement) {
		this.quality = new Quality();
		this.renderer = new Renderer(container, this.quality.current);
		this.input = new Input(container);

		const events = new EventBus<GameEvents>();

		this.engine = new Engine({
			update: (deltaSec) => {
				this.activeScene?.update(deltaSec);
			},
			render: (alpha) => {
				const scene = this.activeScene;

				if (scene === null) {
					return;
				}

				scene.render(alpha);
				this.renderer.render(scene.scene);
				this.afterRender();
			}
		});

		this.quality.onChange((settings, presetName) => {
			this.renderer.applyQuality(settings);
			events.emit("quality:changed", { preset: presetName });
		});

		this.context = {
			engine: this.engine,
			renderer: this.renderer,
			quality: this.quality,
			input: this.input,
			events,
			uiRoot,
			debug: isDebugEnabled()
		};

		this.debugOverlay = this.context.debug ? new DebugOverlay(uiRoot) : null;
	}

	private afterRender(): void {
		const realDeltaSec = this.engine.lastFrameMs / 1000;

		// Auto-quality đo bằng delta THẬT, không phải fixed delta.
		this.quality.sample(realDeltaSec);

		if (this.debugOverlay === null) {
			return;
		}

		this.debugOverlay.update(realDeltaSec, {
			frameMs: this.engine.lastFrameMs,
			stats: this.renderer.readStats(),
			poolCounts: this.activeScene?.poolCounts?.() ?? EMPTY_POOLS,
			extra: {
				scene: this.activeScene?.name ?? "—",
				preset: this.quality.preset,
				dprCap: this.quality.current.pixelRatioCap,
				timeScale: this.engine.timeScale.toFixed(2)
			}
		});
	}

	async setScene(scene: GameScene): Promise<void> {
		this.activeScene?.exit();
		this.activeScene = scene;
		this.input.flush();
		await scene.enter(this.context);
		// Nạp asset/dựng scene có thể tốn cả giây — xóa nợ thời gian trước khi chạy tiếp.
		this.engine.resetClock();
	}

	start(): void {
		this.engine.start();
	}

	stop(): void {
		this.engine.stop();
	}

	dispose(): void {
		this.engine.stop();
		this.activeScene?.exit();
		this.input.dispose();
		this.renderer.dispose();
		this.debugOverlay?.dispose();
		this.context.events.clear();
	}
}
