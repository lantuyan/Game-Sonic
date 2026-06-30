"use strict";

// Question bank store. Pure JavaScript (no native modules, no WASM) so it builds
// and runs anywhere, including Vercel's serverless functions. State is seeded from
// questions/*.json and persisted to a JSON file under the runtime dir. On Vercel
// that dir lives under /tmp, so admin edits survive within a warm instance but are
// re-seeded on a cold start (same behaviour the SQLite version had).

var fs = require("fs");
var path = require("path");
var QuestionModel = require("../shared/questionModel");

function createDatabase(config) {
	var statePath = path.join(config.runtimeDir, "question-bank.json");
	var store = loadStore(config.rootDir, statePath);

	function persist() {
		try {
			fs.mkdirSync(path.dirname(statePath), { recursive: true });
			fs.writeFileSync(statePath, JSON.stringify(store));
		} catch (error) {
			// Persistence is best-effort; the in-memory store stays authoritative.
		}
	}

	return {
		close: function () {},
		getLevelBundle: function (level) {
			QuestionModel.assertLevel(level);
			return buildLevelBundle(store, level);
		},
		replaceQuestionsForLevel: function (level, questions) {
			QuestionModel.assertLevel(level);
			var normalizedQuestions = QuestionModel.validateQuestionsData(questions, "Questions for " + level);
			store.questionsByLevel[level] = normalizedQuestions.map(cloneQuestion);
			persist();
			return buildLevelBundle(store, level);
		},
		updatePointSettingsForLevel: function (level, settings) {
			QuestionModel.assertLevel(level);
			applyDifficultySettings(store, settings, "point");
			persist();
			return buildLevelBundle(store, level);
		},
		updateTimeSettingsForLevel: function (level, settings) {
			QuestionModel.assertLevel(level);
			applyDifficultySettings(store, settings, "time");
			persist();
			return buildLevelBundle(store, level);
		},
		updateGameSpeedForLevel: function (level, value) {
			QuestionModel.assertLevel(level);
			var normalizedValue = QuestionModel.normalizeGameSpeed(value);
			QuestionModel.LEVELS.forEach(function (levelName) {
				store.gameSpeedByLevel[levelName] = normalizedValue;
			});
			persist();
			return buildLevelBundle(store, level);
		}
	};
}

function loadStore(rootDir, statePath) {
	if (fs.existsSync(statePath)) {
		try {
			var saved = JSON.parse(fs.readFileSync(statePath, "utf8"));
			if (isValidStore(saved)) {
				return saved;
			}
		} catch (error) {
			// Fall through to a fresh seed.
		}
	}

	return seedStore(rootDir);
}

function isValidStore(value) {
	return value != null &&
		typeof value === "object" &&
		value.questionsByLevel != null &&
		QuestionModel.LEVELS.every(function (level) {
			return Array.isArray(value.questionsByLevel[level]);
		});
}

function seedStore(rootDir) {
	var store = {
		questionsByLevel: {},
		pointSettingsByLevel: {},
		timeSettingsByLevel: {},
		gameSpeedByLevel: {}
	};

	QuestionModel.LEVELS.forEach(function (level) {
		var filePath = path.join(rootDir, "questions", level + ".json");
		var rawText = fs.readFileSync(filePath, "utf8");
		var questions = QuestionModel.validateQuestionsData(JSON.parse(rawText), filePath);

		store.questionsByLevel[level] = questions.map(cloneQuestion);
		store.pointSettingsByLevel[level] = {};
		store.timeSettingsByLevel[level] = {};

		QuestionModel.getDifficultySummary(questions).forEach(function (item) {
			store.pointSettingsByLevel[level][item.difficulty] = item.point;
			store.timeSettingsByLevel[level][item.difficulty] = item.time;
		});

		store.gameSpeedByLevel[level] = QuestionModel.GAME_SPEED_DEFAULT;
	});

	return store;
}

function cloneQuestion(question) {
	return {
		id: question.id,
		difficulty: QuestionModel.normalizeDifficulty(question.difficulty),
		question: question.question,
		answers: QuestionModel.cloneData(question.answers),
		correctAnswer: question.correctAnswer,
		point: question.point,
		time: question.time
	};
}

function applyDifficultySettings(store, settings, fieldName) {
	var normalizedSettings = QuestionModel.normalizeSettings(settings, fieldName);

	QuestionModel.LEVELS.forEach(function (level) {
		Object.keys(normalizedSettings).forEach(function (difficulty) {
			var value = normalizedSettings[difficulty];

			if (fieldName === "point") {
				store.pointSettingsByLevel[level][difficulty] = value;
			} else {
				store.timeSettingsByLevel[level][difficulty] = value;
			}

			store.questionsByLevel[level].forEach(function (question) {
				if (QuestionModel.normalizeDifficulty(question.difficulty) === difficulty) {
					if (fieldName === "point") {
						question.point = value;
					} else {
						question.time = value;
					}
				}
			});
		});
	});
}

function buildLevelBundle(store, level) {
	var questions = store.questionsByLevel[level].map(function (question) {
		return QuestionModel.validateQuestion(cloneQuestion(question), "Stored question", 0);
	});
	var pointSettings = QuestionModel.cloneData(store.pointSettingsByLevel[level] || {});
	var timeSettings = QuestionModel.cloneData(store.timeSettingsByLevel[level] || {});

	QuestionModel.getDifficultySummary(questions).forEach(function (item) {
		if (pointSettings[item.difficulty] == null) {
			pointSettings[item.difficulty] = item.point;
		}

		if (timeSettings[item.difficulty] == null) {
			timeSettings[item.difficulty] = item.time;
		}
	});

	var gameSpeed = store.gameSpeedByLevel[level];

	return {
		questions: questions,
		pointSettings: pointSettings,
		timeSettings: timeSettings,
		gameSpeed: gameSpeed == null ? QuestionModel.GAME_SPEED_DEFAULT : QuestionModel.normalizeGameSpeed(gameSpeed)
	};
}

module.exports = {
	createDatabase: createDatabase
};
