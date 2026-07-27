// CHƯỚNG NGẠI DI ĐỘNG (P2-1) — vật trôi ngang qua các làn.
//
// Thuần số học, không import three: `node --test` kiểm trực tiếp được.
//
// ------------------------------------------------------------------------------
// QUYẾT ĐỊNH THIẾT KẾ (đọc trước khi sửa)
//
// Quỹ đạo tham số theo QUÃNG ĐƯỜNG (toạ độ z của chính vật đó), KHÔNG theo đồng hồ.
// Nghe thì lạ, nhưng đây là điều duy nhất giữ được ba tính chất cùng lúc:
//
//   1. **Bằng nhau ở mọi tốc độ.** Cả game đo bằng unit chứ không đo bằng giây
//      (xem `patternRules.speedRangeUnitsPerSec`): admin đặt gameSpeed 0.5 hay 2.0
//      thì hình vẽ trên mặt đường vẫn y hệt. Nếu tham số theo thời gian, cùng một
//      pattern sẽ dễ ở lớp này và bất khả thi ở lớp kia.
//
//   2. **Chứng minh được công bằng.** Vì vật và người chơi trôi cùng vận tốc, hiệu
//      z giữa chúng là hằng số; nên "vật ở làn nào lúc tới chỗ player" chỉ phụ thuộc
//      pha ban đầu, không phụ thuộc người chơi làm gì. Validator vì thế kiểm được
//      pattern có chướng ngại di động hệt như pattern tĩnh — không cần mô phỏng.
//
//   3. **Đọc được bằng mắt.** Người chơi thấy vật trôi ngang suốt quãng đường tới,
//      và thứ phải học là "nó ĐANG ĐI ĐÂU", không phải "nó ĐANG Ở ĐÂU". Người mới
//      né vào chỗ trống hiện tại và ăn đòn; người quen đọc hướng trôi. Đó chính là
//      kỹ năng mới mà P2-1 muốn thêm.
//
// Vì sao KHÔNG làm chuyển động LÊN–XUỐNG (task cho phép chọn một trong ba): vật lên
// xuống thì TƯ THẾ cần dùng đổi giữa đường (lúc thấp phải nhảy, lúc cao phải trượt).
// Người chơi quyết định tư thế trước đó ~0.6s, nên sẽ có những lần chết mà không có
// cách nào tránh — phá thẳng bất biến "chết là do tay" của plan §4.2.

import { tuning } from "@/tuning";

export interface MotionSpec {
	/**
	 * Làn ở đầu kia của dao động. Vật đi đi-về-về giữa làn gốc của event và làn này.
	 * Cho phép số thực (vd 1.5) để có kiểu "đứng giữa hai làn".
	 */
	toLane: number;
	/** Pha ban đầu trong [0,1). 0 = xuất phát ở làn gốc, 0.5 = ở `toLane`. */
	phase: number;
}

/**
 * Sóng tam giác chu kỳ 1, trả về [0,1]. Dùng tam giác chứ không dùng sin vì tốc độ
 * trôi ngang là HẰNG SỐ trên mỗi nửa chu kỳ — người chơi ngoại suy được bằng mắt,
 * trong khi sin thì chậm ở hai đầu và nhanh ở giữa, dễ hụt tay ở đoạn giữa.
 */
export function triangleWave(value: number): number {
	const fraction = value - Math.floor(value);
	return fraction < 0.5 ? fraction * 2 : 2 - fraction * 2;
}

/**
 * Lệch làn (đơn vị = làn) của một chướng ngại di động khi nó đang ở toạ độ `z`.
 *
 * `z` là toạ độ thế giới quen thuộc của dự án: 0 = chỗ player đứng, âm = phía trước.
 * Vì vậy `laneOffsetAt(spec, baseLane, 0)` chính là **làn lúc tới nơi** — con số duy
 * nhất mà luật công bằng quan tâm.
 */
export function laneOffsetAt(spec: MotionSpec, baseLane: number, z: number): number {
	const span = spec.toLane - baseLane;
	const wavelength = Math.max(tuning.spawn.movingWavelengthUnits, 1);

	return span * triangleWave(-z / wavelength + spec.phase);
}

/** Làn (số thực) lúc vật tới chỗ player — hằng số, không phụ thuộc tốc độ ván. */
export function arrivalLane(spec: MotionSpec, baseLane: number): number {
	return baseLane + laneOffsetAt(spec, baseLane, 0);
}

/**
 * Kiểm một khai báo chuyển động. Trả về lý do hỏng, hoặc null nếu hợp lệ.
 * Gọi từ validator pattern nên pattern hỏng bị bắt trong `npm test`, không phải
 * trong ván của học sinh.
 */
export function validateMotion(spec: MotionSpec, baseLane: number): string | null {
	if (Number.isFinite(spec.toLane) === false || spec.toLane < 0 || spec.toLane > 2) {
		return `toLane ${spec.toLane} nằm ngoài 0..2`;
	}

	if (Number.isFinite(spec.phase) === false || spec.phase < 0 || spec.phase >= 1) {
		return `phase ${spec.phase} phải nằm trong [0,1)`;
	}

	if (Math.abs(spec.toLane - baseLane) < 0.5) {
		// Biên độ dưới nửa làn thì mắt không thấy nó "đi" đâu cả — chỉ rung tại chỗ,
		// vừa vô nghĩa vừa gây khó chịu.
		return `biên độ ${Math.abs(spec.toLane - baseLane).toFixed(2)} làn quá nhỏ để đọc ra chuyển động`;
	}

	return null;
}
