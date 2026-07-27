// P2-5 · MÃ LỚP HỌC — phần thuần, không đụng mạng và không đụng DOM.
//
// Server (`server/classCode.js`) mới là trọng tài: nó giữ bảng chữ, sinh mã và
// quyết định mã nào vào được lớp nào. File này chỉ làm hai việc cho phía học sinh:
//
//   1. **Chuẩn hoá tại chỗ** để ô nhập không bắt các em gõ đúng từng dấu gạch —
//      "abcd-2345", "ABCD 2345", "abcd2345" phải là cùng một mã.
//   2. **Dịch lý do bị từ chối sang tiếng Việt của trẻ con.** Server trả về
//      `expired`/`revoked`/`not-found`; đứa trẻ cần đọc được "Mã này hết hạn rồi,
//      em hỏi lại thầy cô nhé".
//
// Cố ý KHÔNG chép luật "mã có hợp lệ không" xuống đây thành một bản thứ hai: nếu
// bảng chữ hai bên trôi khỏi nhau thì client sẽ chặn oan đúng những mã server nhận.
// Ở đây chỉ kiểm ĐỘ DÀI để bật/tắt nút — mọi phán quyết thật đều do server nói.

/** Độ dài mã sau khi bỏ gạch/dấu cách. Phải khớp `server/classCode.js`. */
export const CLASS_CODE_LENGTH = 8;

/** Bỏ mọi thứ không phải chữ/số rồi viết hoa — đúng dạng server mong đợi. */
export function normalizeClassCodeInput(value: string): string {
	return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CLASS_CODE_LENGTH);
}

/** Dạng hiển thị `ABCD-2345`. Dùng cho ô nhập lẫn chỗ hiện lại mã. */
export function formatClassCodeInput(value: string): string {
	const normalized = normalizeClassCodeInput(value);

	if (normalized.length <= 4) {
		return normalized;
	}

	return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

/** Đủ ký tự để bấm "Vào lớp" chưa. Không phán quyết mã đúng hay sai. */
export function isCompleteClassCode(value: string): boolean {
	return normalizeClassCodeInput(value).length === CLASS_CODE_LENGTH;
}

export type ClassJoinReason = "invalid" | "not-found" | "expired" | "revoked" | "disabled" | "network";

/**
 * Câu trả lời cho học sinh. Viết cho trẻ con đọc: nói cái gì xảy ra và làm gì tiếp,
 * không có mã lỗi, không đổ lỗi cho em.
 */
export function describeJoinFailure(reason: string): string {
	switch (reason) {
		case "invalid":
			return "Mã lớp gồm 8 ký tự, em kiểm tra lại giúp nhé.";
		case "not-found":
			return "Không tìm thấy mã lớp này. Em xem lại mã thầy cô cho nhé.";
		case "expired":
			return "Mã lớp này hết hạn rồi. Em hỏi thầy cô mã mới nhé.";
		case "revoked":
			return "Mã lớp này đã ngừng dùng. Em hỏi thầy cô mã mới nhé.";
		case "disabled":
			return "Máy chủ chưa bật tính năng lớp học. Em cứ chơi bình thường nhé.";
		default:
			return "Chưa gửi được lúc này. Em kiểm tra mạng rồi thử lại nhé.";
	}
}
