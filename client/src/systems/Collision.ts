// Va chạm theo LÀN (plan §4.2) — bỏ hẳn Box3-mỗi-frame của V1.
//
// Ý tưởng: đường chạy là lưới rời rạc (3 làn × trục z), nên "có va chạm không"
// chỉ là 3 phép so sánh số: cùng làn? · chồng khoảng z? · tư thế có né được không?
// Không cấp phát, không ma trận, không cây bao — chạy được cả nghìn vật thể.
//
// File này CỐ Ý không import three: thuần số học để `node --test` kiểm trực tiếp.
// (Nhập `tuning` thì được — cũng thuần số, xem systems/patternRules.ts.)

import { tuning } from "@/tuning";

/** Ba loại chướng ngại đọc-được-ngay (plan §4.2). */
export type ObstacleKind =
	/** Rào thấp → NHẢY qua. */
	| "low"
	/** Rào cao có khe dưới → TRƯỢT qua. */
	| "high"
	/** Khối chặn cả làn → ĐỔI LÀN. */
	| "full";

export type PlayerPose = "run" | "jump" | "slide";

export interface ObstacleBand {
	lane: number;
	kind: ObstacleKind;
	/** Mép gần player nhất (z nhỏ hơn = xa hơn về phía trước). */
	zStart: number;
	zEnd: number;
	/** Đã va chạm rồi thì không tính lần hai cho tới khi tái chế. */
	consumed: boolean;
	/**
	 * P2-1 — lệch làn LIÊN TỤC của chướng ngại di động, tính bằng làn.
	 * Vắng mặt hoặc 0 = vật đứng yên đúng tâm làn `lane` (mọi thứ từ P0/P1).
	 */
	laneOffset?: number;
	/** P2-1 — vật này có đang trôi ngang không (đổi bán kính chặn làn + near-miss). */
	moving?: boolean;
}

export interface PlayerState {
	lane: number;
	/** Làn đích khi đang tween — chạm bất kỳ làn nào trong 2 làn đều tính. */
	targetLane: number;
	pose: PlayerPose;
	z: number;
	/** Nửa chiều dài hitbox theo trục z. */
	halfDepth: number;
}

/**
 * Tư thế nào vượt được loại chướng ngại nào.
 *   low  → nhảy qua (trượt KHÔNG cứu được: rào thấp vẫn cao hơn người trượt)
 *   high → trượt qua (nhảy vào khe trên là đâm thẳng)
 *   full → không tư thế nào cứu được, chỉ có đổi làn
 */
export function poseClears(kind: ObstacleKind, pose: PlayerPose): boolean {
	if (kind === "low") {
		return pose === "jump";
	}

	if (kind === "high") {
		return pose === "slide";
	}

	return false;
}

/**
 * Vị trí ngang của một chướng ngại theo trục LÀN (số thực).
 * Vật đứng yên trả về đúng `lane` như từ trước tới nay.
 */
export function bandLane(band: ObstacleBand): number {
	return band.lane + (band.laneOffset ?? 0);
}

/**
 * Chướng ngại này có chặn làn số `lane` không.
 *
 * ⚠ Bất biến phải giữ: với vật ĐỨNG YÊN, `blockLaneRadius` (0.49) < 1 nên điều kiện
 * này đúng bằng `band.lane === lane` của P0 — không đổi một ván chơi cũ nào. Test
 * `chướng ngại đứng yên chặn y hệt luật cũ` khoá điều đó lại.
 */
export function bandBlocksLane(band: ObstacleBand, lane: number): boolean {
	const radius = band.moving === true ? tuning.spawn.movingBlockLaneRadius : tuning.spawn.blockLaneRadius;

	return Math.abs(bandLane(band) - lane) < radius;
}

/** Player đang chiếm những làn nào (2 làn khi đang tween). */
export function occupiedLanes(player: PlayerState): number[] {
	if (player.lane === player.targetLane) {
		return [player.lane];
	}

	return [player.lane, player.targetLane];
}

function overlapsZ(player: PlayerState, band: ObstacleBand): boolean {
	const playerNear = player.z - player.halfDepth;
	const playerFar = player.z + player.halfDepth;

	return playerFar >= band.zStart && playerNear <= band.zEnd;
}

/**
 * Trả về chướng ngại đầu tiên player đâm phải, hoặc null.
 * KHÔNG tự đánh dấu `consumed` — người gọi quyết định (có khiên thì không tiêu thụ).
 */
export function findCollision(player: PlayerState, bands: readonly ObstacleBand[]): ObstacleBand | null {
	const lanes = occupiedLanes(player);

	for (const band of bands) {
		if (band.consumed === true) {
			continue;
		}

		if (lanes.some((lane) => bandBlocksLane(band, lane)) === false) {
			continue;
		}

		if (overlapsZ(player, band) === false) {
			continue;
		}

		if (poseClears(band.kind, player.pose) === true) {
			continue;
		}

		return band;
	}

	return null;
}

/**
 * Khoảng cách tới chướng ngại gần nhất phía trước trong làn đang đứng.
 * Dùng cho near-miss (P1) và cho validator pattern (P0-6) đo "thời gian phản xạ".
 * Trả về Infinity khi làn trống.
 */
export function distanceToNextObstacle(player: PlayerState, bands: readonly ObstacleBand[]): number {
	let nearest = Number.POSITIVE_INFINITY;

	for (const band of bands) {
		if (band.consumed === true || bandBlocksLane(band, player.lane) === false) {
			continue;
		}

		// Vật thể chạy về phía +z, nên "phía trước" nghĩa là z nhỏ hơn player.
		const gap = player.z - band.zEnd;

		if (gap >= 0 && gap < nearest) {
			nearest = gap;
		}
	}

	return nearest;
}

/**
 * Có ÍT NHẤT một làn đi qua được ở lát cắt z này không (luật công bằng plan §4.2).
 * "Đi qua được" = làn trống, hoặc có chướng ngại nhưng né được bằng nhảy/trượt.
 */
export function hasEscapeLane(bands: readonly ObstacleBand[], z: number, laneCount: number): boolean {
	for (let lane = 0; lane < laneCount; lane += 1) {
		const blocking = bands.filter((band) => bandBlocksLane(band, lane) && z >= band.zStart && z <= band.zEnd);

		if (blocking.length === 0) {
			return true;
		}

		// Làn này qua được nếu tồn tại MỘT tư thế né được TẤT CẢ chướng ngại chồng lên nhau.
		const poses: PlayerPose[] = ["run", "jump", "slide"];
		const survivable = poses.some((pose) => blocking.every((band) => poseClears(band.kind, pose) === true));

		if (survivable === true) {
			return true;
		}
	}

	return false;
}
