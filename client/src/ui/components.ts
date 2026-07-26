// Component UI dùng chung. Tự viết bằng DOM thuần (Q13 — không framework).
//
// Mọi nút đi qua `createButton` để không chỗ nào lỡ tay tạo nút dưới 48px
// hoặc thiếu focus ring (chuẩn a11y plan §5.1).

export interface ButtonOptions {
	label: string;
	variant?: "primary" | "cta";
	onClick: () => void;
	ariaLabel?: string;
}

export function createButton(options: ButtonOptions): HTMLButtonElement {
	const button = document.createElement("button");
	button.type = "button";
	button.className = options.variant === "cta" ? "button button--cta" : "button";
	button.textContent = options.label;

	if (options.ariaLabel !== undefined) {
		button.setAttribute("aria-label", options.ariaLabel);
	}

	button.addEventListener("click", options.onClick);
	return button;
}

export function createPanel(titleText: string, subtitleText?: string): {
	section: HTMLElement;
	panel: HTMLDivElement;
	body: HTMLDivElement;
	actions: HTMLDivElement;
} {
	const section = document.createElement("section");
	section.className = "screen";

	const panel = document.createElement("div");
	panel.className = "screen__panel";

	const title = document.createElement("h1");
	title.className = "screen__title";
	title.textContent = titleText;
	panel.appendChild(title);

	if (subtitleText !== undefined) {
		const subtitle = document.createElement("p");
		subtitle.className = "screen__subtitle";
		subtitle.textContent = subtitleText;
		panel.appendChild(subtitle);
	}

	const body = document.createElement("div");
	body.className = "screen__body";
	panel.appendChild(body);

	const actions = document.createElement("div");
	actions.className = "screen__actions";
	panel.appendChild(actions);

	section.appendChild(panel);
	return { section, panel, body, actions };
}

/**
 * Số đếm lên (S8). Dùng WAAPI-free rAF đơn giản; tôn trọng `prefers-reduced-motion`
 * bằng cách nhảy thẳng tới giá trị cuối.
 */
export function countUp(element: HTMLElement, target: number, durationMs = 900): void {
	const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

	if (reduceMotion === true || durationMs <= 0) {
		element.textContent = String(target);
		return;
	}

	const startMs = performance.now();

	function frame(nowMs: number): void {
		const progress = Math.min((nowMs - startMs) / durationMs, 1);
		// easeOutCubic để số chạy nhanh lúc đầu rồi "hạ cánh" mềm.
		const eased = 1 - (1 - progress) ** 3;
		element.textContent = String(Math.round(target * eased));

		if (progress < 1) {
			requestAnimationFrame(frame);
		}
	}

	requestAnimationFrame(frame);
}

export function createProgressBar(): { element: HTMLDivElement; set: (ratio: number) => void } {
	const element = document.createElement("div");
	element.className = "progress";
	element.setAttribute("role", "progressbar");
	element.setAttribute("aria-valuemin", "0");
	element.setAttribute("aria-valuemax", "100");

	const fill = document.createElement("div");
	fill.className = "progress__fill";
	element.appendChild(fill);

	return {
		element,
		set(ratio: number): void {
			const clamped = Math.min(Math.max(ratio, 0), 1);
			fill.style.width = `${clamped * 100}%`;
			element.setAttribute("aria-valuenow", String(Math.round(clamped * 100)));
		}
	};
}

/** Xác nhận 2 bước cho hành động phá tiến trình (plan §5.1). */
export function confirmTwoStep(button: HTMLButtonElement, confirmLabel: string, onConfirm: () => void): void {
	const originalLabel = button.textContent ?? "";
	let armed = false;
	let resetTimer = 0;

	button.addEventListener("click", () => {
		if (armed === true) {
			window.clearTimeout(resetTimer);
			armed = false;
			button.textContent = originalLabel;
			onConfirm();
			return;
		}

		armed = true;
		button.textContent = confirmLabel;
		// Tự huỷ trạng thái "chờ xác nhận" sau 4s để không bấm nhầm về sau.
		resetTimer = window.setTimeout(() => {
			armed = false;
			button.textContent = originalLabel;
		}, 4000);
	});
}
