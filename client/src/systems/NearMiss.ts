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

/** Tâm làn theo trục x (giống `laneToX` của PlayerMotion, nhân bản để giữ file thuần). */
export function laneCenterX(lane: number): number {
	return (lane - 1) * tuning.world.laneOffsetX;
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
	const lateral =
		Math.abs(player.x - laneCenterX(band.lane)) - player.halfWidth - tuning.nearMiss.obstacleHalfWidth;

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
	/**
	 * Đo một frame. Trả về SỐ near-miss vừa chốt trong frame này (thường 0 hoặc 1;
	 * cụm 2 chướng ngại song song có thể cho 2).
	 *
	 * Gọi SAU `findCollision` trong cùng frame để cờ `consumed` đã đúng.
	 */
	sample(player: NearMissPlayer, bands: readonly NearMissBand[]): number {
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
