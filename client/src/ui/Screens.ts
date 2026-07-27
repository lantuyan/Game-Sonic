// Máy trạng thái màn hình (plan §5.1) — điều khiển bằng `data-screen` trên #ui-root.
//
// Chỉ MỘT màn hiển thị tại một thời điểm; mỗi màn tự dựng DOM một lần rồi ẩn/hiện.
// Không framework (Q13): chuyển màn bằng CSS + Web Animations API.

export type ScreenName =
	| "splash"
	| "home"
	| "level"
	| "character"
	| "hud"
	| "pause"
	| "gameover"
	| "review"
	| "leaderboard"
	| "settings"
	| "tutorial"
	/** S12 — Cửa hàng mở khoá nhân vật (P1-3). */
	| "shop";

export interface Screen {
	readonly name: ScreenName;
	readonly element: HTMLElement;
	onShow?(params?: Record<string, unknown>): void;
	onHide?(): void;
}

export class ScreenManager {
	private readonly root: HTMLElement;
	private readonly screens = new Map<ScreenName, Screen>();
	private currentName: ScreenName | null = null;
	private readonly history: ScreenName[] = [];

	constructor(root: HTMLElement) {
		this.root = root;
	}

	register(screen: Screen): void {
		this.screens.set(screen.name, screen);
		screen.element.hidden = true;
	}

	show(name: ScreenName, params?: Record<string, unknown>): void {
		const next = this.screens.get(name);

		if (next === undefined) {
			console.warn(`[Screens] chưa đăng ký màn "${name}"`);
			return;
		}

		if (this.currentName === name) {
			next.onShow?.(params);
			return;
		}

		if (this.currentName !== null) {
			const current = this.screens.get(this.currentName);
			current?.onHide?.();

			if (current !== undefined) {
				current.element.hidden = true;
			}

			this.history.push(this.currentName);
		}

		next.element.hidden = false;
		next.onShow?.(params);
		this.currentName = name;
		// `data-screen` để CSS/QA biết đang ở màn nào mà không cần đọc JS.
		this.root.dataset.screen = name;
	}

	/** Quay lại màn trước. Mọi màn con phải có đường lùi (chuẩn UX plan §5.1). */
	back(): void {
		const previous = this.history.pop();

		if (previous === undefined) {
			return;
		}

		// pop 2 lần vì show() vừa đẩy màn hiện tại vào history.
		this.show(previous);
		this.history.pop();
	}

	get current(): ScreenName | null {
		return this.currentName;
	}

	hideAll(): void {
		for (const screen of this.screens.values()) {
			screen.element.hidden = true;
		}

		this.currentName = null;
		delete this.root.dataset.screen;
	}
}
