"use strict";

// Player data store: leaderboard (per level) and adaptive skill profiles.
// Reuses the shared SQL client + ready() promise from the question store so the
// schema (server/schema.js) is guaranteed to exist before any query runs.

var QuestionModel = require("../shared/questionModel");
var applySchema = require("./schema").applySchema;

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
						"INSERT INTO scores (device_id, level, nickname, score, correct_count, wrong_count, timeout_count, duration_ms) " +
						"VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
					params: [deviceId, level, nickname, score, correctCount, wrongCount, timeoutCount, durationMs]
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
				score: score
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

	return {
		submitScore: submitScore,
		getLeaderboard: getLeaderboard,
		updateNickname: updateNickname,
		saveSkill: saveSkill
	};
}

module.exports = {
	createPlayerStore: createPlayerStore
};
