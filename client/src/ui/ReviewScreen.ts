// S9 — Xem lại câu sai (plan §5.1, Q9).
//
// Mỗi câu hiển thị: đề · đáp án em chọn ✗ · đáp án đúng ✓ · lời giải (nếu giáo
// viên đã nhập ở admin) · nhãn "sẽ gặp lại ở ván sau" khi câu còn trong hàng đợi ôn.
//
// Đúng/sai LUÔN kèm icon ✓/✗ chứ không chỉ dựa vào màu (plan §5: ~8% nam sinh mù màu).

import type { LegacyQuestion } from "@/integration/questionBank.d";

export interface ReviewItem {
	question: LegacyQuestion;
	selectedAnswer: string | null;
	status: "wrong" | "timeout";
	/** Câu này còn nằm trong hàng đợi ôn → sẽ gặp lại. */
	willRepeat: boolean;
}

export interface ReviewScreenCallbacks {
	onReplay(): void;
	onHome(): void;
}

export class ReviewScreen {
	/** ScreenManager cần truy cập phần tử gốc để ẩn/hiện. */
	readonly element: HTMLElement;
	private readonly listElement: HTMLDivElement;
	private readonly summaryElement: HTMLParagraphElement;

	constructor(parent: HTMLElement, callbacks: ReviewScreenCallbacks) {
		this.element = document.createElement("section");
		this.element.className = "screen screen--review";
		this.element.dataset.screen = "review";
		this.element.hidden = true;

		const title = document.createElement("h1");
		title.className = "screen__title";
		title.textContent = "Xem lại câu sai";

		this.summaryElement = document.createElement("p");
		this.summaryElement.className = "screen__subtitle";

		this.listElement = document.createElement("div");
		this.listElement.className = "review__list";

		const replayButton = document.createElement("button");
		replayButton.type = "button";
		replayButton.className = "button button--cta";
		replayButton.textContent = "CHƠI LẠI";
		replayButton.addEventListener("click", () => {
			callbacks.onReplay();
		});

		const homeButton = document.createElement("button");
		homeButton.type = "button";
		homeButton.className = "button";
		homeButton.textContent = "Về trang chính";
		homeButton.addEventListener("click", () => {
			callbacks.onHome();
		});

		const actions = document.createElement("div");
		actions.className = "screen__actions";
		actions.append(replayButton, homeButton);

		const panel = document.createElement("div");
		panel.className = "screen__panel";
		panel.append(title, this.summaryElement, this.listElement, actions);

		this.element.appendChild(panel);
		parent.appendChild(this.element);
	}

	show(items: readonly ReviewItem[]): void {
		this.element.hidden = false;
		this.listElement.replaceChildren();

		if (items.length === 0) {
			this.summaryElement.textContent = "Tuyệt vời! Em không sai câu nào trong ván này.";
			return;
		}

		this.summaryElement.textContent = `Em sai ${items.length} câu. Xem lại một chút nhé!`;

		for (const item of items) {
			this.listElement.appendChild(this.renderItem(item));
		}
	}

	private renderItem(item: ReviewItem): HTMLElement {
		const card = document.createElement("article");
		card.className = "review__card";

		const questionText = document.createElement("p");
		questionText.className = "review__question";
		questionText.textContent = item.question.question;
		card.appendChild(questionText);

		const chosen = document.createElement("p");
		chosen.className = "review__answer review__answer--wrong";

		if (item.status === "timeout" || item.selectedAnswer === null) {
			chosen.textContent = "✗ Em chưa kịp trả lời";
		} else {
			const chosenText = item.question.answers[item.selectedAnswer] ?? item.selectedAnswer;
			chosen.textContent = `✗ Em chọn: ${chosenText}`;
		}

		card.appendChild(chosen);

		const correct = document.createElement("p");
		correct.className = "review__answer review__answer--correct";
		const correctText = item.question.answers[item.question.correctAnswer] ?? item.question.correctAnswer;
		correct.textContent = `✓ Đáp án đúng: ${correctText}`;
		card.appendChild(correct);

		// Lời giải là tùy chọn — chỉ hiện khi giáo viên đã nhập (P0-14).
		if (typeof item.question.explanation === "string" && item.question.explanation.trim() !== "") {
			const explanation = document.createElement("p");
			explanation.className = "explanation";
			explanation.textContent = item.question.explanation;
			card.appendChild(explanation);
		}

		if (item.willRepeat === true) {
			const badge = document.createElement("span");
			badge.className = "review__badge";
			badge.textContent = "Sẽ gặp lại ở ván sau";
			card.appendChild(badge);
		}

		return card;
	}

	hide(): void {
		this.element.hidden = true;
	}

	get isVisible(): boolean {
		return this.element.hidden === false;
	}

	dispose(): void {
		this.element.remove();
	}
}
