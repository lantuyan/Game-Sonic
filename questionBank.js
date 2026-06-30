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
	var PLAYER_STORAGE_KEYS = {
		deviceId: "endlessrunner-device-id-v1",
		nickname: "endlessrunner-nickname-v1",
		skill: "endlessrunner-skill-profile-v1"
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

	function readRawString(key) {
		try {
			var value = localStorageAvailable ? global.localStorage.getItem(key) : inMemoryStorage[key];
			return typeof value === "string" ? value : "";
		} catch (error) {
			return typeof inMemoryStorage[key] === "string" ? inMemoryStorage[key] : "";
		}
	}

	function writeRawString(key, value) {
		try {
			if (localStorageAvailable) {
				global.localStorage.setItem(key, value);
			}
		} catch (error) {
		}

		inMemoryStorage[key] = value;
	}

	function generateDeviceId() {
		try {
			if (global.crypto && typeof global.crypto.randomUUID === "function") {
				return global.crypto.randomUUID();
			}
		} catch (error) {
		}

		return "dev-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
	}

	function getDeviceId() {
		var deviceId = readRawString(PLAYER_STORAGE_KEYS.deviceId);

		if (deviceId === "") {
			deviceId = generateDeviceId();
			writeRawString(PLAYER_STORAGE_KEYS.deviceId, deviceId);
		}

		return deviceId;
	}

	function getNickname() {
		return readRawString(PLAYER_STORAGE_KEYS.nickname);
	}

	function setNicknameLocal(name) {
		var trimmed = String(name == null ? "" : name).replace(/\s+/g, " ").trim();

		if (trimmed.length > 24) {
			trimmed = trimmed.slice(0, 24).trim();
		}

		writeRawString(PLAYER_STORAGE_KEYS.nickname, trimmed);
		return trimmed;
	}

	function setNickname(name) {
		var trimmed = setNicknameLocal(name);

		if (trimmed === "") {
			return Promise.resolve(trimmed);
		}

		return fetchJson("/api/players/" + encodeURIComponent(getDeviceId()) + "/nickname", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ nickname: trimmed })
		}).then(function () {
			return trimmed;
		}).catch(function () {
			return trimmed;
		});
	}

	function nonNegativeInteger(value) {
		var numericValue = Math.round(Number(value));
		return isFinite(numericValue) && numericValue > 0 ? numericValue : 0;
	}

	function submitScore(level, stats) {
		assertLevel(level);
		var data = stats || {};
		var payload = {
			deviceId: getDeviceId(),
			nickname: getNickname() || "Người chơi",
			level: level,
			score: nonNegativeInteger(data.score),
			correctCount: nonNegativeInteger(data.correctCount),
			wrongCount: nonNegativeInteger(data.wrongCount),
			timeoutCount: nonNegativeInteger(data.timeoutCount),
			durationMs: nonNegativeInteger(data.durationMs)
		};

		return fetchJson("/api/scores", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload)
		}).catch(function () {
			return null;
		});
	}

	function getLeaderboard(level) {
		assertLevel(level);

		return fetchJson("/api/levels/" + encodeURIComponent(level) + "/leaderboard?deviceId=" + encodeURIComponent(getDeviceId()))
			.catch(function () {
				return { level: level, entries: [], me: null };
			});
	}

	// --- Adaptive skill model (rule-based) ---

	function clampValue(value, lowerBound, upperBound) {
		return Math.min(upperBound, Math.max(lowerBound, value));
	}

	function getSkillState() {
		return readStorage(PLAYER_STORAGE_KEYS.skill, { byLevel: {} });
	}

	function saveSkillState(state) {
		writeStorage(PLAYER_STORAGE_KEYS.skill, state);
	}

	function maxDifficultyIndex() {
		return Math.max(1, DIFFICULTY_ORDER.length - 1);
	}

	function getDefaultSkillProfile() {
		var startIndex = 0.6;

		return {
			targetDifficultyIndex: startIndex,
			skill: startIndex / maxDifficultyIndex(),
			accuracy: null,
			avgAnswerMs: null,
			gamesPlayed: 0,
			updatedAt: null
		};
	}

	function getSkillProfile(level) {
		assertLevel(level);
		var state = getSkillState();
		var stored = state && state.byLevel ? state.byLevel[level] : null;
		var fallback = getDefaultSkillProfile();

		if (stored == null || typeof stored !== "object") {
			return fallback;
		}

		return {
			targetDifficultyIndex: typeof stored.targetDifficultyIndex === "number" ? stored.targetDifficultyIndex : fallback.targetDifficultyIndex,
			skill: typeof stored.skill === "number" ? stored.skill : fallback.skill,
			accuracy: typeof stored.accuracy === "number" ? stored.accuracy : null,
			avgAnswerMs: typeof stored.avgAnswerMs === "number" ? stored.avgAnswerMs : null,
			gamesPlayed: typeof stored.gamesPlayed === "number" ? stored.gamesPlayed : 0,
			updatedAt: stored.updatedAt || null
		};
	}

	function getDifficultyWeights(level) {
		var profile = getSkillProfile(level);
		var target = profile.targetDifficultyIndex;
		var weights = {};

		DIFFICULTY_ORDER.forEach(function (difficulty, index) {
			var distance = index - target;
			weights[difficulty] = Math.exp(-(distance * distance) / 1.2) + 0.05;
		});

		return weights;
	}

	function getAdaptiveSpeedFactor(level) {
		var profile = getSkillProfile(level);
		return clampValue(0.8 + profile.skill * 0.5, 0.7, 1.35);
	}

	function getRecommendedSpeed(level) {
		return clampValue(QuestionModel.GAME_SPEED_DEFAULT * getAdaptiveSpeedFactor(level), QuestionModel.GAME_SPEED_MIN, QuestionModel.GAME_SPEED_MAX);
	}

	function orderQuestionsBySkill(level, questionList) {
		assertLevel(level);

		if (Array.isArray(questionList) === false || questionList.length === 0) {
			return [];
		}

		var weights = getDifficultyWeights(level);

		// Efraimidis-Spirakis weighted shuffle: key = rand^(1/weight). Sorting
		// ascending puts the largest keys (higher-weight, closer to the target
		// difficulty) last, and the game pops questions from the end first.
		return questionList.map(function (question) {
			var difficulty = QuestionModel.normalizeDifficulty(question.difficulty);
			var weight = weights[difficulty] != null ? weights[difficulty] : 0.2;

			if (weight <= 0) {
				weight = 0.0001;
			}

			return { question: question, key: Math.pow(Math.random(), 1 / weight) };
		}).sort(function (left, right) {
			return left.key - right.key;
		}).map(function (item) {
			return item.question;
		});
	}

	function syncSkillProfile(level, profile) {
		assertLevel(level);
		var resolvedProfile = profile || getSkillProfile(level);

		return fetchJson("/api/players/" + encodeURIComponent(getDeviceId()) + "/skill", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				level: level,
				skill: resolvedProfile.skill,
				accuracy: resolvedProfile.accuracy,
				avgAnswerMs: resolvedProfile.avgAnswerMs,
				recommendedSpeed: getRecommendedSpeed(level),
				difficultyWeights: getDifficultyWeights(level),
				gamesPlayed: resolvedProfile.gamesPlayed
			})
		}).catch(function () {
			return null;
		});
	}

	function updateSkillProfileAfterGame(level, session) {
		assertLevel(level);
		var data = session || {};
		var correct = nonNegativeInteger(data.correct);
		var wrong = nonNegativeInteger(data.wrong);
		var timeout = nonNegativeInteger(data.timeout);
		var total = correct + wrong + timeout;
		var profile = getSkillProfile(level);

		if (total > 0) {
			var accuracy = correct / total;
			var target = profile.targetDifficultyIndex;

			if (accuracy >= 0.8) {
				target += 0.4;
			} else if (accuracy <= 0.5) {
				target -= 0.5;
			}

			target = clampValue(target, 0, maxDifficultyIndex());

			var previousAccuracy = typeof profile.accuracy === "number" ? profile.accuracy : accuracy;
			var smoothedAccuracy = previousAccuracy * 0.6 + accuracy * 0.4;

			var durationMs = nonNegativeInteger(data.durationMs);
			var averageMs = durationMs > 0 ? Math.round(durationMs / total) : null;
			var previousMs = typeof profile.avgAnswerMs === "number" ? profile.avgAnswerMs : averageMs;
			var smoothedMs = averageMs != null && previousMs != null ? Math.round(previousMs * 0.6 + averageMs * 0.4) : averageMs;

			profile = {
				targetDifficultyIndex: target,
				skill: clampValue(target / maxDifficultyIndex(), 0, 1),
				accuracy: smoothedAccuracy,
				avgAnswerMs: smoothedMs,
				gamesPlayed: profile.gamesPlayed + 1,
				updatedAt: new Date().toISOString()
			};

			var state = getSkillState();

			if (state.byLevel == null) {
				state.byLevel = {};
			}

			state.byLevel[level] = profile;
			saveSkillState(state);
		}

		syncSkillProfile(level, profile);
		return profile;
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
		updateQuestionsPointByDifficulty: updateQuestionsPointByDifficulty,
		getDeviceId: getDeviceId,
		getNickname: getNickname,
		setNickname: setNickname,
		setNicknameLocal: setNicknameLocal,
		submitScore: submitScore,
		getLeaderboard: getLeaderboard,
		getSkillProfile: getSkillProfile,
		getDifficultyWeights: getDifficultyWeights,
		getAdaptiveSpeedFactor: getAdaptiveSpeedFactor,
		getRecommendedSpeed: getRecommendedSpeed,
		orderQuestionsBySkill: orderQuestionsBySkill,
		updateSkillProfileAfterGame: updateSkillProfileAfterGame,
		syncSkillProfile: syncSkillProfile
	};
})(window);
