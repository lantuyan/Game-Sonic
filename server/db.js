"use strict";

var fs = require("fs");
var path = require("path");
var QuestionModel = require("../shared/questionModel");
var createSqlClient = require("./sql").createSqlClient;
var applySchema = require("./schema").applySchema;

function createDatabase(config) {
	var sql = config && config.sqlClient ? config.sqlClient : createSqlClient(config);
	var readyPromise = initialize(sql, config);

	function ready() {
		return readyPromise;
	}

	return {
		sql: sql,
		ready: ready,
		close: function () {
			// Wait for initialization to settle so we never close the connection
			// while a schema/seed query is still in flight (avoids late rejections).
			return readyPromise.catch(function () {}).then(function () {
				return sql.close();
			});
		},
		getLevelBundle: function (level) {
			QuestionModel.assertLevel(level);
			return ready().then(function () {
				return buildLevelBundle(sql, level);
			});
		},
		replaceQuestionsForLevel: function (level, questions) {
			QuestionModel.assertLevel(level);
			return ready().then(function () {
				return replaceQuestionsForLevel(sql, level, questions);
			});
		},
		updatePointSettingsForLevel: function (level, settings) {
			QuestionModel.assertLevel(level);
			return ready().then(function () {
				return updateDifficultySettingsForAllLevels(sql, settings, "point", level);
			});
		},
		updateTimeSettingsForLevel: function (level, settings) {
			QuestionModel.assertLevel(level);
			return ready().then(function () {
				return updateDifficultySettingsForAllLevels(sql, settings, "time", level);
			});
		},
		updateGameSpeedForLevel: function (level, value) {
			QuestionModel.assertLevel(level);
			return ready().then(function () {
				return updateGameSpeedForAllLevels(sql, value, level);
			});
		}
	};
}

function initialize(sql, config) {
	return applySchema(sql)
		.then(function () {
			return seedIfEmpty(sql, config.rootDir);
		})
		.then(function () {
			return ensureLevelSettingsRows(sql);
		});
}

function buildInsertQuestionItem(level, question, sortOrder, createdAt, updatedAt) {
	return {
		text:
			"INSERT INTO questions (" +
				"level, id, sort_order, difficulty, question, answer_a, answer_b, answer_c, answer_d, correct_answer, points, time_limit, created_at, updated_at" +
			") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
		params: [
			level,
			question.id,
			sortOrder,
			QuestionModel.normalizeDifficulty(question.difficulty),
			question.question,
			question.answers.A,
			question.answers.B,
			question.answers.C || null,
			question.answers.D || null,
			question.correctAnswer,
			question.point,
			question.time,
			createdAt,
			updatedAt
		]
	};
}

function seedIfEmpty(sql, rootDir) {
	return sql.query("SELECT COUNT(*)::int AS count FROM questions").then(function (result) {
		if (Number(result.rows[0].count) > 0) {
			return null;
		}

		var now = new Date().toISOString();
		var items = [];

		QuestionModel.LEVELS.forEach(function (level) {
			var filePath = path.join(rootDir, "questions", level + ".json");
			var rawText = fs.readFileSync(filePath, "utf8");
			var parsedQuestions = JSON.parse(rawText);
			var questions = QuestionModel.validateQuestionsData(parsedQuestions, filePath);

			questions.forEach(function (question, index) {
				items.push(buildInsertQuestionItem(level, question, index, now, now));
			});

			QuestionModel.getDifficultySummary(questions).forEach(function (item) {
				items.push({
					text:
						"INSERT INTO difficulty_settings (level, difficulty, default_point, default_time, updated_at) " +
						"VALUES ($1,$2,$3,$4,now()) " +
						"ON CONFLICT (level, difficulty) DO UPDATE SET " +
						"default_point = EXCLUDED.default_point, default_time = EXCLUDED.default_time, updated_at = now()",
					params: [level, item.difficulty, item.point, item.time]
				});
			});

			items.push({
				text:
					"INSERT INTO level_settings (level, game_speed, updated_at) VALUES ($1,$2,now()) " +
					"ON CONFLICT (level) DO UPDATE SET game_speed = EXCLUDED.game_speed, updated_at = now()",
				params: [level, QuestionModel.GAME_SPEED_DEFAULT]
			});
		});

		return sql.batch(items);
	});
}

function ensureLevelSettingsRows(sql) {
	var items = QuestionModel.LEVELS.map(function (level) {
		return {
			text:
				"INSERT INTO level_settings (level, game_speed, updated_at) VALUES ($1,$2,now()) " +
				"ON CONFLICT (level) DO NOTHING",
			params: [level, QuestionModel.GAME_SPEED_DEFAULT]
		};
	});

	return sql.batch(items);
}

function mapRowToQuestion(row) {
	var question = {
		id: row.id,
		difficulty: row.difficulty,
		question: row.question,
		answers: {
			A: row.answer_a,
			B: row.answer_b
		},
		correctAnswer: row.correct_answer,
		point: Number(row.points),
		time: Number(row.time_limit)
	};

	if (row.answer_c != null && row.answer_c !== "") {
		question.answers.C = row.answer_c;
	}

	if (row.answer_d != null && row.answer_d !== "") {
		question.answers.D = row.answer_d;
	}

	return QuestionModel.validateQuestion(question, "Database question", 0);
}

function getQuestionsForLevel(sql, level) {
	return sql.query(
		"SELECT id, difficulty, question, answer_a, answer_b, answer_c, answer_d, correct_answer, points, time_limit " +
		"FROM questions WHERE level = $1 ORDER BY sort_order ASC, id ASC",
		[level]
	).then(function (result) {
		return result.rows.map(mapRowToQuestion);
	});
}

function getStoredSettings(sql, level) {
	return sql.query(
		"SELECT difficulty, default_point, default_time FROM difficulty_settings WHERE level = $1",
		[level]
	).then(function (result) {
		var pointSettings = {};
		var timeSettings = {};

		result.rows.forEach(function (row) {
			if (row.default_point != null && isFinite(Number(row.default_point))) {
				pointSettings[row.difficulty] = Number(row.default_point);
			}

			if (row.default_time != null && isFinite(Number(row.default_time))) {
				timeSettings[row.difficulty] = Number(row.default_time);
			}
		});

		return {
			pointSettings: pointSettings,
			timeSettings: timeSettings
		};
	});
}

function getStoredGameSpeed(sql, level) {
	return sql.query(
		"SELECT game_speed FROM level_settings WHERE level = $1",
		[level]
	).then(function (result) {
		if (result.rows.length === 0 || result.rows[0].game_speed == null) {
			return QuestionModel.GAME_SPEED_DEFAULT;
		}

		return QuestionModel.normalizeGameSpeed(result.rows[0].game_speed);
	});
}

function buildLevelBundle(sql, level) {
	return Promise.all([
		getQuestionsForLevel(sql, level),
		getStoredSettings(sql, level),
		getStoredGameSpeed(sql, level)
	]).then(function (parts) {
		var questions = parts[0];
		var storedSettings = parts[1];
		var gameSpeed = parts[2];
		var pointSettings = QuestionModel.cloneData(storedSettings.pointSettings);
		var timeSettings = QuestionModel.cloneData(storedSettings.timeSettings);

		QuestionModel.getDifficultySummary(questions).forEach(function (item) {
			if (pointSettings[item.difficulty] == null) {
				pointSettings[item.difficulty] = item.point;
			}

			if (timeSettings[item.difficulty] == null) {
				timeSettings[item.difficulty] = item.time;
			}
		});

		return {
			questions: questions,
			pointSettings: pointSettings,
			timeSettings: timeSettings,
			gameSpeed: gameSpeed
		};
	});
}

function replaceQuestionsForLevel(sql, level, questions) {
	var normalizedQuestions = QuestionModel.validateQuestionsData(questions, "Questions for " + level);
	var now = new Date().toISOString();

	return sql.query("SELECT id, created_at FROM questions WHERE level = $1", [level]).then(function (result) {
		var createdAtById = {};

		result.rows.forEach(function (row) {
			createdAtById[row.id] = row.created_at;
		});

		var items = [
			{ text: "DELETE FROM questions WHERE level = $1", params: [level] }
		];

		normalizedQuestions.forEach(function (question, index) {
			var createdAt = createdAtById[question.id] != null ? createdAtById[question.id] : now;
			items.push(buildInsertQuestionItem(level, question, index, createdAt, now));
		});

		return sql.batch(items);
	}).then(function () {
		return buildLevelBundle(sql, level);
	});
}

function updateDifficultySettingsForAllLevels(sql, settings, fieldName, levelToReturn) {
	var normalizedSettings = QuestionModel.normalizeSettings(settings, fieldName);
	var isPoint = fieldName === "point";
	var items = [];

	QuestionModel.LEVELS.forEach(function (level) {
		Object.keys(normalizedSettings).forEach(function (difficulty) {
			var value = normalizedSettings[difficulty];

			if (isPoint) {
				items.push({
					text:
						"INSERT INTO difficulty_settings (level, difficulty, default_point, default_time, updated_at) " +
						"VALUES ($1,$2,$3,NULL,now()) " +
						"ON CONFLICT (level, difficulty) DO UPDATE SET default_point = EXCLUDED.default_point, updated_at = now()",
					params: [level, difficulty, value]
				});
				items.push({
					text: "UPDATE questions SET points = $1, updated_at = now() WHERE level = $2 AND difficulty = $3",
					params: [value, level, difficulty]
				});
			} else {
				items.push({
					text:
						"INSERT INTO difficulty_settings (level, difficulty, default_point, default_time, updated_at) " +
						"VALUES ($1,$2,NULL,$3,now()) " +
						"ON CONFLICT (level, difficulty) DO UPDATE SET default_time = EXCLUDED.default_time, updated_at = now()",
					params: [level, difficulty, value]
				});
				items.push({
					text: "UPDATE questions SET time_limit = $1, updated_at = now() WHERE level = $2 AND difficulty = $3",
					params: [value, level, difficulty]
				});
			}
		});
	});

	return sql.batch(items).then(function () {
		return buildLevelBundle(sql, levelToReturn);
	});
}

function updateGameSpeedForAllLevels(sql, value, levelToReturn) {
	var normalizedValue = QuestionModel.normalizeGameSpeed(value);

	var items = QuestionModel.LEVELS.map(function (level) {
		return {
			text:
				"INSERT INTO level_settings (level, game_speed, updated_at) VALUES ($1,$2,now()) " +
				"ON CONFLICT (level) DO UPDATE SET game_speed = EXCLUDED.game_speed, updated_at = now()",
			params: [level, normalizedValue]
		};
	});

	return sql.batch(items).then(function () {
		return buildLevelBundle(sql, levelToReturn);
	});
}

module.exports = {
	createDatabase: createDatabase
};
