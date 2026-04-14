"use strict";

var fs = require("fs");
var path = require("path");
var Database = require("better-sqlite3");
var QuestionModel = require("../shared/questionModel");

function createDatabase(config) {
	fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

	var db = new Database(config.databasePath);
	db.pragma("journal_mode = WAL");
	db.pragma("foreign_keys = ON");

	initializeSchema(db);
	seedIfEmpty(db, config.rootDir);
	ensureLevelSettingsRows(db);

	return {
		close: function () {
			db.close();
		},
		getLevelBundle: function (level) {
			QuestionModel.assertLevel(level);
			return buildLevelBundle(db, level);
		},
		replaceQuestionsForLevel: function (level, questions) {
			QuestionModel.assertLevel(level);
			return replaceQuestionsForLevel(db, level, questions);
		},
		updatePointSettingsForLevel: function (level, settings) {
			QuestionModel.assertLevel(level);
			return updateDifficultySettingsForAllLevels(db, settings, "point", level);
		},
		updateTimeSettingsForLevel: function (level, settings) {
			QuestionModel.assertLevel(level);
			return updateDifficultySettingsForAllLevels(db, settings, "time", level);
		},
		updateGameSpeedForLevel: function (level, value) {
			QuestionModel.assertLevel(level);
			return updateGameSpeedForAllLevels(db, value, level);
		}
	};
}

function initializeSchema(db) {
	db.exec(
		"CREATE TABLE IF NOT EXISTS questions (" +
			"level TEXT NOT NULL," +
			"id TEXT NOT NULL," +
			"sort_order INTEGER NOT NULL," +
			"difficulty TEXT NOT NULL," +
			"question TEXT NOT NULL," +
			"answer_a TEXT NOT NULL," +
			"answer_b TEXT NOT NULL," +
			"answer_c TEXT," +
			"answer_d TEXT," +
			"correct_answer TEXT NOT NULL," +
			"point REAL NOT NULL," +
			"time INTEGER NOT NULL," +
			"created_at TEXT NOT NULL," +
			"updated_at TEXT NOT NULL," +
			"PRIMARY KEY (level, id)" +
		");" +
		"CREATE INDEX IF NOT EXISTS idx_questions_level_sort ON questions (level, sort_order);" +
		"CREATE TABLE IF NOT EXISTS difficulty_settings (" +
			"level TEXT NOT NULL," +
			"difficulty TEXT NOT NULL," +
			"default_point REAL," +
			"default_time INTEGER," +
			"updated_at TEXT NOT NULL," +
			"PRIMARY KEY (level, difficulty)" +
		");" +
		"CREATE TABLE IF NOT EXISTS level_settings (" +
			"level TEXT NOT NULL PRIMARY KEY," +
			"game_speed REAL NOT NULL," +
			"updated_at TEXT NOT NULL" +
		");"
	);
}

function seedIfEmpty(db, rootDir) {
	var questionCount = db.prepare("SELECT COUNT(*) AS count FROM questions").get().count;

	if (questionCount > 0) {
		return;
	}

	var insertQuestion = db.prepare(
		"INSERT INTO questions (" +
			"level, id, sort_order, difficulty, question, answer_a, answer_b, answer_c, answer_d, correct_answer, point, time, created_at, updated_at" +
		") VALUES (" +
			"@level, @id, @sortOrder, @difficulty, @question, @answerA, @answerB, @answerC, @answerD, @correctAnswer, @point, @time, @createdAt, @updatedAt" +
		")"
	);
	var upsertDifficultySettings = db.prepare(
		"INSERT INTO difficulty_settings (level, difficulty, default_point, default_time, updated_at) " +
		"VALUES (@level, @difficulty, @defaultPoint, @defaultTime, @updatedAt) " +
		"ON CONFLICT(level, difficulty) DO UPDATE SET " +
			"default_point = excluded.default_point, " +
			"default_time = excluded.default_time, " +
			"updated_at = excluded.updated_at"
	);
	var upsertLevelSettings = db.prepare(
		"INSERT INTO level_settings (level, game_speed, updated_at) " +
		"VALUES (@level, @gameSpeed, @updatedAt) " +
		"ON CONFLICT(level) DO UPDATE SET " +
			"game_speed = excluded.game_speed, " +
			"updated_at = excluded.updated_at"
	);

	var seedTransaction = db.transaction(function () {
		QuestionModel.LEVELS.forEach(function (level) {
			var filePath = path.join(rootDir, "questions", level + ".json");
			var rawText = fs.readFileSync(filePath, "utf8");
			var parsedQuestions = JSON.parse(rawText);
			var questions = QuestionModel.validateQuestionsData(parsedQuestions, filePath);
			var now = new Date().toISOString();

			questions.forEach(function (question, index) {
				insertQuestion.run(toQuestionInsertRecord(level, question, index, now, now));
			});

			QuestionModel.getDifficultySummary(questions).forEach(function (item) {
				upsertDifficultySettings.run({
					level: level,
					difficulty: item.difficulty,
					defaultPoint: item.point,
					defaultTime: item.time,
					updatedAt: now
				});
			});

			upsertLevelSettings.run({
				level: level,
				gameSpeed: QuestionModel.GAME_SPEED_DEFAULT,
				updatedAt: now
			});
		});
	});

	seedTransaction();
}

function ensureLevelSettingsRows(db) {
	var now = new Date().toISOString();
	var upsertLevelSettings = db.prepare(
		"INSERT INTO level_settings (level, game_speed, updated_at) " +
		"VALUES (@level, @gameSpeed, @updatedAt) " +
		"ON CONFLICT(level) DO NOTHING"
	);

	var transaction = db.transaction(function () {
		QuestionModel.LEVELS.forEach(function (level) {
			upsertLevelSettings.run({
				level: level,
				gameSpeed: QuestionModel.GAME_SPEED_DEFAULT,
				updatedAt: now
			});
		});
	});

	transaction();
}

function toQuestionInsertRecord(level, question, sortOrder, createdAt, updatedAt) {
	return {
		level: level,
		id: question.id,
		sortOrder: sortOrder,
		difficulty: QuestionModel.normalizeDifficulty(question.difficulty),
		question: question.question,
		answerA: question.answers.A,
		answerB: question.answers.B,
		answerC: question.answers.C || null,
		answerD: question.answers.D || null,
		correctAnswer: question.correctAnswer,
		point: question.point,
		time: question.time,
		createdAt: createdAt,
		updatedAt: updatedAt
	};
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
		point: row.point,
		time: row.time
	};

	if (row.answer_c != null && row.answer_c !== "") {
		question.answers.C = row.answer_c;
	}

	if (row.answer_d != null && row.answer_d !== "") {
		question.answers.D = row.answer_d;
	}

	return QuestionModel.validateQuestion(question, "Database question", 0);
}

function getQuestionsForLevel(db, level) {
	var rows = db.prepare(
		"SELECT id, difficulty, question, answer_a, answer_b, answer_c, answer_d, correct_answer, point, time " +
		"FROM questions WHERE level = ? ORDER BY sort_order ASC, id ASC"
	).all(level);

	return rows.map(mapRowToQuestion);
}

function getStoredSettings(db, level) {
	var rows = db.prepare(
		"SELECT difficulty, default_point, default_time FROM difficulty_settings WHERE level = ?"
	).all(level);
	var pointSettings = {};
	var timeSettings = {};

	rows.forEach(function (row) {
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
}

function getStoredGameSpeed(db, level) {
	var row = db.prepare(
		"SELECT game_speed FROM level_settings WHERE level = ?"
	).get(level);

	if (row == null) {
		return QuestionModel.GAME_SPEED_DEFAULT;
	}

	return QuestionModel.normalizeGameSpeed(row.game_speed);
}

function buildLevelBundle(db, level) {
	var questions = getQuestionsForLevel(db, level);
	var storedSettings = getStoredSettings(db, level);
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
		gameSpeed: getStoredGameSpeed(db, level)
	};
}

function replaceQuestionsForLevel(db, level, questions) {
	var normalizedQuestions = QuestionModel.validateQuestionsData(questions, "Questions for " + level);
	var now = new Date().toISOString();
	var createdAtById = {};
	var insertQuestion = db.prepare(
		"INSERT INTO questions (" +
			"level, id, sort_order, difficulty, question, answer_a, answer_b, answer_c, answer_d, correct_answer, point, time, created_at, updated_at" +
		") VALUES (" +
			"@level, @id, @sortOrder, @difficulty, @question, @answerA, @answerB, @answerC, @answerD, @correctAnswer, @point, @time, @createdAt, @updatedAt" +
		")"
	);

	db.prepare("SELECT id, created_at FROM questions WHERE level = ?").all(level).forEach(function (row) {
		createdAtById[row.id] = row.created_at;
	});

	var replaceTransaction = db.transaction(function () {
		db.prepare("DELETE FROM questions WHERE level = ?").run(level);

		normalizedQuestions.forEach(function (question, index) {
			insertQuestion.run(
				toQuestionInsertRecord(
					level,
					question,
					index,
					createdAtById[question.id] || now,
					now
				)
			);
		});
	});

	replaceTransaction();

	return buildLevelBundle(db, level);
}

function updateDifficultySettingsForAllLevels(db, settings, fieldName, levelToReturn) {
	var normalizedSettings = QuestionModel.normalizeSettings(settings, fieldName);
	var now = new Date().toISOString();
	var upsertStatement;
	var updateQuestionStatement;

	if (fieldName === "point") {
		upsertStatement = db.prepare(
			"INSERT INTO difficulty_settings (level, difficulty, default_point, default_time, updated_at) " +
			"VALUES (@level, @difficulty, @value, NULL, @updatedAt) " +
			"ON CONFLICT(level, difficulty) DO UPDATE SET " +
				"default_point = excluded.default_point, " +
				"updated_at = excluded.updated_at"
		);
		updateQuestionStatement = db.prepare(
			"UPDATE questions SET point = @value, updated_at = @updatedAt WHERE level = @level AND difficulty = @difficulty"
		);
	} else {
		upsertStatement = db.prepare(
			"INSERT INTO difficulty_settings (level, difficulty, default_point, default_time, updated_at) " +
			"VALUES (@level, @difficulty, NULL, @value, @updatedAt) " +
			"ON CONFLICT(level, difficulty) DO UPDATE SET " +
				"default_time = excluded.default_time, " +
				"updated_at = excluded.updated_at"
		);
		updateQuestionStatement = db.prepare(
			"UPDATE questions SET time = @value, updated_at = @updatedAt WHERE level = @level AND difficulty = @difficulty"
		);
	}

	var updateTransaction = db.transaction(function () {
		QuestionModel.LEVELS.forEach(function (level) {
			Object.keys(normalizedSettings).forEach(function (difficulty) {
				var value = normalizedSettings[difficulty];
				var statementValues = {
					level: level,
					difficulty: difficulty,
					value: value,
					updatedAt: now
				};

				upsertStatement.run(statementValues);
				updateQuestionStatement.run(statementValues);
			});
		});
	});

	updateTransaction();

	return buildLevelBundle(db, levelToReturn);
}

function updateGameSpeedForAllLevels(db, value, levelToReturn) {
	var normalizedValue = QuestionModel.normalizeGameSpeed(value);
	var now = new Date().toISOString();

	var upsertStatement = db.prepare(
		"INSERT INTO level_settings (level, game_speed, updated_at) " +
		"VALUES (@level, @gameSpeed, @updatedAt) " +
		"ON CONFLICT(level) DO UPDATE SET " +
			"game_speed = excluded.game_speed, " +
			"updated_at = excluded.updated_at"
	);

	var updateTransaction = db.transaction(function () {
		QuestionModel.LEVELS.forEach(function (level) {
			upsertStatement.run({
				level: level,
				gameSpeed: normalizedValue,
				updatedAt: now
			});
		});
	});

	updateTransaction();

	return buildLevelBundle(db, levelToReturn);
}

module.exports = {
	createDatabase: createDatabase
};
