// S5 — HUD trong ván. Cập nhật QUA EVENT BUS, không query DOM mỗi frame (P0-6).
//
// Mọi phần tử được dựng một lần lúc khởi tạo; update chỉ ghi textContent. Đề bài
// là DOM (không canvas) để dấu tiếng Việt nét trên mọi DPR (plan §5.2).

import { tuning } from "@/tuning";
import type { EventBus } from "@/core/EventBus";
import type { GameEvents } from "@/core/GameContext";

export class Hud {
	private readonly root: HTMLDivElement;
	private readonly scoreElement: HTMLDivElement;
	private readonly coinsElement: HTMLDivElement;
	private readonly livesElement: HTMLDivElement;
	private readonly questionElement: HTMLDivElement;
	private readonly toastElement: HTMLDivElement;

	private readonly lifeElements: HTMLSpanElement[] = [];
	private readonly unsubscribes: Array<() => void> = [];
	private toastTimer = 0;

	constructor(parent: HTMLElement, events: EventBus<GameEvents>) {
		this.root = document.createElement("div");
		this.root.className = "hud";

		this.scoreElement = document.createElement("div");
		this.scoreElement.className = "hud__score";
		this.scoreElement.textContent = "0";

		this.coinsElement = document.createElement("div");
		this.coinsElement.className = "hud__coins";
		this.coinsElement.textContent = "◉ 0";

		const stats = document.createElement("div");
		stats.className = "hud__stats";
		stats.append(this.scoreElement, this.coinsElement);

		this.livesElement = document.createElement("div");
		this.livesElement.className = "hud__lives";
		this.livesElement.setAttribute("aria-label", "Số mạng còn lại");

		for (let index = 0; index < tuning.scoring.startingLives; index += 1) {
			const life = document.createElement("span");
			life.className = "hud__life";
			life.textContent = "♥";
			this.lifeElements.push(life);
			this.livesElement.appendChild(life);
		}

		const top = document.createElement("div");
		top.className = "hud__top";
		top.append(stats, this.livesElement);

		this.questionElement = document.createElement("div");
		this.questionElement.className = "hud__question";
		this.questionElement.hidden = true;
		this.questionElement.setAttribute("role", "status");

		this.toastElement = document.createElement("div");
		this.toastElement.className = "hud__toast";
		this.toastElement.hidden = true;
		this.toastElement.setAttribute("role", "status");

		this.root.append(top, document.createElement("div"), this.questionElement);
		parent.append(this.root, this.toastElement);

		this.bind(events);
	}

	private bind(events: EventBus<GameEvents>): void {
		this.unsubscribes.push(
			events.on("score:changed", ({ score }) => {
				this.scoreElement.textContent = String(score);
			}),
			events.on("coins:changed", ({ coins }) => {
				this.coinsElement.textContent = `◉ ${coins}`;
			}),
			events.on("lives:changed", ({ lives }) => {
				this.setLives(lives);
			}),
			events.on("quiz:telegraph", ({ questionText }) => {
				this.showQuestion(questionText);
			}),
			events.on("toast", ({ message, durationSec }) => {
				this.showToast(message, durationSec);
			})
		);
	}

	private setLives(lives: number): void {
		this.lifeElements.forEach((element, index) => {
			element.dataset.empty = index < lives ? "false" : "true";
		});
	}

	showQuestion(text: string): void {
		this.questionElement.textContent = text;
		this.questionElement.hidden = false;
	}

	hideQuestion(): void {
		this.questionElement.hidden = true;
	}

	showToast(message: string, durationSec = 2.5): void {
		this.toastElement.textContent = message;
		this.toastElement.hidden = false;
		this.toastTimer = durationSec;
	}

	update(deltaSec: number): void {
		if (this.toastTimer <= 0) {
			return;
		}

		this.toastTimer -= deltaSec;

		if (this.toastTimer <= 0) {
			this.toastElement.hidden = true;
		}
	}

	dispose(): void {
		for (const unsubscribe of this.unsubscribes) {
			unsubscribe();
		}

		this.unsubscribes.length = 0;
		this.root.remove();
		this.toastElement.remove();
	}
}
