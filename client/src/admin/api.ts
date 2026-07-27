// P2-7 · lớp gọi API của trang quản trị.
//
// Gọi THẲNG route admin, KHÔNG thêm hàm vào `questionBank.js` — cùng lý do đã ghi
// từ P1-4: `questionBank.js` là hợp đồng tích hợp của GAME, không phải nơi chứa
// công cụ quản trị (quy tắc vàng #2 và #4).
//
// `credentials: "same-origin"` ở mọi lời gọi: phiên admin là cookie `admin_token`
// (httpOnly, SameSite=lax) — thiếu dòng đó là mọi route trả 401 mà không ai hiểu vì sao.

export class ApiError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = "ApiError";
		this.status = status;
	}
}

interface ErrorPayload {
	error?: unknown;
}

function readErrorMessage(payload: unknown, status: number): string {
	const message = (payload as ErrorPayload | null)?.error;

	return typeof message === "string" && message !== ""
		? message
		: `Yêu cầu thất bại (HTTP ${String(status)}).`;
}

/**
 * Một lời gọi JSON. Thân rỗng là hợp lệ (một số route trả 204-kiểu), thân không
 * phải JSON thì báo đúng câu đó thay vì ném `SyntaxError` khó hiểu.
 */
export async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
	const response = await fetch(url, { credentials: "same-origin", ...options });
	const responseText = await response.text();
	let payload: unknown = {};

	if (responseText.trim() !== "") {
		try {
			payload = JSON.parse(responseText);
		} catch {
			throw new ApiError("Server trả về dữ liệu không hợp lệ.", response.status);
		}
	}

	if (response.ok !== true) {
		throw new ApiError(readErrorMessage(payload, response.status), response.status);
	}

	return payload as T;
}

/** Lời gọi JSON có thân — mặc định `Content-Type: application/json`. */
export function adminFetch<T>(url: string, options?: RequestInit): Promise<T> {
	return requestJson<T>(url, {
		headers: { "Content-Type": "application/json" },
		...options
	});
}

export function postJson<T>(url: string, body: unknown): Promise<T> {
	return adminFetch<T>(url, { method: "POST", body: JSON.stringify(body) });
}

export function deleteJson<T>(url: string): Promise<T> {
	return adminFetch<T>(url, { method: "DELETE" });
}

/**
 * Gửi CSV thô cho route nhập ngân hàng câu hỏi (P2-6).
 *
 * `text/csv` (không phải `text/plain`) là CỐ Ý: nó buộc trình duyệt preflight, nên
 * form của trang khác không POST lén vào đây được. Đừng "đơn giản hoá" thành
 * `text/plain` — đó là một trong hai lớp chắn CSRF của route này.
 */
export function postCsv<T>(url: string, csvText: string): Promise<T> {
	return requestJson<T>(url, {
		method: "POST",
		headers: { "Content-Type": "text/csv" },
		body: csvText
	});
}

/**
 * Tải file bằng điều hướng thẳng, để trình duyệt xử lý `Content-Disposition`.
 * Cookie admin đi kèm vì cùng origin — không cần (và không nên) tự đọc blob rồi
 * tạo `objectURL`: làm vậy là mất luôn tên file server đặt.
 */
export function downloadViaNavigation(url: string): void {
	window.location.href = url;
}
