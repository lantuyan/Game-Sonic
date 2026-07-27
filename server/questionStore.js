"use strict";

// Ngân hàng câu hỏi trên Postgres (P1-7).
//
// CÙNG MỘT GIAO DIỆN với kho JSON trong `server/db.js` — cùng 6 phương thức, cùng
// shape trả về. Nhờ vậy `server/app.js` không cần biết đang chạy trên kho nào, và
// contract-test xanh nguyên trạng (DoD P1-7: "API surface không đổi").
//
// Vì sao cần: kho JSON sống trong `/tmp` của instance serverless, nên giáo viên
// sửa đề xong mà instance bị thu hồi (hoặc deploy lại) là mất hết. Với Neon thì
// sửa một lần là còn mãi.
//
// KHÔNG dùng khi thiếu `DATABASE_URL`: dev offline và test giữ nguyên kho JSON
// (DoD P1-7). Xem `server/db.js` để biết chỗ chọn.

var fs = require("fs");
var path = require("path");
var QuestionModel = require("../shared/questionModel");
var applySchema = require("./schema").applySchema;

function createQuestionStore(options) {
	var sql = options && options.sql ? options.sql : null;
	var rootDir = options && options.rootDir ? options.rootDir : path.resolve(__dirname, "..");

	if (sql == null) {
		throw new Error("createQuestionStore requires a SQL client.");
	}

	// Chuỗi khởi tạo chạy MỘT lần: áp schema rồi gieo hạt nếu bảng còn rỗng.
	var readyPromise = applySchema(sql).then(function () {
		return seedIfEmpty(sql, rootDir);
	});

	function ready() {
		return readyPromise;
	}

	function run(text, params) {
		return ready().then(function () {
			return sql.query(text, params || []);
		});
	}

	function getLevelBundle(level) {
		QuestionModel.assertLevel(level);

		return Promise.all([
			run("SELECT * FROM questions WHERE level = $1 ORDER BY position ASC, id ASC", [level]),
			run("SELECT * FROM level_settings WHERE level = $1", [level])
		]).then(function (parts) {
			return buildBundle(parts[0].rows, parts[1].rows[0]);
		});
	}

	/**
	 * Thay TOÀN BỘ câu hỏi của một lớp.
	 *
	 * Xoá rồi chèn lại trong MỘT transaction: nửa chừng đứt mạng mà chỉ xoá xong
	 * thì lớp đó mất sạch đề — không được phép xảy ra.
	 */
	function replaceQuestionsForLevel(level, questions) {
		QuestionModel.assertLevel(level);
		var normalized = QuestionModel.validateQuestionsData(questions, "Questions for " + level);

		return ready().then(function () {
			var statements = [{ text: "DELETE FROM questions WHERE level = $1", params: [level] }];

			normalized.forEach(function (question, index) {
				statements.push(insertStatement(level, question, index));
			});

			return sql.batch(statements);
		}).then(function () {
			return getLevelBundle(level);
		});
	}

	/**
	 * Điểm/thời gian áp cho MỌI lớp — giữ đúng hành vi của V1 và của kho JSON.
	 * (Khác `quizMode`, thứ cố ý lưu riêng từng lớp — xem P0-14.)
	 */
	function updateDifficultySettings(level, settings, fieldName) {
		QuestionModel.assertLevel(level);
		var normalized = QuestionModel.normalizeSettings(settings, fieldName);
		var column = fieldName === "point" ? "point_settings" : "time_settings";
		var questionColumn = fieldName === "point" ? "point" : "time";

		return ready().then(function () {
			var statements = [];

			QuestionModel.LEVELS.forEach(function (levelName) {
				statements.push({
					text:
						"INSERT INTO level_settings (level, " + column + ", updated_at) VALUES ($1, $2::jsonb, now()) " +
						"ON CONFLICT (level) DO UPDATE SET " + column + " = level_settings." + column + " || EXCLUDED." + column + ", updated_at = now()",
					params: [levelName, JSON.stringify(normalized)]
				});

				Object.keys(normalized).forEach(function (difficulty) {
					statements.push({
						text: "UPDATE questions SET " + questionColumn + " = $3, updated_at = now() WHERE level = $1 AND difficulty = $2",
						params: [levelName, difficulty, normalized[difficulty]]
					});
				});
			});

			return sql.batch(statements);
		}).then(function () {
			return getLevelBundle(level);
		});
	}

	function updateGameSpeedForLevel(level, value) {
		QuestionModel.assertLevel(level);
		var normalized = QuestionModel.normalizeGameSpeed(value);

		return ready().then(function () {
			// Tốc độ áp cho MỌI lớp (hợp đồng §7.3.4, giống kho JSON).
			return sql.batch(QuestionModel.LEVELS.map(function (levelName) {
				return {
					text:
						"INSERT INTO level_settings (level, game_speed, updated_at) VALUES ($1,$2,now()) " +
						"ON CONFLICT (level) DO UPDATE SET game_speed = EXCLUDED.game_speed, updated_at = now()",
					params: [levelName, normalized]
				};
			}));
		}).then(function () {
			return getLevelBundle(level);
		});
	}

	/** ⚠ CHỈ lớp được chỉ định — cố ý khác `updateGameSpeedForLevel` (P0-14). */
	function updateQuizModeForLevel(level, value) {
		QuestionModel.assertLevel(level);
		var normalized = QuestionModel.normalizeQuizMode(value);

		return run(
			"INSERT INTO level_settings (level, quiz_mode, updated_at) VALUES ($1,$2,now()) " +
			"ON CONFLICT (level) DO UPDATE SET quiz_mode = EXCLUDED.quiz_mode, updated_at = now()",
			[level, normalized]
		).then(function () {
			return getLevelBundle(level);
		});
	}

	/**
	 * Mọi phương thức trả về Promise, nên lỗi kiểm tra đầu vào cũng phải là
	 * REJECT chứ không phải throw đồng bộ. Giao diện nửa-đồng-bộ-nửa-bất-đồng-bộ là
	 * cái bẫy kinh điển: người gọi dùng `.catch()` sẽ để lọt đúng những lỗi hay gặp
	 * nhất (lớp sai, đề không hợp lệ).
	 */
	function guard(fn) {
		return function () {
			var args = arguments;

			return Promise.resolve().then(function () {
				return fn.apply(null, args);
			});
		};
	}

	return {
		kind: "postgres",
		close: function () {},
		ready: ready,
		getLevelBundle: guard(getLevelBundle),
		replaceQuestionsForLevel: guard(replaceQuestionsForLevel),
		updatePointSettingsForLevel: guard(function (level, settings) {
			return updateDifficultySettings(level, settings, "point");
		}),
		updateTimeSettingsForLevel: guard(function (level, settings) {
			return updateDifficultySettings(level, settings, "time");
		}),
		updateGameSpeedForLevel: guard(updateGameSpeedForLevel),
		updateQuizModeForLevel: guard(updateQuizModeForLevel)
	};
}

/**
 * @param {boolean} [ignoreConflict] chỉ bật cho bước GIEO HẠT.
 *
 * Vì sao chỉ ở đó: hai instance serverless khởi động cùng lúc trên một CSDL Neon
 * còn rỗng sẽ cùng thấy `COUNT(*) = 0` và cùng gieo — thằng chậm hơn nổ
 * "duplicate key" rồi làm hỏng cả lượt khởi động. Với `replaceQuestionsForLevel`
 * thì NGƯỢC LẠI: trùng id là lỗi thật của bộ đề, giáo viên phải được báo.
 */
function insertStatement(level, question, position, ignoreConflict) {
	var explanation = QuestionModel.normalizeExplanation(question.explanation, question.id);

	return {
		text:
			"INSERT INTO questions (level, id, difficulty, question, answers, correct_answer, point, time, explanation, position) " +
			"VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)" +
			(ignoreConflict === true ? " ON CONFLICT (level, id) DO NOTHING" : ""),
		params: [
			level,
			question.id,
			QuestionModel.normalizeDifficulty(question.difficulty),
			question.question,
			JSON.stringify(question.answers),
			question.correctAnswer,
			question.point,
			question.time,
			explanation === "" ? null : explanation,
			position
		]
	};
}

/**
 * Gieo hạt từ `questions/*.json` CHỈ KHI bảng còn rỗng (idempotent — DoD P1-7).
 *
 * Kiểm theo TỪNG LỚP chứ không kiểm tổng: thêm lớp 9 ở P2 thì lớp mới được gieo
 * mà 3 lớp cũ (giáo viên đã sửa) không bị đụng tới.
 */
function seedIfEmpty(sql, rootDir) {
	return QuestionModel.LEVELS.reduce(function (chain, level) {
		return chain.then(function () {
			return sql.query("SELECT COUNT(*)::int AS total FROM questions WHERE level = $1", [level]);
		}).then(function (result) {
			var total = result.rows[0] ? Number(result.rows[0].total) : 0;

			if (total > 0) {
				return null;
			}

			var filePath = path.join(rootDir, "questions", level + ".json");
			var questions = QuestionModel.validateQuestionsData(
				JSON.parse(fs.readFileSync(filePath, "utf8")),
				filePath
			);

			var statements = questions.map(function (question, index) {
				return insertStatement(level, question, index, true);
			});

			var pointSettings = {};
			var timeSettings = {};

			QuestionModel.getDifficultySummary(questions).forEach(function (item) {
				pointSettings[item.difficulty] = item.point;
				timeSettings[item.difficulty] = item.time;
			});

			statements.push({
				text:
					"INSERT INTO level_settings (level, point_settings, time_settings, game_speed, quiz_mode) " +
					"VALUES ($1,$2::jsonb,$3::jsonb,$4,$5) ON CONFLICT (level) DO NOTHING",
				params: [
					level,
					JSON.stringify(pointSettings),
					JSON.stringify(timeSettings),
					QuestionModel.GAME_SPEED_DEFAULT,
					QuestionModel.QUIZ_MODE_DEFAULT
				]
			});

			return sql.batch(statements);
		});
	}, Promise.resolve());
}

/** Dựng bundle ĐÚNG shape mà kho JSON trả về (hợp đồng §7.3.1). */
function buildBundle(rows, settingsRow) {
	var questions = rows.map(function (row) {
		var question = {
			id: row.id,
			difficulty: QuestionModel.normalizeDifficulty(row.difficulty),
			question: row.question,
			answers: typeof row.answers === "string" ? JSON.parse(row.answers) : QuestionModel.cloneData(row.answers),
			correctAnswer: row.correct_answer,
			point: Number(row.point),
			time: Number(row.time)
		};

		// Lời giải chỉ có mặt khi thật sự có nội dung — giữ shape câu cũ (P0-14).
		var explanation = QuestionModel.normalizeExplanation(row.explanation, row.id);

		if (explanation !== "") {
			question.explanation = explanation;
		}

		return QuestionModel.validateQuestion(question, "Stored question", 0);
	});

	var settings = settingsRow || {};
	var pointSettings = parseJsonColumn(settings.point_settings);
	var timeSettings = parseJsonColumn(settings.time_settings);

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
		gameSpeed:
			settings.game_speed == null
				? QuestionModel.GAME_SPEED_DEFAULT
				: QuestionModel.normalizeGameSpeed(settings.game_speed),
		quizMode: QuestionModel.normalizeQuizMode(settings.quiz_mode)
	};
}

function parseJsonColumn(value) {
	if (value == null) {
		return {};
	}

	if (typeof value === "string") {
		try {
			return JSON.parse(value);
		} catch (error) {
			return {};
		}
	}

	return QuestionModel.cloneData(value);
}

module.exports = {
	createQuestionStore: createQuestionStore
};
