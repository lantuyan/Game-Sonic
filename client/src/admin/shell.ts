// P2-7 · trạng thái dùng chung của trang quản trị: thanh thông báo + khoá nút.

import { requireElement } from "@/admin/dom";

export type NoticeKind = "info" | "success" | "error";

export function showNotice(message: string, kind: NoticeKind = "info"): void {
	const notice = requireElement("notice");
	notice.textContent = message;
	notice.className = `notice notice-${kind}`;
}

export function hideNotice(): void {
	const notice = requireElement("notice");
	notice.className = "notice notice-info hidden";
	notice.textContent = "";
}

/**
 * Những nút KHÔNG được `setBusy(false)` bật lại hàng loạt.
 *
 * Vì sao cần cơ chế này: `setBusy` khoá/mở MỌI `<button>` trên trang, và nút "Xác
 * nhận nhập" của P2-6 chỉ được mở khi đang giữ một bản xem trước hợp lệ. Bật lại
 * hàng loạt sau một lần xem trước THẤT BẠI là mở đường ghi cho một kế hoạch không
 * tồn tại — bẫy đã ghi nguyên văn trong bản legacy, giữ nguyên ở đây.
 */
const resyncHandlers: Array<() => void> = [];

export function registerBusyResync(handler: () => void): void {
	resyncHandlers.push(handler);
}

export function setBusy(disabled: boolean): void {
	for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("button"))) {
		button.disabled = disabled;
	}

	if (disabled !== true) {
		for (const handler of resyncHandlers) {
			handler();
		}
	}
}

/** Báo lỗi từ một promise vào thanh thông báo, không để nó rơi ra console im lặng. */
export function reportError(error: unknown): void {
	showNotice(error instanceof Error ? error.message : "Có lỗi xảy ra.", "error");
}
