// Near-miss (plan §4.4 — P1-1): lướt sát chướng ngại <0.4 unit → +10 điểm + "SÁT NÚT!".
//
// File CỐ Ý không import three: thuần số học để `node --test` kiểm được.
//
// Cạm bẫy mà DoD P1-1 chỉ đích danh — "near-miss không kích hoạt nhầm khi va chạm
// thật". Hai chỗ dễ sai:
//   1. Đo khoảng cách ở đúng MỘT frame thì frame đó có thể rơi vào lúc player còn
//      cách xa; phải lấy khoảng hở NHỎ NHẤT trong suốt lúc đi ngang nhau.
//   2. Va chạm thật cũng cho khoảng hở nhỏ (âm). Vì vậy chỉ thưởng khi khoảng hở
//      ≥ 0 VÀ slot chưa bị `consumed` (RunScene đánh dấu ngay khi phát hiện đâm).
//
// Trạng thái đo được ghi THẲNG vào slot (nearMissMin/nearMissAwarded) chứ không
// dựng Map mỗi frame — quy tắc vàng #6 cấm cấp phát trong đường nóng.

import { tuning } from "@/tuning";
import { poseClears, type ObstacleKind, type PlayerPose } from "@/systems/Collision";

export interface NearMissBand {
	active: boolean;
	lane: number;
	kind: ObstacleKind;
	zStart: number;
	zEnd: number;
	/** Đã đâm thật → vĩnh viễn không được thưởng near-miss. */
	consumed: boolean;
	/** Khoảng hở nhỏ nhất đo được; Infinity = chưa từng đi ngang. */
	nearMissMin: number;
	nearMissAwarded: boolean;
	/** P2-1 — lệch làn của chướng ngại di động (xem systems/movingObstacles.ts). */
	laneOffset?: number;
	moving?: boolean;
}

export interface NearMissPlayer {
	x: number;
	y: number;
	z: number;
	halfWidth: number;
	halfDepth: number;
	/** Chiều cao đứng — lúc trượt thì hitbox hạ theo `player.slideHitboxScale`. */
	height: number;
	pose: PlayerPose;
}

/**
 * Tâm làn theo trục x (giống `laneToX` của PlayerMotion, nhân bản để giữ file thuần).
 * Nhận cả số thực: chướng ngại di động (P2-1) đứng giữa hai làn được.
 */
export function laneCenterX(lane: number): number {
	return (lane - 1) * tuning.world.laneOffsetX;
}

/** Tâm ngang thật của một chướng ngại — đã cộng lệch làn nếu nó đang trôi. */
function bandCenterX(band: NearMissBand): number {
	return laneCenterX(band.lane + (band.laneOffset ?? 0));
}

/**
 * Khoảng hở giữa player và một chướng ngại, tính bằng unit.
 *
 *   > 0 : né được, số càng nhỏ càng "sát nút";
 *   ≤ 0 : đã chạm (hoặc chồng lên nhau ở tư thế không né được).
 *
 * Ưu tiên khoảng hở NGANG (đổi làn né) — nếu không chồng theo phương x thì chưa
 * cần xét tư thế. Chồng theo x thì chỉ có nhảy/trượt mới cứu, và khoảng hở là
 * khoảng cách DỌC còn lại.
 */
export function nearMissClearance(player: NearMissPlayer, band: NearMissBand): number {
	const obstacleHalfWidth =
		band.moving === true ? tuning.nearMiss.movingHalfWidth : tuning.nearMiss.obstacleHalfWidth;
	const lateral = Math.abs(player.x - bandCenterX(band)) - player.halfWidth - obstacleHalfWidth;

	if (lateral > 0) {
		return lateral;
	}

	if (poseClears(band.kind, player.pose) === false) {
		// Chồng làn + tư thế không né được = đâm. Trả số âm để không bao giờ thưởng.
		return -1;
	}

	if (band.kind === "low") {
		// Nhảy qua rào thấp: khoảng hở = gót chân trừ mép trên rào.
		return player.y - tuning.nearMiss.lowTopY;
	}

	// Trượt lọt khe dưới rào cao: khoảng hở = mép dưới rào trừ đỉnh đầu lúc trượt.
	const headY = player.y + player.height * tuning.player.slideHitboxScale;
	return tuning.nearMiss.highGapY - headY;
}

/** Player và chướng ngại có đang chồng nhau theo trục z không. */
function overlapsZ(player: NearMissPlayer, band: NearMissBand): boolean {
	return player.z + player.halfDepth >= band.zStart && player.z - player.halfDepth <= band.zEnd;
}

export class NearMissTracker {
	/** Số near-miss bậc PERFECT trong lần `sample()` gần nhất (P2-2). */
	private perfectInLastSample = 0;

	get lastPerfectCount(): number {
		return this.perfectInLastSample;
	}

	/**
	 * Đo một frame. Trả về SỐ near-miss vừa chốt trong frame này (thường 0 hoặc 1;
	 * cụm 2 chướng ngại song song có thể cho 2).
	 *
	 * Gọi SAU `findCollision` trong cùng frame để cờ `consumed` đã đúng.
	 */
	sample(player: NearMissPlayer, bands: readonly NearMissBand[]): number {
		this.perfectInLastSample = 0;

		if (tuning.nearMiss.enabled !== 1) {
			return 0;
		}

		let awarded = 0;

		for (const band of bands) {
			if (band.active === false || band.nearMissAwarded === true) {
				continue;
			}

			if (band.consumed === true) {
				// Đâm thật rồi: khoá luôn, kể cả khi trước đó đã đo được khoảng hở đẹp.
				band.nearMissAwarded = true;
				continue;
			}

			if (overlapsZ(player, band) === true) {
				const clearance = nearMissClearance(player, band);

				if (clearance < band.nearMissMin) {
					band.nearMissMin = clearance;
				}

				continue;
			}

			// Chướng ngại chạy về phía +z, nên "đã qua hẳn sau lưng" là chốt sổ.
			if (band.zStart <= player.z + player.halfDepth) {
				continue;
			}

			band.nearMissAwarded = true;

			if (band.nearMissMin >= 0 && band.nearMissMin < tuning.nearMiss.thresholdUnits) {
				awarded += 1;

				if (band.nearMissMin < tuning.nearMiss.perfectUnits) {
					this.perfectInLastSample += 1;
				}
			}
		}

		return awarded;
	}
}

/** Đưa slot về trạng thái chưa đo — gọi khi Spawn tái sử dụng slot cho pattern mới. */
export function resetNearMiss(band: NearMissBand): void {
	band.nearMissMin = Number.POSITIVE_INFINITY;
	band.nearMissAwarded = false;
}

// --- Chuỗi near-miss (P2-2) --------------------------------------------------

/**
 * Hệ số nhân điểm theo độ dài chuỗi. Bậc thang chứ không tăng đều: người chơi
 * phải CẢM được lúc lên bậc, và một đường cong liên tục thì không ai cảm thấy gì.
 */
export function chainMultiplier(chain: number): number {
	if (chain >= tuning.nearMiss.chainTier3) {
		return tuning.nearMiss.chainTier3Multiplier;
	}

	if (chain >= tuning.nearMiss.chainTier2) {
		return tuning.nearMiss.chainTier2Multiplier;
	}

	if (chain >= tuning.nearMiss.chainTier1) {
		return tuning.nearMiss.chainTier1Multiplier;
	}

	return 1;
}

/** Cao độ tiếng "sát nút" — tăng dần theo chuỗi để tai nghe ra mình đang nối. */
export function chainPitch(chain: number): number {
	const raised = 1 + Math.max(chain - 1, 0) * tuning.nearMiss.chainPitchStep;
	return Math.min(raised, tuning.nearMiss.chainPitchMax);
}

export interface NearMissAward {
	/** Số near-miss vừa chốt trong frame này. */
	count: number;
	/** Trong đó bao nhiêu cái đạt bậc PERFECT. */
	perfect: number;
	/** Độ dài chuỗi SAU khi cộng. */
	chain: number;
	multiplier: number;
	/** Điểm đã cộng (đã làm tròn). */
	points: number;
	pitch: number;
}

/**
 * Đếm chuỗi near-miss liên tiếp.
 *
 * Luật:
 *   · mỗi near-miss nối chuỗi và làm mới cửa sổ `chainWindowSec`;
 *   · hết cửa sổ mà không có cái nào → chuỗi về 0 (không phạt, chỉ là hết);
 *   · VA CHẠM THẬT → gãy ngay lập tức. Đây là điều làm chuỗi có ý nghĩa: phần
 *     thưởng lớn nhất của trò chơi này chỉ tới với người dám lướt sát mà KHÔNG đâm.
 *
 * Thuần số học, không cấp phát trong `update` — object trả về chỉ sinh ở đúng
 * frame có thưởng (hiếm), không phải mỗi frame.
 */
export class NearMissChainTracker {
	private chain = 0;
	private windowRemainingSec = 0;

	get current(): number {
		return this.chain;
	}

	get remainingSec(): number {
		return this.windowRemainingSec;
	}

	reset(): void {
		this.chain = 0;
		this.windowRemainingSec = 0;
	}

	/** Gãy chuỗi vì đâm chướng ngại. */
	break(): void {
		this.reset();
	}

	update(deltaSec: number): void {
		if (this.windowRemainingSec <= 0) {
			return;
		}

		this.windowRemainingSec -= deltaSec;

		if (this.windowRemainingSec <= 0) {
			this.chain = 0;
			this.windowRemainingSec = 0;
		}
	}

	/**
	 * Cộng `count` near-miss vừa chốt (trong đó `perfect` cái đạt bậc PERFECT).
	 *
	 * Hệ số nhân lấy theo chuỗi SAU khi cộng, và bậc PERFECT nhân thêm cho đúng
	 * số cái đạt bậc chứ không cho cả cụm — hai chướng ngại chốt cùng frame thì
	 * cái lướt sát hơn mới được nhân.
	 */
	register(count: number, perfect: number, basePoints: number): NearMissAward | null {
		if (count <= 0) {
			return null;
		}

		const perfectCount = Math.min(Math.max(perfect, 0), count);
		this.chain += count;
		this.windowRemainingSec = tuning.nearMiss.chainWindowSec;

		const multiplier = chainMultiplier(this.chain);
		const weighted = count - perfectCount + perfectCount * tuning.nearMiss.perfectMultiplier;

		return {
			count,
			perfect: perfectCount,
			chain: this.chain,
			multiplier,
			points: Math.round(basePoints * weighted * multiplier),
			pitch: chainPitch(this.chain)
		};
	}
}
