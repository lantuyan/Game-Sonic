// Hợp thành tốc độ thế giới — P2-2. THUẦN SỐ HỌC, không three, không DOM.
//
// Vì sao tách hẳn ra một file cho một phép nhân: vì đây là chỗ hai cái phanh khác
// nhau gặp nhau, và "hai thứ cùng ghi một biến" chính là công thức cho lỗi âm thầm.
//
//   · `brakeFactor`     — phanh của Boss Gate (P1-1) và câu hồi sinh (P1-5).
//                         Nó ĐẶT giá trị tuyệt đối (0 khi đóng băng, 1 khi chạy),
//                         và là chủ sở hữu DUY NHẤT của biến `worldSpeedFactor`.
//   · `slowClockFactor` — Đồng hồ chậm (P2-2). Là một hệ số NHÂN riêng, KHÔNG BAO
//                         GIỜ được ghi vào `worldSpeedFactor` — nếu ghi vào thì
//                         frame sau boss sẽ lerp đè lên và hiệu ứng biến mất, hoặc
//                         tệ hơn: hết đồng hồ chậm mà đặt lại 1 giữa lúc boss đang
//                         đóng băng, thế giới lao đi trong lúc modal còn mở.
//
// ⚠ TUYỆT ĐỐI KHÔNG dùng `engine.timeScale = 0` (hay số rất nhỏ) để làm chậm thế
// giới: Engine nạp accumulator bằng `delta × timeScale`, nên timeScale 0 làm
// `update()` không bao giờ chạy lại — treo vĩnh viễn, kể cả đồng hồ tự gỡ phanh.

export interface WorldSpeedInputs {
	/** Hệ số tốc độ nền của ván (SpeedController: gameSpeed × adaptive × ramp). */
	speedFactor: number;
	/** unit/giây ứng với hệ số 1.0 (`tuning.speed.unitsPerSecondAtOne`). */
	unitsPerSecondAtOne: number;
	/** Phanh Boss Gate / hồi sinh: 0 = đóng băng, 1 = chạy bình thường. */
	brakeFactor: number;
	/** Chế độ Luyện tập chạy chậm hơn (plan §4.6). */
	practiceFactor: number;
	/** Power-up Tăng tốc (P1-5). */
	boostFactor: number;
	/** Power-up Đồng hồ chậm (P2-2): <1 khi đang bật. */
	slowClockFactor: number;
}

/**
 * Tốc độ thế giới cuối cùng (unit/giây).
 *
 * Phép nhân, không phải phép chọn nhỏ nhất: mỗi hệ số trả lời một câu hỏi khác
 * nhau ("ván này nhanh cỡ nào", "có đang đóng băng không", "có đang được ưu ái
 * không"), nên chúng phải cộng tác được chứ không được che nhau. Hệ quả cần thiết:
 * phanh 0 thắng tất cả, kể cả lúc vừa có Tăng tốc.
 */
export function worldSpeedUnitsPerSec(inputs: WorldSpeedInputs): number {
	return (
		inputs.speedFactor *
		inputs.unitsPerSecondAtOne *
		inputs.brakeFactor *
		inputs.practiceFactor *
		inputs.boostFactor *
		inputs.slowClockFactor
	);
}

/**
 * Thế giới có đang thật sự chạy không (dùng để tạm dừng đồng hồ của Đồng hồ chậm).
 *
 * Ngưỡng chứ không phải `> 0`: phanh boss trôi mềm về 0 nên có vài frame nó là
 * 0.003 — về mặt hình ảnh là đứng im, và đồng hồ vẫn chạy tiếp thì món quà 6 giây
 * bốc hơi trong lúc người chơi đang đọc đề của trùm.
 */
export const WORLD_RUNNING_BRAKE_THRESHOLD = 0.05;

export function isWorldRunning(brakeFactor: number): boolean {
	return brakeFactor > WORLD_RUNNING_BRAKE_THRESHOLD;
}
