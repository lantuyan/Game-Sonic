// Rung nhẹ (P1-8).
//
// `navigator.vibrate` là API CHỈ CÓ TRÊN ANDROID — iOS Safari không hỗ trợ và
// không có cách nào thay thế từ web. Vì vậy ở đây không "giả lập" gì cả: máy nào
// không có thì im lặng bỏ qua, và màn Cài đặt cũng ẩn luôn công tắc để người dùng
// iPhone không phải nhìn một tuỳ chọn không bao giờ có tác dụng.
//
// Rung RẤT NGẮN (20–35ms): đủ để cảm nhận là "vừa va vào cái gì", không đủ để
// thành khó chịu khi va chạm liên tiếp.

import { tuning } from "@/tuning";
import { loadSettings, saveSettings } from "@/core/SaveData";

/** Thiết bị này có rung được không (feature-detect, không đoán theo user-agent). */
export function isVibrationSupported(): boolean {
	return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

export function isVibrationEnabled(): boolean {
	return isVibrationSupported() === true && loadSettings().vibration === true;
}

export function setVibrationEnabled(enabled: boolean): void {
	saveSettings({ ...loadSettings(), vibration: enabled });
}

function vibrate(durationMs: number): void {
	if (isVibrationEnabled() === false) {
		return;
	}

	try {
		navigator.vibrate(durationMs);
	} catch {
		// Một số trình duyệt ném khi gọi ngoài cử chỉ người dùng — không có gì để báo.
	}
}

/** Va chạm chướng ngại — cú rung mạnh hơn trong hai loại. */
export function vibrateHit(): void {
	vibrate(tuning.missions.vibrateHitMs);
}

/** Trả lời sai — rung nhẹ hơn: đây là báo hiệu, không phải hình phạt. */
export function vibrateWrong(): void {
	vibrate(tuning.missions.vibrateWrongMs);
}
