"use strict";

// MÙA CỦA BẢNG XẾP HẠNG (P2-8) — plan §11 câu 5, rủi ro R10.
//
// P2-8 đổi thang điểm (câu đúng ×300), nên điểm ghi TRƯỚC ngày phát hành V2 và điểm
// ghi SAU đó không so sánh được với nhau nữa. Cách xử lý đã khuyến nghị ở plan §11
// câu 5: **không xoá một dòng dữ liệu nào**, chỉ lọc theo `scores.created_at`.
//
// Module này là SỐ HỌC + NGÀY THÁNG THUẦN: không SQL, không HTTP, không CSDL — để
// luật mùa kiểm được tất định mà không cần dựng server.
//
// Ba trạng thái, và trạng thái mặc định là "chưa có mùa nào":
//   · `seasonStartAt === null`  → chưa cấu hình ngày ranh giới ⇒ CHỈ CÓ MỘT bảng
//     ("Tất cả"), hành vi y hệt trước P2-8. Đây là mặc định, và là lý do bật P2-8
//     lên production không làm bảng xếp hạng đổi gì cho tới khi chủ dự án chốt ngày.
//   · `seasonStartAt` đã đặt      → hai mùa: Mùa 1 (< mốc) và Mùa 2 (≥ mốc).
//   · người xem chọn "all"        → gộp cả hai, luôn tra được.

var SEASON_ALL = "all";
var SEASON_1 = "1";
var SEASON_2 = "2";

/** Múi giờ của trường học — mọi nhãn ngày hiển thị theo giờ Việt Nam. */
var DISPLAY_TIME_ZONE = "Asia/Ho_Chi_Minh";

/** Chỉ có ngày, không có giờ: `2026-08-15`. */
var DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Đọc mốc bắt đầu Mùa 2 từ cấu hình.
 *
 * Chấp nhận:
 *   · chuỗi rỗng / null / undefined → `null` (chưa chốt ngày — mặc định);
 *   · `2026-08-15` → **00:00 giờ Việt Nam** ngày hôm đó. CỐ Ý không dùng
 *     `new Date("2026-08-15")` của JS, vốn hiểu là 00:00 **UTC** tức 07:00 sáng ở
 *     Việt Nam — bảng xếp hạng sẽ cắt vào giữa tiết học đầu tiên và không ai hiểu vì sao;
 *   · chuỗi ISO đầy đủ có múi giờ (`2026-08-15T18:00:00+07:00`) → dùng nguyên.
 *
 * @returns {Date|null}
 * @throws {Error} khi chuỗi không rỗng nhưng không đọc được — hỏng ngày ranh giới
 *   thì thà không khởi động được còn hơn âm thầm gộp hai mùa vào một bảng.
 */
function parseSeasonStart(value) {
	var text = String(value == null ? "" : value).trim();

	if (text === "") {
		return null;
	}

	var normalized = DATE_ONLY_PATTERN.test(text) === true ? text + "T00:00:00+07:00" : text;
	var parsed = new Date(normalized);

	if (isNaN(parsed.getTime()) === true) {
		throw new Error(
			"LEADERBOARD_SEASON2_START không đọc được: \"" + text + "\". " +
			"Dùng dạng YYYY-MM-DD (00:00 giờ Việt Nam) hoặc ISO đầy đủ có múi giờ."
		);
	}

	return parsed;
}

/** `15/08/2026` theo giờ Việt Nam. */
function formatDisplayDate(date) {
	if (date == null) {
		return "";
	}

	var parts = new Intl.DateTimeFormat("vi-VN", {
		timeZone: DISPLAY_TIME_ZONE,
		day: "2-digit",
		month: "2-digit",
		year: "numeric"
	}).formatToParts(date);

	var lookup = {};

	for (var index = 0; index < parts.length; index += 1) {
		lookup[parts[index].type] = parts[index].value;
	}

	return lookup.day + "/" + lookup.month + "/" + lookup.year;
}

/**
 * Danh sách mùa để giao diện dựng tab. Thứ tự: mùa ĐANG CHẠY trước.
 * @param {Date|null} seasonStartAt
 */
function listSeasons(seasonStartAt) {
	if (seasonStartAt == null) {
		return [
			{
				id: SEASON_ALL,
				label: "Tất cả",
				description: "Toàn bộ điểm từ trước tới nay",
				startAt: null,
				endAt: null,
				current: true
			}
		];
	}

	var boundary = formatDisplayDate(seasonStartAt);

	return [
		{
			id: SEASON_2,
			label: "Mùa 2",
			description: "Từ " + boundary + " — thang điểm mới",
			startAt: seasonStartAt.toISOString(),
			endAt: null,
			current: true
		},
		{
			id: SEASON_1,
			label: "Mùa 1",
			description: "Trước " + boundary + " — thang điểm cũ",
			startAt: null,
			endAt: seasonStartAt.toISOString(),
			current: false
		},
		{
			id: SEASON_ALL,
			label: "Tất cả",
			description: "Gộp cả hai mùa (thang điểm khác nhau)",
			startAt: null,
			endAt: null,
			current: false
		}
	];
}

/** Mùa mặc định khi người xem không chọn gì: mùa đang chạy. */
function currentSeasonId(seasonStartAt) {
	return seasonStartAt == null ? SEASON_ALL : SEASON_2;
}

/**
 * Chuẩn hoá tham số `?season=`. Giá trị lạ → mùa đang chạy (KHÔNG báo lỗi 400:
 * một tham số gõ sai trên thanh địa chỉ không đáng để bảng xếp hạng trắng trơn).
 *
 * Khi chưa cấu hình ngày ranh giới thì mọi giá trị đều quy về "all" — chưa có mùa
 * nào để mà lọc, và trả về "Mùa 1 rỗng" sẽ khiến giáo viên tưởng mất dữ liệu.
 */
function normalizeSeasonId(value, seasonStartAt) {
	var text = String(value == null ? "" : value).trim().toLowerCase();

	if (seasonStartAt == null) {
		return SEASON_ALL;
	}

	if (text === SEASON_1 || text === "season1" || text === "mua1") {
		return SEASON_1;
	}

	if (text === SEASON_ALL) {
		return SEASON_ALL;
	}

	return SEASON_2;
}

/**
 * Khoảng thời gian `[from, to)` của một mùa. `null` = không chặn phía đó.
 * Nửa mở CỐ Ý: một bản ghi ghi đúng vào đúng mili-giây mốc phải thuộc Mùa 2 và chỉ
 * Mùa 2 — không mùa nào được đánh rơi, không mùa nào được đếm hai lần.
 */
function seasonRange(seasonId, seasonStartAt) {
	if (seasonStartAt == null || seasonId === SEASON_ALL) {
		return { from: null, to: null };
	}

	if (seasonId === SEASON_1) {
		return { from: null, to: seasonStartAt };
	}

	return { from: seasonStartAt, to: null };
}

/** Mô tả mùa đang xem để nhét vào phản hồi API (giao diện đọc thẳng cái này). */
function describeSeason(seasonId, seasonStartAt) {
	var seasons = listSeasons(seasonStartAt);

	for (var index = 0; index < seasons.length; index += 1) {
		if (seasons[index].id === seasonId) {
			return seasons[index];
		}
	}

	return seasons[0];
}

module.exports = {
	SEASON_ALL: SEASON_ALL,
	SEASON_1: SEASON_1,
	SEASON_2: SEASON_2,
	DISPLAY_TIME_ZONE: DISPLAY_TIME_ZONE,
	parseSeasonStart: parseSeasonStart,
	formatDisplayDate: formatDisplayDate,
	listSeasons: listSeasons,
	currentSeasonId: currentSeasonId,
	normalizeSeasonId: normalizeSeasonId,
	seasonRange: seasonRange,
	describeSeason: describeSeason
};
