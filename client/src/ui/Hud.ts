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
	/** Banner giữa màn: "TRÙM CHẶN ĐƯỜNG!", đếm ngược 3-2-1, tên chặng mới (P1-1). */
	private readonly bannerElement: HTMLDivElement;
	/** Popup "SÁT NÚT! +10" — bay lên rồi tắt (P1-1). */
	private readonly nearMissElement: HTMLDivElement;

	private readonly lifeElements: HTMLSpanElement[] = [];
	private readonly unsubscribes: Array<() => void> = [];
	private toastTimer = 0;
	private bannerTimer = 0;
	private nearMissTimer = 0;

	constructor(parent: HTMLElement, events: EventBus<GameEvents>, options: { practice?: boolean } = {}) {
		this.root = document.createElement("div");
		this.root.className = "hud";
		this.root.dataset.practice = options.practice === true ? "true" : "false";

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

		if (options.practice === true) {
			// Luyện tập KHÔNG có tim và KHÔNG có điểm (plan §4.6) — giấu luôn để màn
			// hình không nói dối. Thay bằng nhãn để em biết mình đang ở chế độ nào.
			const badge = document.createElement("div");
			badge.className = "hud__practice";
			badge.textContent = "LUYỆN TẬP";
			this.scoreElement.hidden = true;
			top.append(stats, badge);
		} else {
			top.append(stats, this.livesElement);
		}

		this.questionElement = document.createElement("div");
		this.questionElement.className = "hud__question";
		this.questionElement.hidden = true;
		this.questionElement.setAttribute("role", "status");

		this.toastElement = document.createElement("div");
		this.toastElement.className = "hud__toast";
		this.toastElement.hidden = true;
		this.toastElement.setAttribute("role", "status");

		this.bannerElement = document.createElement("div");
		this.bannerElement.className = "hud__banner";
		this.bannerElement.hidden = true;
		this.bannerElement.setAttribute("role", "status");

		this.nearMissElement = document.createElement("div");
		this.nearMissElement.className = "hud__nearmiss";
		this.nearMissElement.hidden = true;
		// aria-hidden: đọc màn hình không cần hét "SÁT NÚT" mỗi lần lướt sát.
		this.nearMissElement.setAttribute("aria-hidden", "true");

		this.root.append(top, document.createElement("div"), this.questionElement);
		parent.append(this.root, this.toastElement, this.bannerElement, this.nearMissElement);

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
			}),
			events.on("boss:intro", () => {
				this.showBanner("TRÙM CHẶN ĐƯỜNG!", 2.4, "boss");
			}),
			events.on("boss:resolved", ({ result }) => {
				this.showBanner(
					result === "correct" ? "PHÁ KHIÊN! 🎉" : "Trùm chạy mất — em mất 1 tim",
					2,
					result === "correct" ? "win" : "lose"
				);
			}),
			events.on("boss:countdown", ({ secondsLeft }) => {
				this.showBanner(String(secondsLeft), 0.95, "countdown");
			}),
			events.on("biome:changed", ({ label }) => {
				this.showToast(`Chặng mới: ${label}`, 3);
			}),
			events.on("nearmiss", ({ points, chain, multiplier, perfect }) => {
				this.showNearMiss(points, chain, multiplier, perfect);
			}),
			// P2-2 — Đồng hồ chậm phải NÓI RA là đang bật, nếu không người chơi chỉ
			// thấy thế giới chậm lại và tưởng máy giật.
			events.on("powerup:started", ({ kind, durationSec }) => {
				if (kind === "slowClock") {
					this.showToast(`Đồng hồ chậm! Thế giới trôi chậm ${Math.round(durationSec)} giây ⏳`, 2.2);
				}
			})
		);
	}

	/** Banner giữa màn hình. `variant` chỉ đổi màu/cỡ chữ qua CSS. */
	showBanner(text: string, durationSec: number, variant: "boss" | "win" | "lose" | "countdown"): void {
		this.bannerElement.textContent = text;
		this.bannerElement.dataset.variant = variant;
		this.bannerElement.hidden = false;
		this.bannerTimer = durationSec;
		// Restart animation: bỏ rồi gắn lại class để 3-2-1 nảy từng số một.
		this.bannerElement.classList.remove("is-pop");
		void this.bannerElement.offsetWidth;
		this.bannerElement.classList.add("is-pop");
	}

	/**
	 * P2-2 — ba tầng thông tin trong một dòng, đọc được trong 0.8 giây:
	 * bậc (SÁT NÚT / CỰC SÁT), điểm, và chuỗi nếu đang có. Chuỗi 1–2 KHÔNG hiện
	 * "×1" — một hệ số không làm gì mà vẫn nhấp nháy chỉ là nhiễu.
	 */
	showNearMiss(points: number, chain = 1, multiplier = 1, perfect = false): void {
		const chainText = multiplier > 1 ? ` · CHUỖI ${chain} ×${multiplier}` : "";
		this.nearMissElement.textContent = `${perfect ? "CỰC SÁT!" : "SÁT NÚT!"} +${points}${chainText}`;
		this.nearMissElement.dataset.tier = perfect ? "perfect" : "near";
		this.nearMissElement.dataset.chain = multiplier > 1 ? "true" : "false";
		this.nearMissElement.hidden = false;
		this.nearMissTimer = 0.8;
		this.nearMissElement.classList.remove("is-pop");
		void this.nearMissElement.offsetWidth;
		this.nearMissElement.classList.add("is-pop");
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
		if (this.toastTimer > 0) {
			this.toastTimer -= deltaSec;

			if (this.toastTimer <= 0) {
				this.toastElement.hidden = true;
			}
		}

		if (this.bannerTimer > 0) {
			this.bannerTimer -= deltaSec;

			if (this.bannerTimer <= 0) {
				this.bannerElement.hidden = true;
			}
		}

		if (this.nearMissTimer > 0) {
			this.nearMissTimer -= deltaSec;

			if (this.nearMissTimer <= 0) {
				this.nearMissElement.hidden = true;
			}
		}
	}

	dispose(): void {
		for (const unsubscribe of this.unsubscribes) {
			unsubscribe();
		}

		this.unsubscribes.length = 0;
		this.root.remove();
		this.toastElement.remove();
		this.bannerElement.remove();
		this.nearMissElement.remove();
	}
}
