// Bó dịch vụ dùng chung mà mọi scene/system cần. Truyền 1 object thay vì
// import singleton lung tung — dễ test và dễ dựng lại giữa các ván.

import type { Engine } from "@/core/Engine";
import type { Renderer } from "@/core/Renderer";
import type { Quality } from "@/core/Quality";
import type { Input } from "@/core/Input";
import type { EventBus } from "@/core/EventBus";

/** Sự kiện toàn cục — HUD/UI nghe qua bus, không query DOM mỗi frame (P0-6). */
export interface GameEvents {
	"score:changed": { score: number; delta: number };
	"coins:changed": { coins: number; delta: number };
	"lives:changed": { lives: number };
	"streak:changed": { streak: number; multiplier: number };
	"fever:started": { durationSec: number };
	"fever:ending": Record<string, never>;
	"fever:ended": Record<string, never>;
	"speed:changed": { factor: number };
	"quality:changed": { preset: string };
	"quiz:telegraph": { questionText: string; secondsUntilStation: number };
	"quiz:station-open": { questionId: string; mode: "gate" | "modal" };
	"quiz:answered": { questionId: string; result: "correct" | "wrong" | "timeout"; mode: "gate" | "modal" };
	/** Boss Gate (P1-1). */
	"boss:intro": { stage: number; questionText: string };
	"boss:resolved": { result: "correct" | "wrong" | "timeout"; livesLeft: number };
	"boss:countdown": { secondsLeft: number };
	"boss:closed": Record<string, never>;
	"biome:changed": { index: number; label: string };
	/** P2-2 — `chain` là độ dài chuỗi liên tiếp, `perfect` là bậc lướt cực sát. */
	"nearmiss": { points: number; total: number; chain: number; multiplier: number; perfect: boolean };
	"powerup:started": { kind: string; durationSec: number };
	"powerup:ended": { kind: string };
	"player:hit": { livesLeft: number };
	"game:over": { score: number; coins: number };
	"toast": { message: string; durationSec: number };
}

export interface GameContext {
	engine: Engine;
	renderer: Renderer;
	quality: Quality;
	input: Input;
	events: EventBus<GameEvents>;
	/** Phần tử gắn UI overlay DOM (#ui-root). */
	uiRoot: HTMLElement;
	debug: boolean;
}
