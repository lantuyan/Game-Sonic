// Bộ đệm điểm của vệt chạy (P2-2) — THUẦN SỐ HỌC, không three, không DOM.
//
// Đây là đường NÓNG NHẤT của cả gói P2-2: chạy mỗi frame, mỗi frame ghi thêm một
// điểm. Vì vậy toàn bộ bộ nhớ được cấp phát MỘT LẦN trong constructor
// (`Float32Array` sức chứa cố định) và mọi thao tác sau đó chỉ ghi vào chỗ có sẵn
// — không `new`, không `push`, không closure (quy tắc vàng #6).
//
// Hai quyết định đáng nêu:
//
// 1. **Toạ độ z suy ra từ ODOMETER, không cộng dồn vào từng điểm.** Player đứng
//    yên ở z cố định còn thế giới chạy về +z, nên mỗi frame mọi điểm cũ phải lùi
//    ra sau. Cách ngây thơ là cộng `advance` vào z của từng điểm — O(n) mỗi frame
//    và sai số cộng dồn theo từng bước. Ở đây mỗi điểm chỉ nhớ số đo odometer lúc
//    sinh ra, còn z = odometer_hiện_tại − odometer_lúc_sinh. O(1), và độ lệch của
//    một điểm chỉ phụ thuộc HAI con số nên không trôi.
//
// 2. **Điểm sinh theo QUÃNG ĐƯỜNG, không theo thời gian** — cùng lý do với quỹ đạo
//    chướng ngại di động ở P2-1: chạy 0.5× hay 2.0× thì vệt phải dài như nhau và
//    mượt như nhau, chứ không phải rời rạc ở tốc độ cao.

export class TrailPath {
	readonly capacity: number;

	private readonly xs: Float32Array;
	private readonly ys: Float32Array;
	/** Odometer lúc điểm được sinh ra. */
	private readonly odos: Float64Array;

	/** Ô sẽ ghi tiếp theo. */
	private writeIndex = 0;
	private count = 0;
	private odometer = 0;
	private distanceSinceEmit = 0;

	constructor(capacity: number) {
		this.capacity = Math.max(Math.floor(capacity), 2);
		this.xs = new Float32Array(this.capacity);
		this.ys = new Float32Array(this.capacity);
		this.odos = new Float64Array(this.capacity);
	}

	get length(): number {
		return this.count;
	}

	reset(): void {
		this.writeIndex = 0;
		this.count = 0;
		this.odometer = 0;
		this.distanceSinceEmit = 0;
	}

	/**
	 * Một frame: thế giới vừa chạy thêm `advanceUnits`, player đang ở (x, y).
	 *
	 * @param spacingUnits khoảng cách giữa 2 điểm liên tiếp;
	 * @param maxLengthUnits vệt dài tối đa — điểm lùi quá xa thì bỏ.
	 */
	update(advanceUnits: number, x: number, y: number, spacingUnits: number, maxLengthUnits: number): void {
		this.odometer += Math.max(advanceUnits, 0);
		this.distanceSinceEmit += Math.max(advanceUnits, 0);

		const spacing = Math.max(spacingUnits, 0.01);

		// Vệt luôn phải có một điểm dính vào chân nhân vật, nếu không lúc đứng yên
		// (thế giới đóng băng vì boss) đuôi sẽ lơ lửng cách người chơi một khúc.
		if (this.count === 0 || this.distanceSinceEmit >= spacing) {
			this.emit(x, y);
			this.distanceSinceEmit = 0;
		} else {
			this.moveHead(x, y);
		}

		this.trim(maxLengthUnits);
	}

	/** Ghi một điểm mới. Đầy thì ghi đè điểm cũ nhất — đó chính là cái ta muốn bỏ. */
	private emit(x: number, y: number): void {
		this.xs[this.writeIndex] = x;
		this.ys[this.writeIndex] = y;
		this.odos[this.writeIndex] = this.odometer;
		this.writeIndex = (this.writeIndex + 1) % this.capacity;

		if (this.count < this.capacity) {
			this.count += 1;
		}
	}

	/**
	 * Kéo điểm MỚI NHẤT theo chân player giữa hai lần sinh điểm.
	 * Nhờ vậy lúc đổi làn vệt bám sát người chứ không giật từng nấc `spacingUnits`.
	 */
	private moveHead(x: number, y: number): void {
		const index = (this.writeIndex - 1 + this.capacity) % this.capacity;
		this.xs[index] = x;
		this.ys[index] = y;
		this.odos[index] = this.odometer;
	}

	/** Bỏ các điểm đã lùi quá `maxLengthUnits` phía sau. */
	private trim(maxLengthUnits: number): void {
		const limit = Math.max(maxLengthUnits, 0.01);

		while (this.count > 1) {
			const oldest = (this.writeIndex - this.count + this.capacity * 2) % this.capacity;

			if (this.odometer - (this.odos[oldest] ?? 0) <= limit) {
				return;
			}

			this.count -= 1;
		}
	}

	/**
	 * Điểm thứ `index` tính từ MỚI NHẤT (0 = ngay dưới chân player).
	 * Trả 0 khi `index` ngoài dải — gọi sai không được ném ra giữa game loop.
	 */
	pointX(index: number): number {
		return this.xs[this.slot(index)] ?? 0;
	}

	pointY(index: number): number {
		return this.ys[this.slot(index)] ?? 0;
	}

	/** Khoảng cách phía sau player, luôn ≥ 0 và tăng dần theo `index`. */
	pointZ(index: number): number {
		return this.odometer - (this.odos[this.slot(index)] ?? this.odometer);
	}

	private slot(index: number): number {
		if (index < 0 || index >= this.count) {
			return -1;
		}

		return (this.writeIndex - 1 - index + this.capacity * 2) % this.capacity;
	}
}
