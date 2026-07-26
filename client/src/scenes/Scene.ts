// Hợp đồng chung cho mọi scene (Boot/Menu/Run/Result). App shell chỉ biết interface
// này — thêm scene mới không phải sửa vòng lặp.

import type { Scene as ThreeScene } from "three";
import type { GameContext } from "@/core/GameContext";

export interface GameScene {
	readonly name: string;
	/** Scene Three.js được render mỗi frame. */
	readonly scene: ThreeScene;

	enter(context: GameContext): void | Promise<void>;
	/** dt LUÔN = engine.fixedDeltaSec. */
	update(deltaSec: number): void;
	/** alpha ∈ [0,1) — nội suy hình giữa 2 bước vật lý. */
	render(alpha: number): void;
	exit(): void;
	/** Số object đang sống trong pool, cho `?debug`. */
	poolCounts?(): Record<string, number>;
	resize?(): void;
}
