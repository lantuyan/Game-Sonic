// S6b — modal câu hỏi. Port luồng V1 (A1 §2.9.4–6) với UI mới.
//
// Yêu cầu bắt buộc (plan §4.3 + §5): đề 20–24px, nút ≥56px, phím 1–4, khóa nút
// 400ms đầu (chống bấm nhầm khi modal vừa bật), timer chỉ đỏ ở 5s cuối.
// Text đề bài là DOM (không canvas) để dấu tiếng Việt nét ở mọi DPR.

import { tuning } from "@/tuning";
import type { LegacyQuestion } from "@/integration/questionBank.d";

const ANSWER_KEYS = ["A", "B", "C", "D"];

export interface QuizModalCallbacks {
	onAnswer(answerKey: string): void;
}

export class QuizModal {
	private readonly root: HTMLDivElement;
	private readonly questionElement: HTMLParagraphElement;
	private readonly answersElement: HTMLDivElement;
	private readonly timerElement: HTMLDivElement;
	private readonly hintElement: HTMLParagraphElement;

	private readonly callbacks: QuizModalCallbacks;
	private buttons: HTMLButtonElement[] = [];
	private locked = true;
	private open = false;
	private remainingSec = 0;
	private totalSec = 0;

	private readonly handleKeyDown = (event: KeyboardEvent): void => {
		if (this.open === false || this.locked === true) {
			return;
		}

		const index = ANSWER_KEYS.indexOf(event.key.toUpperCase());
		const digit = Number.parseInt(event.key, 10) - 1;
		const target = index !== -1 ? index : digit;

		if (Number.isNaN(target) === true || target < 0 || target >= this.buttons.length) {
			return;
		}

		event.preventDefault();
		this.buttons[target]?.click();
	};

	constructor(parent: HTMLElement, callbacks: QuizModalCallbacks) {
		this.callbacks = callbacks;

		this.root = document.createElement("div");
		this.root.className = "quiz-modal";
		this.root.setAttribute("role", "dialog");
		this.root.setAttribute("aria-modal", "true");
		this.root.hidden = true;

		this.timerElement = document.createElement("div");
		this.timerElement.className = "quiz-modal__timer";

		this.hintElement = document.createElement("p");
		this.hintElement.className = "quiz-modal__hint";

		this.questionElement = document.createElement("p");
		this.questionElement.className = "quiz-modal__question";

		this.answersElement = document.createElement("div");
		this.answersElement.className = "quiz-modal__answers";

		const panel = document.createElement("div");
		panel.className = "quiz-modal__panel";
		panel.append(this.timerElement, this.hintElement, this.questionElement, this.answersElement);

		this.root.appendChild(panel);
		parent.appendChild(this.root);
		window.addEventListener("keydown", this.handleKeyDown);
	}

	show(question: LegacyQuestion, durationSec: number, isRescue: boolean): void {
		this.open = true;
		this.locked = true;
		this.remainingSec = durationSec;
		this.totalSec = durationSec;
		this.root.hidden = false;
		this.root.dataset.state = "open";

		this.hintElement.textContent = isRescue === true ? "Em cần thêm thời gian?" : "";
		this.hintElement.hidden = isRescue === false;
		this.questionElement.textContent = question.question;

		this.answersElement.replaceChildren();
		this.buttons = [];

		question.availableAnswers.forEach((answerKey, index) => {
			const text = question.answers[answerKey];

			if (text === undefined) {
				return;
			}

			const button = document.createElement("button");
			button.type = "button";
			button.className = "quiz-modal__answer";
			button.disabled = true;
			button.innerHTML = `<span class="quiz-modal__key">${index + 1}</span><span>${escapeHtml(text)}</span>`;
			button.addEventListener("click", () => {
				if (this.locked === true || this.open === false) {
					return;
				}

				this.callbacks.onAnswer(answerKey);
			});

			this.answersElement.appendChild(button);
			this.buttons.push(button);
		});

		this.renderTimer();

		// Khóa 400ms đầu: người chơi vừa vuốt/bấm gì đó ngay trước khi modal bật
		// sẽ không vô tình chọn luôn đáp án.
		window.setTimeout(() => {
			if (this.open === false) {
				return;
			}

			this.locked = false;

			for (const button of this.buttons) {
				button.disabled = false;
			}
		}, tuning.quiz.modalLockMs);
	}

	update(deltaSec: number): void {
		if (this.open === false) {
			return;
		}

		this.remainingSec = Math.max(this.remainingSec - deltaSec, 0);
		this.renderTimer();
	}

	private renderTimer(): void {
		const seconds = Math.ceil(this.remainingSec);
		this.timerElement.textContent = `${seconds}s`;
		// Chỉ đỏ ở 5s cuối — đỏ suốt thì mất tác dụng cảnh báo và gây căng thẳng.
		this.timerElement.dataset.danger = this.remainingSec <= tuning.quiz.modalDangerSec ? "true" : "false";
		this.timerElement.style.setProperty(
			"--progress",
			String(this.totalSec > 0 ? this.remainingSec / this.totalSec : 0)
		);
	}

	hide(): void {
		this.open = false;
		this.locked = true;
		this.root.hidden = true;
		delete this.root.dataset.state;
	}

	get isOpen(): boolean {
		return this.open;
	}

	dispose(): void {
		window.removeEventListener("keydown", this.handleKeyDown);
		this.root.remove();
	}
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
