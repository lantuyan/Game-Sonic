(function (global) {
	"use strict";

	if (global.QuestionModel == null) {
		throw new Error("QuestionModel is required before loading questionBank.js.");
	}

	var QuestionModel = global.QuestionModel;
	var LEVELS = QuestionModel.LEVELS.slice();
	var LEVEL_LABELS = QuestionModel.cloneData(QuestionModel.LEVEL_LABELS);
	var QUESTION_ANSWER_KEYS = QuestionModel.QUESTION_ANSWER_KEYS.slice();
	var DIFFICULTY_ORDER = QuestionModel.DIFFICULTY_ORDER.slice();
	var STORAGE_KEYS = {
		answered: "endlessrunner-question-progress-v1"
	};
	var inMemoryStorage = {};
	var levelBundleCache = {};
	var levelBundlePromiseByLevel = {};

	function cloneData(value) {
		return QuestionModel.cloneData(value);
	}

	function canUseLocalStorage() {
		try {
			var storageKey = "__endlessrunner_storage_test__";
			global.localStorage.setItem(storageKey, storageKey);
			global.localStorage.removeItem(storageKey);
			return true;
		} catch (error) {
			return false;
		}
	}

	var localStorageAvailable = canUseLocalStorage();

	function readStorage(key, fallbackValue) {
		var rawValue;

		try {
			rawValue = localStorageAvailable ? global.localStorage.getItem(key) : inMemoryStorage[key];
		} catch (error) {
			rawValue = inMemoryStorage[key];
		}

		if (typeof rawValue !== "string" || rawValue === "") {
			return cloneData(fallbackValue);
		}

		try {
			return JSON.parse(rawValue);
		} catch (error) {
			return cloneData(fallbackValue);
		}
	}

	function writeStorage(key, value) {
		var serializedValue = JSON.stringify(value);

		try {
			if (localStorageAvailable) {
				global.localStorage.setItem(key, serializedValue);
			}
		} catch (error) {
		}

		inMemoryStorage[key] = serializedValue;
	}

	function createEmptyAnsweredState() {
		return {
			entriesByLevel: {}
		};
	}

	function assertLevel(level) {
		QuestionModel.assertLevel(level);
	}

	function createLevelApiPath(level, suffix) {
		return "/api/levels/" + encodeURIComponent(level) + "/" + suffix;
	}

	function parseJsonResponse(response) {
		return response.text().then(function (responseText) {
			if (responseText.trim() === "") {
				return {};
			}

			try {
				return JSON.parse(responseText);
			} catch (error) {
				throw new Error("Server returned invalid JSON.");
			}
		});
	}

	function fetchJson(url, options) {
		return fetch(url, Object.assign({
			cache: "no-store",
			credentials: "same-origin"
		}, options || {}))
			.then(function (response) {
				return parseJsonResponse(response).then(function (payload) {
					if (response.ok !== true) {
						throw new Error(payload && payload.error ? payload.error : "Request failed (HTTP " + response.status + ").");
					}

					return payload;
				});
			});
	}

	function normalizeSettings(fieldName, settings) {
		return QuestionModel.normalizeSettings(settings || {}, fieldName);
	}

	function normalizeLevelBundle(level, bundle) {
		var normalizedBundle = bundle != null && typeof bundle === "object" ? bundle : {};
		var questions = QuestionModel.validateQuestionsData(normalizedBundle.questions, "Question bank for " + level);
		var pointSettings = normalizeSettings("point", normalizedBundle.pointSettings);
		var timeSettings = normalizeSettings("time", normalizedBundle.timeSettings);
		var gameSpeed = normalizedBundle.gameSpeed == null ? QuestionModel.GAME_SPEED_DEFAULT : QuestionModel.normalizeGameSpeed(normalizedBundle.gameSpeed);

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
	}

	function cacheLevelBundle(level, bundle) {
		levelBundleCache[level] = cloneData(bundle);
		return cloneData(levelBundleCache[level]);
	}

	function requestLevelBundle(level) {
		assertLevel(level);

		return fetchJson(createLevelApiPath(level, "question-bank"))
			.then(function (bundle) {
				return cacheLevelBundle(level, normalizeLevelBundle(level, bundle));
			});
	}

	function getLevelBundle(level, options) {
		assertLevel(level);

		var forceReload = options != null && options.forceReload === true;

		if (forceReload !== true && levelBundleCache[level] != null) {
			return Promise.resolve(cloneData(levelBundleCache[level]));
		}

		if (forceReload === true || levelBundlePromiseByLevel[level] == null) {
			levelBundlePromiseByLevel[level] = requestLevelBundle(level)
				.catch(function (error) {
					delete levelBundlePromiseByLevel[level];
					throw error;
				})
				.then(function (bundle) {
					levelBundlePromiseByLevel[level] = Promise.resolve(cloneData(bundle));
					return bundle;
				});
		}

		return levelBundlePromiseByLevel[level].then(function (bundle) {
			return cloneData(bundle);
		});
	}

	function sendLevelUpdate(level, suffix, payload) {
		assertLevel(level);

		return fetchJson(createLevelApiPath(level, suffix), {
			method: "PUT",
			headers: {
				"Content-Type": "application/json"
			},
			body: JSON.stringify(payload)
		}).then(function (bundle) {
			return cacheLevelBundle(level, normalizeLevelBundle(level, bundle));
		});
	}

	function getQuestions(level) {
		return getLevelBundle(level).then(function (bundle) {
			return cloneData(bundle.questions);
		});
	}

	function saveQuestions(level, questions) {
		var normalizedQuestions = QuestionModel.validateQuestionsData(questions, "Questions for " + level);

		return sendLevelUpdate(level, "questions", {
			questions: normalizedQuestions
		}).then(function (bundle) {
			return cloneData(bundle.questions);
		});
	}

	function restoreBaseQuestions(level) {
		delete levelBundleCache[level];
		delete levelBundlePromiseByLevel[level];
		return getQuestions(level);
	}

	function getAnsweredState() {
		return readStorage(STORAGE_KEYS.answered, createEmptyAnsweredState());
	}

	function saveAnsweredState(state) {
		writeStorage(STORAGE_KEYS.answered, state);
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
			difficulty: QuestionModel.normalizeDifficulty(question.difficulty),
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

	function getCachedBundle(level) {
		assertLevel(level);

		if (levelBundleCache[level] == null) {
			return null;
		}

		return cloneData(levelBundleCache[level]);
	}

	function getTimeSettings(level, questions) {
		assertLevel(level);

		var result = {};
		var cachedBundle = getCachedBundle(level);

		if (cachedBundle != null) {
			Object.keys(cachedBundle.timeSettings).forEach(function (difficulty) {
				result[difficulty] = Number(cachedBundle.timeSettings[difficulty]);
			});
		}

		if (Array.isArray(questions) === true) {
			QuestionModel.getDifficultySummary(questions).forEach(function (item) {
				if (result[item.difficulty] == null || isFinite(result[item.difficulty]) === false || result[item.difficulty] <= 0) {
					result[item.difficulty] = item.time;
				}
			});
		}

		return result;
	}

	function getPointSettings(level, questions) {
		assertLevel(level);

		var result = {};
		var cachedBundle = getCachedBundle(level);

		if (cachedBundle != null) {
			Object.keys(cachedBundle.pointSettings).forEach(function (difficulty) {
				result[difficulty] = Number(cachedBundle.pointSettings[difficulty]);
			});
		}

		if (Array.isArray(questions) === true) {
			QuestionModel.getDifficultySummary(questions).forEach(function (item) {
				if (result[item.difficulty] == null || isFinite(result[item.difficulty]) === false || result[item.difficulty] < 0) {
					result[item.difficulty] = item.point;
				}
			});
		}

		return result;
	}

	function getGameSpeed(level) {
		assertLevel(level);

		var cachedBundle = getCachedBundle(level);
		if (cachedBundle != null && cachedBundle.gameSpeed != null) {
			return QuestionModel.normalizeGameSpeed(cachedBundle.gameSpeed);
		}

		return QuestionModel.GAME_SPEED_DEFAULT;
	}

	function saveTimeSettings(level, settings) {
		return sendLevelUpdate(level, "settings/time", {
			settings: normalizeSettings("time", settings)
		}).then(function (bundle) {
			return cloneData(bundle.timeSettings);
		});
	}

	function savePointSettings(level, settings) {
		return sendLevelUpdate(level, "settings/point", {
			settings: normalizeSettings("point", settings)
		}).then(function (bundle) {
			return cloneData(bundle.pointSettings);
		});
	}

	function saveGameSpeed(level, value) {
		return sendLevelUpdate(level, "settings/speed", {
			value: QuestionModel.normalizeGameSpeed(value)
		}).then(function (bundle) {
			return QuestionModel.normalizeGameSpeed(bundle.gameSpeed);
		});
	}

	function applyTimeSettingsToQuestions(questions, settings) {
		var normalizedSettings = settings || {};

		return questions.map(function (question) {
			var normalizedQuestion = cloneData(question);
			var difficulty = QuestionModel.normalizeDifficulty(normalizedQuestion.difficulty);

			if (normalizedSettings[difficulty] != null) {
				normalizedQuestion.time = QuestionModel.normalizePositiveNumber(normalizedSettings[difficulty], "time", normalizedQuestion.id, 1, true);
			}

			return normalizedQuestion;
		});
	}

	function applyPointSettingsToQuestions(questions, settings) {
		var normalizedSettings = settings || {};

		return questions.map(function (question) {
			var normalizedQuestion = cloneData(question);
			var difficulty = QuestionModel.normalizeDifficulty(normalizedQuestion.difficulty);

			if (normalizedSettings[difficulty] != null) {
				normalizedQuestion.point = QuestionModel.normalizePositiveNumber(normalizedSettings[difficulty], "point", normalizedQuestion.id, 0, false);
			}

			return normalizedQuestion;
		});
	}

	function updateQuestionsTimeByDifficulty(level, settings) {
		return saveTimeSettings(level, settings).then(function () {
			return getQuestions(level);
		});
	}

	function updateQuestionsPointByDifficulty(level, settings) {
		return savePointSettings(level, settings).then(function () {
			return getQuestions(level);
		});
	}

	global.QuestionBank = {
		LEVELS: LEVELS.slice(),
		LEVEL_LABELS: cloneData(LEVEL_LABELS),
		QUESTION_ANSWER_KEYS: QUESTION_ANSWER_KEYS.slice(),
		DIFFICULTY_ORDER: DIFFICULTY_ORDER.slice(),
		GAME_SPEED_MIN: QuestionModel.GAME_SPEED_MIN,
		GAME_SPEED_MAX: QuestionModel.GAME_SPEED_MAX,
		GAME_SPEED_STEP: QuestionModel.GAME_SPEED_STEP,
		GAME_SPEED_DEFAULT: QuestionModel.GAME_SPEED_DEFAULT,
		validateQuestion: QuestionModel.validateQuestion,
		validateQuestionsData: QuestionModel.validateQuestionsData,
		getDifficultySummary: QuestionModel.getDifficultySummary,
		fetchBaseQuestions: getQuestions,
		getLevelBundle: getLevelBundle,
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
		getPointSettings: getPointSettings,
		savePointSettings: savePointSettings,
		getTimeSettings: getTimeSettings,
		saveTimeSettings: saveTimeSettings,
		getGameSpeed: getGameSpeed,
		saveGameSpeed: saveGameSpeed,
		applyPointSettingsToQuestions: applyPointSettingsToQuestions,
		applyTimeSettingsToQuestions: applyTimeSettingsToQuestions,
		updateQuestionsTimeByDifficulty: updateQuestionsTimeByDifficulty,
		updateQuestionsPointByDifficulty: updateQuestionsPointByDifficulty
	};
})(window);
