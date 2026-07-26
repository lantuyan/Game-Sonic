// Luật CÔNG BẰNG cho pattern chướng ngại (plan §4.2).
//
// Đây là nơi bảo đảm "chết là do tay, không do xúi quẩy". Validator chạy trong
// unit test cho MỌI pattern ở MỌI tốc độ trong dải 0.5–2.0, nên pattern chết chắc
// không bao giờ lọt tới người chơi.
//
// Thuần số học, không import three.

import { tuning } from "@/tuning";
import { hasEscapeLane, type ObstacleBand, type ObstacleKind } from "@/systems/Collision";

export interface PatternEvent {
	/** 0 = trái, 1 = giữa, 2 = phải. */
	lane: number;
	type: ObstacleKind;
	/** Khoảng cách dọc tính từ đầu pattern (unit, càng lớn càng xa về phía trước). */
	offset: number;
}

export interface Pattern {
	id: string;
	/** 1 = dễ … 3 = khó. Dùng để rải "thung lũng nghỉ" sau cụm khó. */
	difficulty: number;
	events: PatternEvent[];
}

export interface ValidationIssue {
	patternId: string;
	kind: "no-escape" | "reaction-too-short" | "empty" | "bad-lane" | "overlapping-lane-block";
	detail: string;
}

/** Độ dài chiếm chỗ của một chướng ngại theo trục z. */
export const OBSTACLE_DEPTH = 1.6;

/** Dải tốc độ phải kiểm: từ chậm nhất tới nhanh nhất có thể xảy ra trong game. */
export function speedRangeUnitsPerSec(): number[] {
	const speeds: number[] = [];

	for (let factor = tuning.speed.baseMin; factor <= tuning.speed.baseMax + 1e-9; factor += 0.1) {
		speeds.push(Number(factor.toFixed(1)) * tuning.speed.unitsPerSecondAtOne);
	}

	return speeds;
}

/** Chuyển pattern thành các dải va chạm để dùng lại đúng logic của Collision. */
export function toBands(pattern: Pattern): ObstacleBand[] {
	return pattern.events.map((event) => ({
		lane: event.lane,
		kind: event.type,
		zStart: event.offset,
		zEnd: event.offset + OBSTACLE_DEPTH,
		consumed: false
	}));
}

/**
 * Kiểm 1 pattern. Trả về danh sách vấn đề (rỗng = đạt).
 *
 * Ba luật:
 *   1. Mọi lát cắt z đều có ít nhất 1 làn đi qua được.
 *   2. Hai cụm liên tiếp cách nhau đủ để phản xạ: khoảng cách ≥ tốc độ × 0.6s.
 *   3. Không chồng 2 loại chướng ngại loại trừ nhau trên cùng làn (low + high thì
 *      không tư thế nào qua nổi — luật 1 đã bắt, nhưng báo riêng cho dễ sửa).
 */
export function validatePattern(pattern: Pattern): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	if (pattern.events.length === 0) {
		issues.push({ patternId: pattern.id, kind: "empty", detail: "pattern không có event nào" });
		return issues;
	}

	for (const event of pattern.events) {
		if (event.lane < 0 || event.lane > 2 || Number.isInteger(event.lane) === false) {
			issues.push({
				patternId: pattern.id,
				kind: "bad-lane",
				detail: `lane ${event.lane} nằm ngoài 0..2`
			});
		}
	}

	const bands = toBands(pattern);

	// Luật 1 + 3: quét mọi mốc z mà tập chướng ngại thay đổi.
	const checkpoints = new Set<number>();

	for (const band of bands) {
		checkpoints.add(band.zStart + 0.01);
		checkpoints.add((band.zStart + band.zEnd) / 2);
		checkpoints.add(band.zEnd - 0.01);
	}

	for (const z of checkpoints) {
		if (hasEscapeLane(bands, z, 3) === false) {
			issues.push({
				patternId: pattern.id,
				kind: "no-escape",
				detail: `tại z=${z.toFixed(2)} cả 3 làn đều không qua được`
			});
		}
	}

	for (let lane = 0; lane < 3; lane += 1) {
		const laneBands = bands.filter((band) => band.lane === lane);

		for (let a = 0; a < laneBands.length; a += 1) {
			for (let b = a + 1; b < laneBands.length; b += 1) {
				const first = laneBands[a];
				const second = laneBands[b];

				if (first === undefined || second === undefined) {
					continue;
				}

				const overlaps = first.zStart < second.zEnd && second.zStart < first.zEnd;
				const mutuallyExclusive =
					(first.kind === "low" && second.kind === "high") || (first.kind === "high" && second.kind === "low");

				if (overlaps === true && mutuallyExclusive === true) {
					issues.push({
						patternId: pattern.id,
						kind: "overlapping-lane-block",
						detail: `làn ${lane}: rào thấp chồng rào cao — không tư thế nào qua được`
					});
				}
			}
		}
	}

	// Luật 2: khoảng phản xạ giữa các mốc offset khác nhau.
	const offsets = [...new Set(pattern.events.map((event) => event.offset))].sort((a, b) => a - b);
	const fastestSpeed = tuning.speed.baseMax * tuning.speed.unitsPerSecondAtOne;
	const minGap = fastestSpeed * tuning.spawn.minReactionSec;

	for (let index = 1; index < offsets.length; index += 1) {
		const previous = offsets[index - 1];
		const current = offsets[index];

		if (previous === undefined || current === undefined) {
			continue;
		}

		const gap = current - previous;

		// Cùng một "hàng" chướng ngại (cách nhau <1 unit) thì không tính là 2 cụm.
		if (gap < 1) {
			continue;
		}

		if (gap < minGap) {
			issues.push({
				patternId: pattern.id,
				kind: "reaction-too-short",
				detail: `khoảng cách ${gap.toFixed(1)} < ${minGap.toFixed(1)} unit cần để phản xạ ở tốc độ tối đa`
			});
		}
	}

	return issues;
}

export function validateAllPatterns(patterns: readonly Pattern[]): ValidationIssue[] {
	return patterns.flatMap((pattern) => validatePattern(pattern));
}

/** Độ dài chiếm chỗ của cả pattern theo trục z. */
export function patternLength(pattern: Pattern): number {
	return Math.max(...pattern.events.map((event) => event.offset)) + OBSTACLE_DEPTH;
}
