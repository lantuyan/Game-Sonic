(function (global) {
	"use strict";

	var LEVELS = ["lop6", "lop7", "lop8"];
	var LEVEL_LABELS = {
		lop6: "Lop 6",
		lop7: "Lop 7",
		lop8: "Lop 8"
	};
	var QUESTION_ANSWER_KEYS = ["A", "B", "C", "D"];
	var DIFFICULTY_ORDER = ["easy", "medium", "hard", "expert"];
	var STORAGE_KEYS = {
		questions: "endlessrunner-question-bank-v1",
		answered: "endlessrunner-question-progress-v1",
		timeSettings: "endlessrunner-question-time-settings-v1",
		pointSettings: "endlessrunner-question-point-settings-v1"
	};
	var questionFilesByLevel = {
		lop6: "questions/lop6.json",
		lop7: "questions/lop7.json",
		lop8: "questions/lop8.json"
	};
	var inMemoryStorage = {};
	var baseQuestionsPromiseByLevel = {};

	function cloneData(value) {
		return JSON.parse(JSON.stringify(value));
	}

	function canUseLocalStorage() {
		try {
			var storageKey = "__endlessrunner_storage_test__";
			global.localStorage.setItem(storageKey, storageKey);
			global.localStorage.removeItem(storageKey);
			return true;
		} catch (err) {
			return false;
		}
	}

	var localStorageAvailable = canUseLocalStorage();

	function readStorage(key, fallbackValue) {
		var rawValue;

		try {
			rawValue = localStorageAvailable ? global.localStorage.getItem(key) : inMemoryStorage[key];
		} catch (err) {
			rawValue = inMemoryStorage[key];
		}

		if (typeof rawValue !== "string" || rawValue === "") {
			return cloneData(fallbackValue);
		}

		try {
			return JSON.parse(rawValue);
		} catch (err) {
			return cloneData(fallbackValue);
		}
	}

	function writeStorage(key, value) {
		var serializedValue = JSON.stringify(value);

		try {
			if (localStorageAvailable) {
				global.localStorage.setItem(key, serializedValue);
			}
		} catch (err) {
		}

		inMemoryStorage[key] = serializedValue;
	}

	function createEmptyQuestionsState() {
		return {
			levels: {}
		};
	}

	function createEmptyAnsweredState() {
		return {
			entriesByLevel: {}
		};
	}

	function createEmptyTimeSettingsState() {
		return {
			levels: {}
		};
	}

	function createEmptyPointSettingsState() {
		return {
			levels: {}
		};
	}

	function getQuestionFileForLevel(level) {
		return questionFilesByLevel[level] || null;
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

	function fetchBaseQuestions(level) {
		assertLevel(level);

		if (baseQuestionsPromiseByLevel[level] == null) {
			var questionFile = getQuestionFileForLevel(level);

			baseQuestionsPromiseByLevel[level] = fetch(questionFile, { cache: "no-store" })
				.then(function (response) {
					if (response.ok !== true) {
						throw new Error(questionFile + " could not be loaded (HTTP " + response.status + ").");
					}

					return response.text();
				})
				.then(function (responseText) {
					var trimmedResponseText = responseText.trim();

					if (trimmedResponseText === "") {
						throw new Error(questionFile + " is empty.");
					}

					var parsedQuestions;
					try {
						parsedQuestions = JSON.parse(trimmedResponseText);
					} catch (err) {
						throw new Error(questionFile + " contains invalid JSON.");
					}

					return validateQuestionsData(parsedQuestions, questionFile);
				});
		}

		return baseQuestionsPromiseByLevel[level].then(function (questions) {
			return cloneData(questions);
		});
	}

	function getSavedQuestionsState() {
		return readStorage(STORAGE_KEYS.questions, createEmptyQuestionsState());
	}

	function saveQuestionsState(state) {
		writeStorage(STORAGE_KEYS.questions, state);
	}

	function getAnsweredState() {
		return readStorage(STORAGE_KEYS.answered, createEmptyAnsweredState());
	}

	function saveAnsweredState(state) {
		writeStorage(STORAGE_KEYS.answered, state);
	}

	function getTimeSettingsState() {
		return readStorage(STORAGE_KEYS.timeSettings, createEmptyTimeSettingsState());
	}

	function saveTimeSettingsState(state) {
		writeStorage(STORAGE_KEYS.timeSettings, state);
	}

	function getPointSettingsState() {
		return readStorage(STORAGE_KEYS.pointSettings, createEmptyPointSettingsState());
	}

	function savePointSettingsState(state) {
		writeStorage(STORAGE_KEYS.pointSettings, state);
	}

	function getSavedQuestionsForLevel(level) {
		assertLevel(level);
		var state = getSavedQuestionsState();
		var questions = state.levels[level];

		if (Array.isArray(questions) === false) {
			return null;
		}

		return validateQuestionsData(questions, "Saved questions for " + level);
	}

	function getQuestions(level) {
		var savedQuestions = getSavedQuestionsForLevel(level);

		if (savedQuestions != null) {
			return Promise.resolve(cloneData(savedQuestions));
		}

		return fetchBaseQuestions(level);
	}

	function saveQuestions(level, questions) {
		assertLevel(level);

		var normalizedQuestions = validateQuestionsData(questions, "Questions for " + level);
		var state = getSavedQuestionsState();
		state.levels[level] = normalizedQuestions;
		saveQuestionsState(state);

		return cloneData(normalizedQuestions);
	}

	function restoreBaseQuestions(level) {
		assertLevel(level);

		var state = getSavedQuestionsState();
		delete state.levels[level];
		saveQuestionsState(state);
	}

	function getAnsweredEntriesMap(level) {
		assertLevel(level);
		var state = getAnsweredState();
		var entries = state.entriesByLevel[level];

		if (entries == null || typeof entries !== "object" || Array.isArray(entries) === true) {
			return {};
		}

		return entries;
	}

	function getAnsweredQuestionIds(level) {
		return Object.keys(getAnsweredEntriesMap(level));
	}

	function getAnsweredIdMap(level) {
		var ids = getAnsweredQuestionIds(level);
		var result = {};

		ids.forEach(function (questionId) {
			result[questionId] = true;
		});

		return result;
	}

	function filterAvailableQuestions(level, questions) {
		var answeredIdMap = getAnsweredIdMap(level);

		return questions.filter(function (question) {
			return answeredIdMap[question.id] !== true;
		});
	}

	function markQuestionShown(level, question) {
		assertLevel(level);

		if (question == null || typeof question !== "object") {
			return null;
		}

		var state = getAnsweredState();
		if (state.entriesByLevel[level] == null || typeof state.entriesByLevel[level] !== "object") {
			state.entriesByLevel[level] = {};
		}

		var now = new Date().toISOString();
		var currentEntry = state.entriesByLevel[level][question.id] || {};
		var shownCount = Number(currentEntry.shownCount || 0) + 1;

		state.entriesByLevel[level][question.id] = {
			level: level,
			id: question.id,
			question: question.question,
			difficulty: normalizeDifficulty(question.difficulty),
			firstShownAt: currentEntry.firstShownAt || now,
			lastShownAt: now,
			shownCount: shownCount,
			status: currentEntry.status || "shown",
			lastAnsweredAt: currentEntry.lastAnsweredAt || null
		};
		saveAnsweredState(state);

		return cloneData(state.entriesByLevel[level][question.id]);
	}

	function markQuestionResult(level, questionId, status) {
		assertLevel(level);

		if (typeof questionId !== "string" || questionId.trim() === "") {
			return null;
		}

		var state = getAnsweredState();
		if (state.entriesByLevel[level] == null || typeof state.entriesByLevel[level] !== "object") {
			state.entriesByLevel[level] = {};
		}

		var entry = state.entriesByLevel[level][questionId];
		if (entry == null) {
			entry = {
				level: level,
				id: questionId,
				question: questionId,
				difficulty: "general",
				firstShownAt: null,
				lastShownAt: null,
				shownCount: 0,
				status: "shown",
				lastAnsweredAt: null
			};
		}

		entry.status = String(status || "shown");
		entry.lastAnsweredAt = new Date().toISOString();
		state.entriesByLevel[level][questionId] = entry;
		saveAnsweredState(state);

		return cloneData(entry);
	}

	function getAnsweredEntries(level) {
		var levelEntriesMap;
		var entries = [];

		if (typeof level === "string" && level !== "") {
			levelEntriesMap = getAnsweredEntriesMap(level);
			Object.keys(levelEntriesMap).forEach(function (questionId) {
				entries.push(cloneData(levelEntriesMap[questionId]));
			});
		} else {
			LEVELS.forEach(function (levelName) {
				levelEntriesMap = getAnsweredEntriesMap(levelName);
				Object.keys(levelEntriesMap).forEach(function (questionId) {
					entries.push(cloneData(levelEntriesMap[questionId]));
				});
			});
		}

		entries.sort(function (entryA, entryB) {
			var dateA = String(entryA.lastAnsweredAt || entryA.lastShownAt || "");
			var dateB = String(entryB.lastAnsweredAt || entryB.lastShownAt || "");

			if (dateA === dateB) {
				return String(entryA.id).localeCompare(String(entryB.id));
			}

			return dateA < dateB ? 1 : -1;
		});

		return entries;
	}

	function resetAnsweredQuestions(level) {
		var state = getAnsweredState();

		if (typeof level === "string" && level !== "") {
			assertLevel(level);
			delete state.entriesByLevel[level];
		} else {
			state = createEmptyAnsweredState();
		}

		saveAnsweredState(state);
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

	function getTimeSettings(level, questions) {
		assertLevel(level);

		var state = getTimeSettingsState();
		var savedSettings = state.levels[level];
		var result = {};

		if (savedSettings != null && typeof savedSettings === "object" && Array.isArray(savedSettings) === false) {
			Object.keys(savedSettings).forEach(function (difficulty) {
				result[difficulty] = Number(savedSettings[difficulty]);
			});
		}

		if (Array.isArray(questions) === true) {
			getDifficultySummary(questions).forEach(function (item) {
				if (result[item.difficulty] == null || isFinite(result[item.difficulty]) === false || result[item.difficulty] <= 0) {
					result[item.difficulty] = item.time;
				}
			});
		}

		return result;
	}

	function saveTimeSettings(level, settings) {
		assertLevel(level);

		var normalizedSettings = {};
		Object.keys(settings || {}).forEach(function (difficulty) {
			var normalizedDifficulty = normalizeDifficulty(difficulty);
			normalizedSettings[normalizedDifficulty] = normalizePositiveNumber(settings[difficulty], "time", "time:" + normalizedDifficulty, 1, true);
		});

		var state = getTimeSettingsState();
		state.levels[level] = normalizedSettings;
		saveTimeSettingsState(state);

		return cloneData(normalizedSettings);
	}

	function getPointSettings(level, questions) {
		assertLevel(level);

		var state = getPointSettingsState();
		var savedSettings = state.levels[level];
		var result = {};

		if (savedSettings != null && typeof savedSettings === "object" && Array.isArray(savedSettings) === false) {
			Object.keys(savedSettings).forEach(function (difficulty) {
				result[difficulty] = Number(savedSettings[difficulty]);
			});
		}

		if (Array.isArray(questions) === true) {
			getDifficultySummary(questions).forEach(function (item) {
				if (result[item.difficulty] == null || isFinite(result[item.difficulty]) === false || result[item.difficulty] < 0) {
					result[item.difficulty] = item.point;
				}
			});
		}

		return result;
	}

	function savePointSettings(level, settings) {
		assertLevel(level);

		var normalizedSettings = {};
		Object.keys(settings || {}).forEach(function (difficulty) {
			var normalizedDifficulty = normalizeDifficulty(difficulty);
			normalizedSettings[normalizedDifficulty] = normalizePositiveNumber(settings[difficulty], "point", "point:" + normalizedDifficulty, 0, false);
		});

		var state = getPointSettingsState();
		state.levels[level] = normalizedSettings;
		savePointSettingsState(state);

		return cloneData(normalizedSettings);
	}

	function applyTimeSettingsToQuestions(questions, settings) {
		var normalizedSettings = settings || {};

		return questions.map(function (question) {
			var normalizedQuestion = cloneData(question);
			var difficulty = normalizeDifficulty(normalizedQuestion.difficulty);

			if (normalizedSettings[difficulty] != null) {
				normalizedQuestion.time = normalizePositiveNumber(normalizedSettings[difficulty], "time", normalizedQuestion.id, 1, true);
			}

			return normalizedQuestion;
		});
	}

	function applyPointSettingsToQuestions(questions, settings) {
		var normalizedSettings = settings || {};

		return questions.map(function (question) {
			var normalizedQuestion = cloneData(question);
			var difficulty = normalizeDifficulty(normalizedQuestion.difficulty);

			if (normalizedSettings[difficulty] != null) {
				normalizedQuestion.point = normalizePositiveNumber(normalizedSettings[difficulty], "point", normalizedQuestion.id, 0, false);
			}

			return normalizedQuestion;
		});
	}

	function updateQuestionsTimeByDifficulty(level, settings) {
		return getQuestions(level).then(function (questions) {
			var savedSettings = saveTimeSettings(level, settings);
			var updatedQuestions = applyTimeSettingsToQuestions(questions, savedSettings);
			return saveQuestions(level, updatedQuestions);
		});
	}

	function updateQuestionsPointByDifficulty(level, settings) {
		return getQuestions(level).then(function (questions) {
			var savedSettings = savePointSettings(level, settings);
			var updatedQuestions = applyPointSettingsToQuestions(questions, savedSettings);
			return saveQuestions(level, updatedQuestions);
		});
	}

	global.QuestionBank = {
		LEVELS: LEVELS.slice(),
		LEVEL_LABELS: cloneData(LEVEL_LABELS),
		QUESTION_ANSWER_KEYS: QUESTION_ANSWER_KEYS.slice(),
		DIFFICULTY_ORDER: DIFFICULTY_ORDER.slice(),
		getQuestionFileForLevel: getQuestionFileForLevel,
		validateQuestion: validateQuestion,
		validateQuestionsData: validateQuestionsData,
		fetchBaseQuestions: fetchBaseQuestions,
		getQuestions: getQuestions,
		saveQuestions: saveQuestions,
		restoreBaseQuestions: restoreBaseQuestions,
		getAnsweredQuestionIds: getAnsweredQuestionIds,
		getAnsweredIdMap: getAnsweredIdMap,
		getAnsweredEntries: getAnsweredEntries,
		filterAvailableQuestions: filterAvailableQuestions,
		markQuestionShown: markQuestionShown,
		markQuestionResult: markQuestionResult,
		resetAnsweredQuestions: resetAnsweredQuestions,
		getDifficultySummary: getDifficultySummary,
		getPointSettings: getPointSettings,
		savePointSettings: savePointSettings,
		getTimeSettings: getTimeSettings,
		saveTimeSettings: saveTimeSettings,
		applyPointSettingsToQuestions: applyPointSettingsToQuestions,
		updateQuestionsTimeByDifficulty: updateQuestionsTimeByDifficulty,
		updateQuestionsPointByDifficulty: updateQuestionsPointByDifficulty,
		applyTimeSettingsToQuestions: applyTimeSettingsToQuestions
	};
})(window);
