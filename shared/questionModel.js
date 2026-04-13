(function (root, factory) {
	if (typeof module === "object" && module.exports) {
		module.exports = factory();
		return;
	}

	root.QuestionModel = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
	"use strict";

	var LEVELS = ["lop6", "lop7", "lop8"];
	var LEVEL_LABELS = {
		lop6: "Lop 6",
		lop7: "Lop 7",
		lop8: "Lop 8"
	};
	var QUESTION_ANSWER_KEYS = ["A", "B", "C", "D"];
	var DIFFICULTY_ORDER = ["easy", "medium", "hard", "expert"];

	function cloneData(value) {
		return JSON.parse(JSON.stringify(value));
	}

	function assertLevel(level) {
		if (LEVELS.indexOf(level) === -1) {
			throw new Error("Unknown question level: \"" + level + "\".");
		}
	}

	function normalizeDifficulty(value) {
		var normalizedValue = String(value == null ? "" : value).trim().toLowerCase();

		if (normalizedValue === "") {
			return "general";
		}

		return normalizedValue;
	}

	function normalizePositiveNumber(value, fieldName, questionId, minimumValue, mustBeInteger) {
		var numericValue = Number(value);

		if (isFinite(numericValue) === false || numericValue < minimumValue) {
			throw new Error("Question \"" + questionId + "\" has an invalid \"" + fieldName + "\" value.");
		}

		if (mustBeInteger === true && Math.floor(numericValue) !== numericValue) {
			throw new Error("Question \"" + questionId + "\" must use an integer \"" + fieldName + "\" value.");
		}

		return numericValue;
	}

	function validateQuestion(questionData, sourceLabel, questionIndex) {
		if (questionData == null || typeof questionData !== "object" || Array.isArray(questionData) === true) {
			throw new Error("Question #" + (questionIndex + 1) + " must be an object.");
		}

		var questionId = String(questionData.id || "").trim();
		if (questionId === "") {
			throw new Error("Question #" + (questionIndex + 1) + " is missing a valid \"id\".");
		}

		var questionText = String(questionData.question || "").trim();
		if (questionText === "") {
			throw new Error("Question \"" + questionId + "\" is missing a valid \"question\".");
		}

		if (questionData.answers == null || typeof questionData.answers !== "object" || Array.isArray(questionData.answers) === true) {
			throw new Error("Question \"" + questionId + "\" is missing a valid \"answers\" object.");
		}

		var normalizedAnswers = {};
		var availableAnswers = [];

		QUESTION_ANSWER_KEYS.forEach(function (answerKey, answerIndex) {
			var rawAnswer = Object.prototype.hasOwnProperty.call(questionData.answers, answerKey) ? questionData.answers[answerKey] : "";
			var answerText = String(rawAnswer == null ? "" : rawAnswer).trim();

			if (answerText === "") {
				return;
			}

			if (answerIndex !== availableAnswers.length) {
				throw new Error("Question \"" + questionId + "\" must define answers in order starting from \"A\" without gaps.");
			}

			normalizedAnswers[answerKey] = answerText;
			availableAnswers.push(answerKey);
		});

		if (availableAnswers.length < 2) {
			throw new Error("Question \"" + questionId + "\" must define at least two answers.");
		}

		var correctAnswer = String(questionData.correctAnswer || "").trim().toUpperCase();
		if (availableAnswers.indexOf(correctAnswer) === -1) {
			throw new Error("Question \"" + questionId + "\" has an invalid \"correctAnswer\".");
		}

		return {
			id: questionId,
			difficulty: normalizeDifficulty(questionData.difficulty),
			question: questionText,
			answers: normalizedAnswers,
			availableAnswers: availableAnswers,
			correctAnswer: correctAnswer,
			point: normalizePositiveNumber(questionData.point, "point", questionId, 0, false),
			time: normalizePositiveNumber(questionData.time, "time", questionId, 1, true)
		};
	}

	function validateQuestionsData(data, sourceLabel) {
		if (Array.isArray(data) === false) {
			throw new Error(sourceLabel + " must contain an array of questions.");
		}

		if (data.length === 0) {
			throw new Error(sourceLabel + " is empty.");
		}

		var usedIds = {};
		return data.map(function (questionData, index) {
			var normalizedQuestion = validateQuestion(questionData, sourceLabel, index);

			if (usedIds[normalizedQuestion.id] === true) {
				throw new Error(sourceLabel + " contains a duplicate id: \"" + normalizedQuestion.id + "\".");
			}

			usedIds[normalizedQuestion.id] = true;
			return normalizedQuestion;
		});
	}

	function getDifficultySummary(questions) {
		var summaryMap = {};

		questions.forEach(function (question) {
			var difficulty = normalizeDifficulty(question.difficulty);

			if (summaryMap[difficulty] == null) {
				summaryMap[difficulty] = {
					difficulty: difficulty,
					count: 0,
					time: question.time,
					point: question.point
				};
			}

			summaryMap[difficulty].count += 1;
		});

		var summaryList = Object.keys(summaryMap).map(function (difficultyKey) {
			return summaryMap[difficultyKey];
		});

		summaryList.sort(function (itemA, itemB) {
			var indexA = DIFFICULTY_ORDER.indexOf(itemA.difficulty);
			var indexB = DIFFICULTY_ORDER.indexOf(itemB.difficulty);

			if (indexA === -1 && indexB === -1) {
				return itemA.difficulty.localeCompare(itemB.difficulty);
			}

			if (indexA === -1) {
				return 1;
			}

			if (indexB === -1) {
				return -1;
			}

			return indexA - indexB;
		});

		return summaryList;
	}

	function normalizeSettings(settings, fieldName) {
		var normalizedSettings = {};
		var minimumValue = fieldName === "time" ? 1 : 0;
		var mustBeInteger = fieldName === "time";

		Object.keys(settings || {}).forEach(function (difficulty) {
			var normalizedDifficulty = normalizeDifficulty(difficulty);
			normalizedSettings[normalizedDifficulty] = normalizePositiveNumber(
				settings[difficulty],
				fieldName,
				fieldName + ":" + normalizedDifficulty,
				minimumValue,
				mustBeInteger
			);
		});

		return normalizedSettings;
	}

	return {
		LEVELS: LEVELS.slice(),
		LEVEL_LABELS: cloneData(LEVEL_LABELS),
		QUESTION_ANSWER_KEYS: QUESTION_ANSWER_KEYS.slice(),
		DIFFICULTY_ORDER: DIFFICULTY_ORDER.slice(),
		cloneData: cloneData,
		assertLevel: assertLevel,
		normalizeDifficulty: normalizeDifficulty,
		normalizePositiveNumber: normalizePositiveNumber,
		validateQuestion: validateQuestion,
		validateQuestionsData: validateQuestionsData,
		getDifficultySummary: getDifficultySummary,
		normalizeSettings: normalizeSettings
	};
});
