// P2-7 · tiện ích DOM cho trang quản trị.
//
// Trang này dựng markup tĩnh trong `client/admin.html` rồi tra theo `id`. Với
// TypeScript strict, `document.getElementById` trả `HTMLElement | null` — nếu mỗi
// chỗ dùng tự `?.` một kiểu thì một `id` gõ sai sẽ biến thành "cái nút đó không
// làm gì cả", đúng loại hồi quy im lặng mà task P2-7 sợ nhất.
//
// Nên ở đây `requireElement` NÉM LỖI. Thiếu một id = trang không mở được và báo
// đúng tên id thiếu, thay vì mở ra rồi lặng lẽ hụt một tính năng.

export function requireElement<T extends HTMLElement>(id: string): T {
	const element = document.getElementById(id);

	if (element === null) {
		throw new Error(`Thiếu phần tử #${id} trong admin.html.`);
	}

	return element as T;
}

export function requireInput(id: string): HTMLInputElement {
	return requireElement<HTMLInputElement>(id);
}

export function requireSelect(id: string): HTMLSelectElement {
	return requireElement<HTMLSelectElement>(id);
}

export function requireTextArea(id: string): HTMLTextAreaElement {
	return requireElement<HTMLTextAreaElement>(id);
}

export function requireButton(id: string): HTMLButtonElement {
	return requireElement<HTMLButtonElement>(id);
}

/**
 * Thoát HTML trước khi ghép chuỗi.
 *
 * Trang quản trị hiển thị nội dung do NGƯỜI KHÁC nhập: đề bài của giáo viên, biệt
 * danh học sinh tự đặt, tên lớp, thông báo lỗi từ server. Mọi giá trị như vậy đi
 * qua đây trước khi vào `innerHTML` — giống hệt bản legacy, giữ nguyên vì đúng.
 */
export function escapeHtml(value: unknown): string {
	return String(value === null || value === undefined ? "" : value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

export function onClick(id: string, handler: () => void): void {
	requireElement(id).addEventListener("click", () => {
		handler();
	});
}

/** Gắn handler cho MỌI nút mang một `data-*` bên trong một container. */
export function bindDataButtons(
	container: HTMLElement,
	attribute: string,
	handler: (value: string, button: HTMLButtonElement) => void
): void {
	for (const button of Array.from(container.querySelectorAll<HTMLButtonElement>(`button[${attribute}]`))) {
		button.addEventListener("click", () => {
			handler(button.getAttribute(attribute) ?? "", button);
		});
	}
}

/** Ngày giờ kiểu Việt Nam. Chuỗi rỗng/không đọc được → trả nguyên văn (hoặc "Chưa có"). */
export function formatTimestamp(value: unknown): string {
	if (typeof value !== "string" || value === "") {
		return "Chưa có";
	}

	const date = new Date(value);

	if (Number.isNaN(date.getTime()) === true) {
		return value;
	}

	return date.toLocaleString("vi-VN");
}

export function formatDate(value: unknown): string {
	if (typeof value !== "string" || value === "") {
		return "—";
	}

	const date = new Date(value);
	return Number.isNaN(date.getTime()) === true ? value : date.toLocaleDateString("vi-VN");
}

/** `123456` → `2'03`. `null` → `—`. */
export function formatDuration(durationMs: unknown): string {
	if (durationMs === null || durationMs === undefined) {
		return "—";
	}

	const totalSeconds = Math.round(Number(durationMs) / 1000);

	if (Number.isFinite(totalSeconds) === false) {
		return "—";
	}

	return `${Math.floor(totalSeconds / 60)}'${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function capitalize(value: string): string {
	return value === "" ? "" : value.charAt(0).toUpperCase() + value.slice(1);
}
