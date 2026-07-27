// P2-5 · LỚP HỌC — phía học sinh.
//
// Ba route, gọi rất thưa (nhập mã một lần, xem lại khi mở màn Cài đặt). Không có
// gì trong ván chơi phụ thuộc vào lớp học: mất mạng, server chưa nối CSDL, hay em
// chưa vào lớp nào thì game vẫn chạy y hệt. Đó là ràng buộc thiết kế, không phải
// hệ quả tình cờ — lớp học là công cụ cho GIÁO VIÊN, không phải điều kiện để chơi.
//
// `deviceId` lấy qua `questionBridge` (tầng duy nhất chạm 5 khoá `-v1` — quy tắc
// vàng #3), không đọc thẳng localStorage.

import { getDeviceId } from "@/integration/questionBridge";
import { loadSettings, saveSettings } from "@/core/SaveData";
import { normalizeClassCodeInput } from "@/systems/classCode";

export interface ClassInfo {
	id: number;
	label: string;
	level: string | null;
	status: "active" | "expired" | "revoked";
}

export interface ClassJoinResult {
	ok: boolean;
	reason?: string;
	class?: ClassInfo;
}

function toClassInfo(value: unknown): ClassInfo | null {
	if (value === null || typeof value !== "object") {
		return null;
	}

	const data = value as Partial<ClassInfo>;

	if (typeof data.label !== "string" || typeof data.id !== "number") {
		return null;
	}

	return {
		id: data.id,
		label: data.label,
		level: typeof data.level === "string" ? data.level : null,
		status: data.status === "expired" || data.status === "revoked" ? data.status : "active"
	};
}

/**
 * Tên lớp lưu trong `endlessrunner-settings-v2` chỉ là BỘ ĐỆM HIỂN THỊ.
 *
 * Sự thật nằm ở server (bảng `class_members`). Cố ý không thêm khoá localStorage
 * mới: một khoá ít hơn là một chỗ ít hỏng hơn (tiền lệ P1-5/P2-2), và nếu bộ đệm
 * này sai thì hậu quả lớn nhất là màn Cài đặt hiện tên lớp cũ cho tới lần mở sau.
 */
function cacheClassLabel(label: string): void {
	const settings = loadSettings();
	saveSettings({ ...settings, classLabel: label });
}

export function getCachedClassLabel(): string {
	return loadSettings().classLabel;
}

/** Nhập mã lớp. Mọi thất bại đều trả `reason` để phía UI dịch sang tiếng Việt. */
export async function joinClass(code: string): Promise<ClassJoinResult> {
	const deviceId = await getDeviceId();
	const normalized = normalizeClassCodeInput(code);

	if (deviceId === null) {
		return { ok: false, reason: "network" };
	}

	if (normalized.length !== 8) {
		return { ok: false, reason: "invalid" };
	}

	try {
		const response = await fetch("/api/classes/join", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "same-origin",
			body: JSON.stringify({ deviceId, code: normalized })
		});

		if (response.ok !== true) {
			return { ok: false, reason: "network" };
		}

		const payload = (await response.json()) as { ok?: boolean; reason?: string; disabled?: boolean; class?: unknown };

		if (payload.disabled === true) {
			return { ok: false, reason: "disabled" };
		}

		const info = toClassInfo(payload.class);

		if (payload.ok !== true || info === null) {
			return { ok: false, reason: typeof payload.reason === "string" ? payload.reason : "network" };
		}

		cacheClassLabel(info.label);
		return { ok: true, class: info };
	} catch {
		return { ok: false, reason: "network" };
	}
}

/** Lớp hiện tại của máy này. null = chưa vào lớp nào (hoặc chưa gọi được server). */
export async function fetchCurrentClass(): Promise<ClassInfo | null> {
	const deviceId = await getDeviceId();

	if (deviceId === null) {
		return null;
	}

	try {
		const response = await fetch(`/api/players/${encodeURIComponent(deviceId)}/class`, {
			credentials: "same-origin"
		});

		if (response.ok !== true) {
			return null;
		}

		const payload = (await response.json()) as { class?: unknown };
		const info = toClassInfo(payload.class);

		// Bộ đệm chỉ ghi khi server trả lời rõ ràng. Mất mạng thì GIỮ tên cũ thay vì
		// xoá: hiện "chưa vào lớp" cho một em đang ở trong lớp là nói sai.
		cacheClassLabel(info === null ? "" : info.label);
		return info;
	} catch {
		return null;
	}
}

/**
 * Tự rời lớp.
 *
 * Có mặt vì đây là hệ thống dùng bởi trẻ em: em nào không muốn dữ liệu học tập của
 * mình gắn với lớp phải tự gỡ được, không phải xin phép ai. Rời lớp chỉ dừng gắn
 * dữ liệu từ nay về sau (docs/v2/P2-5-PRIVACY.md §6).
 */
export async function leaveClass(): Promise<boolean> {
	const deviceId = await getDeviceId();

	if (deviceId === null) {
		return false;
	}

	try {
		const response = await fetch(`/api/players/${encodeURIComponent(deviceId)}/class`, {
			method: "DELETE",
			credentials: "same-origin"
		});

		if (response.ok !== true) {
			return false;
		}

		cacheClassLabel("");
		return true;
	} catch {
		return false;
	}
}
