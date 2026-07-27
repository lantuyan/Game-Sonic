"use strict";

// Player data store: leaderboard (per level) and adaptive skill profiles.
// Reuses the shared SQL client + ready() promise from the question store so the
// schema (server/schema.js) is guaranteed to exist before any query runs.

var QuestionModel = require("../shared/questionModel");
var applySchema = require("./schema").applySchema;
var badwords = require("./badwords-vi");

var MAX_SCORE = 10000000;
var MAX_COUNT = 1000000;
var MAX_DURATION_MS = 86400000;
var MAX_NICKNAME_LENGTH = 24;
var MAX_DEVICE_ID_LENGTH = 64;
var LEADERBOARD_LIMIT = 20;

function badRequest(message) {
	var error = new Error(message);
	error.statusCode = 400;
	return error;
}

function requireDeviceId(value) {
	var deviceId = String(value == null ? "" : value).trim();

	if (deviceId === "" || deviceId.length > MAX_DEVICE_ID_LENGTH) {
		throw badRequest("A valid deviceId is required.");
	}

	return deviceId;
}

function normalizeNickname(value) {
	// Strip control characters, then collapse runs of whitespace.
	var nickname = String(value == null ? "" : value)
		.replace(/[\x00-\x1F\x7F]/g, " ")
		.replace(/\s+/g, " ")
		.trim();

	if (nickname === "") {
		throw badRequest("A nickname is required.");
	}

	if (nickname.length > MAX_NICKNAME_LENGTH) {
		nickname = nickname.slice(0, MAX_NICKNAME_LENGTH).trim();
	}

	return nickname;
}

function requireLevel(value) {
	try {
		QuestionModel.assertLevel(value);
	} catch (error) {
		throw badRequest(error.message);
	}

	return value;
}

function boundedInteger(value, fieldName, maxValue) {
	var numericValue = Number(value == null ? 0 : value);

	if (isFinite(numericValue) === false) {
		throw badRequest("Field \"" + fieldName + "\" must be a number.");
	}

	numericValue = Math.floor(numericValue);

	if (numericValue < 0) {
		numericValue = 0;
	}

	if (numericValue > maxValue) {
		throw badRequest("Field \"" + fieldName + "\" is out of range.");
	}

	return numericValue;
}

function clampNumber(value, minValue, maxValue, fallback) {
	var numericValue = Number(value);

	if (isFinite(numericValue) === false) {
		return fallback;
	}

	return Math.min(maxValue, Math.max(minValue, numericValue));
}

// When no SQL client is available (e.g. on Vercel before DATABASE_URL/Neon is
// configured), leaderboard and skill features degrade gracefully: reads return
// empty and writes are accepted as no-ops, so the game keeps working with no
// errors. Persistence lights up automatically once Neon is connected.
function createDisabledPlayerStore() {
	return {
		submitScore: function () {
			return Promise.resolve({ rank: null, best: null, score: 0, disabled: true });
		},
		getLeaderboard: function (level) {
			return Promise.resolve({ level: level, entries: [], me: null, disabled: true });
		},
		updateNickname: function (deviceId, nickname) {
			return Promise.resolve({ deviceId: deviceId, nickname: nickname, disabled: true });
		},
		saveSkill: function () {
			return Promise.resolve({ disabled: true });
		},
		// P1-4 — kiểm duyệt cũng phải "tắt êm" như phần còn lại khi chưa có CSDL.
		deleteScore: function () {
			return Promise.resolve({ deleted: 0, disabled: true });
		},
		listScores: function () {
			return Promise.resolve({ entries: [], disabled: true });
		},
		blockNickname: function (nickname) {
			return Promise.resolve({ nickname: nickname, renamed: 0, disabled: true });
		},
		unblockNickname: function (nickname) {
			return Promise.resolve({ nickname: nickname, blocked: false, disabled: true });
		},
		listBlockedNicknames: function () {
			return Promise.resolve({ entries: [], disabled: true });
		},
		isNicknameAllowed: function (nickname) {
			// Không có CSDL thì vẫn lọc từ cấm được — nó thuần văn bản.
			return Promise.resolve(
				badwords.containsBadWord(nickname) === true
					? { allowed: false, reason: "badword" }
					: { allowed: true, reason: null }
			);
		}
	};
}

function createPlayerStore(options) {
	var sql = options && options.sql ? options.sql : null;

	if (sql == null) {
		return createDisabledPlayerStore();
	}

	var readyPromise = applySchema(sql);

	function ready() {
		return readyPromise;
	}

	function run(text, params) {
		return ready().then(function () {
			return sql.query(text, params || []);
		});
	}

	function submitScore(payload) {
		var data = payload || {};
		var deviceId = requireDeviceId(data.deviceId);
		var nickname = normalizeNickname(data.nickname);
		var level = requireLevel(data.level);
		var score = boundedInteger(data.score, "score", MAX_SCORE);
		var correctCount = boundedInteger(data.correctCount, "correctCount", MAX_COUNT);
		var wrongCount = boundedInteger(data.wrongCount, "wrongCount", MAX_COUNT);
		var timeoutCount = boundedInteger(data.timeoutCount, "timeoutCount", MAX_COUNT);
		var durationMs = boundedInteger(data.durationMs, "durationMs", MAX_DURATION_MS);
		// P1-4: `verified` do server/app.js quyết (vé + kiểm chéo), store chỉ ghi lại.
		var verified = data.verified === true;

		return ready().then(function () {
			return sql.batch([
				{
					text:
						"INSERT INTO players (device_id, nickname, updated_at) VALUES ($1,$2,now()) " +
						"ON CONFLICT (device_id) DO UPDATE SET nickname = EXCLUDED.nickname, updated_at = now()",
					params: [deviceId, nickname]
				},
				{
					text:
						"INSERT INTO scores (device_id, level, nickname, score, correct_count, wrong_count, timeout_count, duration_ms, verified) " +
						"VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
					params: [deviceId, level, nickname, score, correctCount, wrongCount, timeoutCount, durationMs, verified]
				}
			]);
		}).then(function () {
			return sql.query(
				"WITH best AS (" +
					"SELECT device_id, MAX(score) AS best_score FROM scores WHERE level = $1 GROUP BY device_id" +
				") " +
				"SELECT " +
					"(SELECT best_score FROM best WHERE device_id = $2) AS my_best, " +
					"(SELECT 1 + COUNT(*) FROM best WHERE best_score > (SELECT best_score FROM best WHERE device_id = $2)) AS my_rank",
				[level, deviceId]
			);
		}).then(function (result) {
			var row = result.rows[0] || {};

			return {
				rank: row.my_rank != null ? Number(row.my_rank) : null,
				best: row.my_best != null ? Number(row.my_best) : score,
				score: score,
				verified: verified
			};
		});
	}

	function getLeaderboard(level, deviceId) {
		requireLevel(level);
		var viewerId = deviceId != null ? String(deviceId).trim() : "";

		var entriesPromise = run(
			"WITH best AS (" +
				"SELECT device_id, MAX(score) AS best_score FROM scores WHERE level = $1 GROUP BY device_id" +
			"), ranked AS (" +
				"SELECT device_id, best_score, RANK() OVER (ORDER BY best_score DESC) AS rnk FROM best" +
			") " +
			"SELECT r.rnk, r.best_score, p.nickname, r.device_id " +
			"FROM ranked r JOIN players p ON p.device_id = r.device_id " +
			"ORDER BY r.rnk ASC, p.nickname ASC LIMIT $2",
			[level, LEADERBOARD_LIMIT]
		);

		var mePromise = viewerId === "" ? Promise.resolve(null) : run(
			"WITH best AS (" +
				"SELECT device_id, MAX(score) AS best_score FROM scores WHERE level = $1 GROUP BY device_id" +
			"), ranked AS (" +
				"SELECT device_id, best_score, RANK() OVER (ORDER BY best_score DESC) AS rnk FROM best" +
			") " +
			"SELECT r.rnk, r.best_score, p.nickname FROM ranked r JOIN players p ON p.device_id = r.device_id " +
			"WHERE r.device_id = $2",
			[level, viewerId]
		).then(function (result) {
			if (result.rows.length === 0) {
				return null;
			}

			var row = result.rows[0];
			return { rank: Number(row.rnk), score: Number(row.best_score), nickname: row.nickname };
		});

		return Promise.all([entriesPromise, mePromise]).then(function (parts) {
			var entries = parts[0].rows.map(function (row) {
				return {
					rank: Number(row.rnk),
					nickname: row.nickname,
					score: Number(row.best_score),
					isMe: viewerId !== "" && row.device_id === viewerId
				};
			});

			return {
				level: level,
				entries: entries,
				me: parts[1]
			};
		});
	}

	function updateNickname(deviceId, nickname) {
		var normalizedDeviceId = requireDeviceId(deviceId);
		var normalizedNickname = normalizeNickname(nickname);

		return ready().then(function () {
			return sql.batch([
				{
					text:
						"INSERT INTO players (device_id, nickname, updated_at) VALUES ($1,$2,now()) " +
						"ON CONFLICT (device_id) DO UPDATE SET nickname = EXCLUDED.nickname, updated_at = now()",
					params: [normalizedDeviceId, normalizedNickname]
				},
				{
					text: "UPDATE scores SET nickname = $2 WHERE device_id = $1",
					params: [normalizedDeviceId, normalizedNickname]
				}
			]);
		}).then(function () {
			return { deviceId: normalizedDeviceId, nickname: normalizedNickname };
		});
	}

	function saveSkill(deviceId, payload) {
		var normalizedDeviceId = requireDeviceId(deviceId);
		var data = payload || {};
		var level = requireLevel(data.level);
		var skill = clampNumber(data.skill, 0, 1, 0.5);
		var accuracy = data.accuracy == null ? null : clampNumber(data.accuracy, 0, 1, null);
		var avgAnswerMs = data.avgAnswerMs == null ? null : boundedInteger(data.avgAnswerMs, "avgAnswerMs", MAX_DURATION_MS);
		var recommendedSpeed = data.recommendedSpeed == null
			? null
			: clampNumber(data.recommendedSpeed, QuestionModel.GAME_SPEED_MIN, QuestionModel.GAME_SPEED_MAX, QuestionModel.GAME_SPEED_DEFAULT);
		var gamesPlayed = boundedInteger(data.gamesPlayed, "gamesPlayed", MAX_COUNT);
		var difficultyWeights = data.difficultyWeights != null && typeof data.difficultyWeights === "object"
			? data.difficultyWeights
			: {};

		// P1-5 — số liệu học tập bổ sung (gateAnswerMs, modeStats) đi NHỜ trong cột
		// JSONB `difficulty_weights` thay vì thêm cột mới: JSONB nhận khoá lạ mà
		// không cần migration, và bản server cũ chỉ đơn giản lưu rồi bỏ qua.
		if (data.learning != null && typeof data.learning === "object") {
			difficultyWeights = Object.assign({}, difficultyWeights, { learning: data.learning });
		}

		return run(
			"INSERT INTO skill_profiles (device_id, level, skill, accuracy, avg_answer_ms, recommended_speed, difficulty_weights, games_played, updated_at) " +
			"VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,now()) " +
			"ON CONFLICT (device_id, level) DO UPDATE SET " +
				"skill = EXCLUDED.skill, accuracy = EXCLUDED.accuracy, avg_answer_ms = EXCLUDED.avg_answer_ms, " +
				"recommended_speed = EXCLUDED.recommended_speed, difficulty_weights = EXCLUDED.difficulty_weights, " +
				"games_played = EXCLUDED.games_played, updated_at = now()",
			[normalizedDeviceId, level, skill, accuracy, avgAnswerMs, recommendedSpeed, JSON.stringify(difficultyWeights), gamesPlayed]
		).then(function () {
			return { deviceId: normalizedDeviceId, level: level, skill: skill };
		});
	}

	// --- Kiểm duyệt (P1-4) ---------------------------------------------------

	/** Xoá MỘT bản ghi điểm. Trả về số dòng đã xoá để admin biết có trúng không. */
	function deleteScore(scoreId) {
		var id = Number(scoreId);

		if (isFinite(id) === false || id <= 0) {
			throw badRequest("A valid score id is required.");
		}

		return run("DELETE FROM scores WHERE id = $1", [Math.floor(id)]).then(function (result) {
			return { deleted: result.rowCount != null ? Number(result.rowCount) : 0, id: Math.floor(id) };
		});
	}

	/**
	 * Danh sách điểm gần đây cho màn kiểm duyệt. Kèm `verified` để giáo viên nhìn
	 * ra ngay bản ghi nào server đã nghi ngờ.
	 */
	function listScores(level, limit) {
		var safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
		var params = [safeLimit];
		var where = "";

		if (level != null && String(level).trim() !== "") {
			requireLevel(level);
			where = "WHERE level = $2 ";
			params.push(level);
		}

		return run(
			"SELECT id, device_id, level, nickname, score, correct_count, duration_ms, verified, created_at " +
			"FROM scores " + where + "ORDER BY created_at DESC LIMIT $1",
			params
		).then(function (result) {
			return {
				entries: result.rows.map(function (row) {
					return {
						id: Number(row.id),
						deviceId: row.device_id,
						level: row.level,
						nickname: row.nickname,
						score: Number(row.score),
						correctCount: Number(row.correct_count),
						durationMs: row.duration_ms != null ? Number(row.duration_ms) : null,
						verified: row.verified === true,
						createdAt: row.created_at
					};
				})
			};
		});
	}

	/**
	 * Chặn một biệt danh. Đổi mọi bản ghi đang mang biệt danh đó sang tên thay thế
	 * NGAY — nếu chỉ chặn cho tương lai thì cái tên xấu vẫn nằm trên bảng xếp hạng.
	 */
	function blockNickname(nickname, reason, replacement) {
		var normalized = badwords.removeDiacritics(normalizeNickname(nickname));
		var newName = replacement != null && String(replacement).trim() !== ""
			? normalizeNickname(replacement)
			: "Người chơi ẩn danh";

		return ready().then(function () {
			return sql.batch([
				{
					text:
						"INSERT INTO blocked_nicknames (nickname_normalized, reason) VALUES ($1,$2) " +
						"ON CONFLICT (nickname_normalized) DO UPDATE SET reason = EXCLUDED.reason",
					params: [normalized, reason != null ? String(reason) : null]
				}
			]);
		}).then(function () {
			// So sánh ĐÃ BỎ DẤU ở phía JS: Postgres không có sẵn hàm bỏ dấu tiếng Việt
			// nếu chưa cài extension `unaccent`, và ta không muốn phụ thuộc vào nó.
			return run("SELECT DISTINCT nickname FROM scores", []);
		}).then(function (result) {
			var matching = result.rows
				.map(function (row) { return row.nickname; })
				.filter(function (name) { return badwords.removeDiacritics(name) === normalized; });

			if (matching.length === 0) {
				return { nickname: normalized, renamed: 0 };
			}

			return sql.batch(
				matching.flatMap(function (name) {
					return [
						{ text: "UPDATE scores SET nickname = $2 WHERE nickname = $1", params: [name, newName] },
						{ text: "UPDATE players SET nickname = $2 WHERE nickname = $1", params: [name, newName] }
					];
				})
			).then(function () {
				return { nickname: normalized, renamed: matching.length, replacement: newName };
			});
		});
	}

	function unblockNickname(nickname) {
		var normalized = badwords.removeDiacritics(normalizeNickname(nickname));

		return run("DELETE FROM blocked_nicknames WHERE nickname_normalized = $1", [normalized]).then(function () {
			return { nickname: normalized, blocked: false };
		});
	}

	function listBlockedNicknames() {
		return run("SELECT nickname_normalized, reason, created_at FROM blocked_nicknames ORDER BY created_at DESC", [])
			.then(function (result) {
				return {
					entries: result.rows.map(function (row) {
						return {
							nickname: row.nickname_normalized,
							reason: row.reason,
							createdAt: row.created_at
						};
					})
				};
			});
	}

	/** Biệt danh này có bị chặn (hoặc chứa từ cấm) không. */
	function isNicknameAllowed(nickname) {
		var normalized = badwords.removeDiacritics(String(nickname == null ? "" : nickname));

		if (badwords.containsBadWord(nickname) === true) {
			return Promise.resolve({ allowed: false, reason: "badword" });
		}

		return run("SELECT 1 FROM blocked_nicknames WHERE nickname_normalized = $1", [normalized]).then(function (result) {
			return result.rows.length > 0
				? { allowed: false, reason: "blocked" }
				: { allowed: true, reason: null };
		});
	}

	return {
		submitScore: submitScore,
		getLeaderboard: getLeaderboard,
		updateNickname: updateNickname,
		saveSkill: saveSkill,
		deleteScore: deleteScore,
		listScores: listScores,
		blockNickname: blockNickname,
		unblockNickname: unblockNickname,
		listBlockedNicknames: listBlockedNicknames,
		isNicknameAllowed: isNicknameAllowed
	};
}

module.exports = {
	createPlayerStore: createPlayerStore
};
