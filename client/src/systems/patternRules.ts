// Luật CÔNG BẰNG cho pattern chướng ngại (plan §4.2).
//
// Đây là nơi bảo đảm "chết là do tay, không do xúi quẩy". Validator chạy trong
// unit test cho MỌI pattern ở MỌI tốc độ trong dải 0.5–2.0, nên pattern chết chắc
// không bao giờ lọt tới người chơi.
//
// Thuần số học, không import three.

import { tuning } from "@/tuning";
import { bandLane, hasEscapeLane, type ObstacleBand, type ObstacleKind } from "@/systems/Collision";
import { arrivalLane, laneOffsetAt, validateMotion, type MotionSpec } from "@/systems/movingObstacles";

export interface PatternEvent {
	/** 0 = trái, 1 = giữa, 2 = phải. */
	lane: number;
	type: ObstacleKind;
	/** Khoảng cách dọc tính từ đầu pattern (unit, càng lớn càng xa về phía trước). */
	offset: number;
	/**
	 * P2-1 — khai báo chuyển động. Vắng mặt = vật đứng yên (mọi pattern P0).
	 * `type` vẫn quyết định luật né; chỉ vị trí NGANG là thay đổi theo thời gian.
	 */
	motion?: MotionSpec;
}

export interface Pattern {
	id: string;
	/**
	 * 1 = dễ … 3 = khó, 4 = "tổ hợp khó" (P2-1 — chỉ mở khi ván đã nóng, xem
	 * `isPatternAllowed`). Từ bậc 3 trở lên còn kéo theo "thung lũng nghỉ" 5–8s.
	 */
	difficulty: number;
	events: PatternEvent[];
}

export interface ValidationIssue {
	patternId: string;
	kind:
		| "no-escape"
		| "reaction-too-short"
		| "empty"
		| "bad-lane"
		| "overlapping-lane-block"
		| "bad-motion"
		| "moving-row-conflict";
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

/**
 * Chuyển pattern thành các dải va chạm để dùng lại đúng logic của Collision.
 *
 * Với chướng ngại di động, `laneOffset` lấy ở **z = 0** — tức làn lúc vật tới chỗ
 * player. Đó là lát cắt duy nhất có ý nghĩa cho luật công bằng: vật và player trôi
 * cùng vận tốc nên hiệu z giữa chúng không đổi, và trong quãng chồng nhau (≈1.6
 * unit) thì với bước sóng 80 unit vị trí ngang chỉ đổi ~0.04 làn — dưới cả sai số
 * hình vẽ.
 */
export function toBands(pattern: Pattern): ObstacleBand[] {
	return pattern.events.map((event) => ({
		lane: event.lane,
		kind: event.type,
		zStart: event.offset,
		zEnd: event.offset + OBSTACLE_DEPTH,
		consumed: false,
		laneOffset: event.motion === undefined ? 0 : laneOffsetAt(event.motion, event.lane, 0),
		moving: event.motion !== undefined
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

	// Luật 4 (P2-1): khai báo chuyển động phải hợp lệ.
	for (const event of pattern.events) {
		if (event.motion === undefined) {
			continue;
		}

		const problem = validateMotion(event.motion, event.lane);

		if (problem !== null) {
			issues.push({ patternId: pattern.id, kind: "bad-motion", detail: `làn ${event.lane}: ${problem}` });
		}
	}

	const bands = toBands(pattern);

	// Luật 5 (P2-1): trong CÙNG một hàng (cùng offset), chướng ngại di động không
	// được tới nơi ngay trên đầu một vật đứng yên. Fairness thì luật 1 đã canh, đây
	// là chuyện HÌNH ẢNH: hai model lồng vào nhau, và người chơi mất đúng cái tín
	// hiệu "chỗ này còn trống" mà cả cơ chế dựa vào.
	//
	// Chỉ cần xét trong một hàng: mọi vật trôi cùng vận tốc với nhau nên hiệu z giữa
	// hai hàng khác offset là hằng số — hai hàng không bao giờ gặp nhau.
	for (let a = 0; a < pattern.events.length; a += 1) {
		const moving = pattern.events[a];

		if (moving === undefined || moving.motion === undefined) {
			continue;
		}

		const landing = arrivalLane(moving.motion, moving.lane);

		for (let b = 0; b < pattern.events.length; b += 1) {
			const other = pattern.events[b];

			if (other === undefined || b === a || other.offset !== moving.offset) {
				continue;
			}

			const otherLane = other.motion === undefined ? other.lane : arrivalLane(other.motion, other.lane);

			if (Math.abs(landing - otherLane) < 1) {
				issues.push({
					patternId: pattern.id,
					kind: "moving-row-conflict",
					detail: `vật di động tới làn ${landing.toFixed(2)}, chồng lên vật ở làn ${otherLane.toFixed(2)} cùng hàng`
				});
			}
		}
	}

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
		// Dùng làn THẬT (đã cộng lệch) để vật di động cũng bị soi chung một luật.
		const laneBands = bands.filter((band) => Math.round(bandLane(band)) === lane);

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

/** Pattern có chứa chướng ngại di động không (P2-1). */
export function hasMovingObstacle(pattern: Pattern): boolean {
	return pattern.events.some((event) => event.motion !== undefined);
}

/**
 * Trạng thái "ván đang khó tới đâu" — đầu vào để mở khoá pattern tổ hợp (P2-1).
 * Thuần dữ liệu để test khỏi phải dựng cả RunScene.
 */
export interface RunIntensity {
	/**
	 * Hệ số ramp tốc độ hiện tại (`computeRampFactor`): 1.0 lúc bắt đầu, +0.05 mỗi
	 * 30s. Dùng RAMP chứ không dùng tốc độ tuyệt đối vì tốc độ tuyệt đối phụ thuộc
	 * `gameSpeed` của admin — lớp bị đặt 0.5 sẽ không bao giờ thấy pattern tổ hợp,
	 * trong khi cái ta muốn đo là "em đã chạy được bao lâu rồi".
	 */
	rampFactor: number;
	/** Đã qua bao nhiêu chặng boss (0 = còn ở chặng đầu). */
	stageIndex: number;
	/** Vừa mất tim → đang trong pha giảm mật độ. */
	recovering: boolean;
}

/**
 * Pattern này được phép xuất hiện lúc này không.
 *
 * Hai cửa, theo đúng thứ tự mức độ nghiêm ngặt:
 *   1. vừa mất tim → chỉ pattern dễ nhất (luật cũ từ P0-6, nay gom về đây);
 *   2. pattern tổ hợp (difficulty ≥ 4) → phải ván đã nóng.
 */
export function isPatternAllowed(pattern: Pattern, intensity: RunIntensity): boolean {
	if (intensity.recovering === true && pattern.difficulty > 1) {
		return false;
	}

	if (pattern.difficulty < tuning.spawn.comboDifficulty) {
		return true;
	}

	return (
		intensity.rampFactor >= tuning.spawn.comboUnlockRampFactor ||
		intensity.stageIndex >= tuning.spawn.comboUnlockStageIndex
	);
}
