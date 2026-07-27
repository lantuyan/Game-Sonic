// Nguồn sự thật DUY NHẤT cho mọi khóa localStorage (quy tắc vàng — tasks-version2.md P0-1).
//
// QUAN TRỌNG — file này được test/contract.test.js nạp TRỰC TIẾP dưới Node
// (import qua data: URL, không qua trình biên dịch TS). Vì vậy:
//   - CHỈ dùng cú pháp JavaScript thuần (không type annotation, không `as const`,
//     không import) — TypeScript vẫn suy ra kiểu hẹp nhờ Object.freeze.
//   - Đổi tên/di chuyển file phải sửa contract-test đi kèm.
//
// Luật hợp đồng (plan §7.3):
//   - 5 khóa V1 dưới đây là BẤT BIẾN — không thêm, không bớt, không đổi tên.
//   - Mọi khóa MỚI của V2 bắt buộc kết thúc bằng hậu tố "-v2".

export const V1_STORAGE_KEYS = Object.freeze({
	questionProgress: "endlessrunner-question-progress-v1",
	deviceId: "endlessrunner-device-id-v1",
	nickname: "endlessrunner-nickname-v1",
	skillProfile: "endlessrunner-skill-profile-v1",
	character: "endlessrunner-character-v1"
});

export const V2_STORAGE_KEYS = Object.freeze({
	settings: "endlessrunner-settings-v2",
	ftue: "endlessrunner-ftue-v2",
	wallet: "endlessrunner-wallet-v2",
	reviewQueue: "endlessrunner-review-queue-v2",
	// P1-3: nhân vật đã mở khoá + tiến trình chấm mốc thành tích.
	unlocks: "endlessrunner-unlocks-v2",
	// P1-8: nhiệm vụ ngày + huy hiệu + chuỗi ngày chăm chỉ.
	missions: "endlessrunner-missions-v2",
	// P2-3: hộp thư đi của sổ cái xu — bút toán chờ đẩy lên server.
	// Khoá RIÊNG, không nhét chung `wallet-v2`: hàng đợi này bị ghi rất thường
	// xuyên, còn ví thì phải càng ít bị chạm càng tốt. Trộn chung nghĩa là mỗi lần
	// đẩy hàng đợi là một cơ hội ghi hỏng đúng vào chỗ giữ số xu của người chơi.
	coinOutbox: "endlessrunner-coin-outbox-v2"
});
