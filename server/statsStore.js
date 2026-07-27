"use strict";

// Dashboard giáo viên (P1-6) — ghi `answer_events` và tổng hợp số liệu.
//
// Tách khỏi playerStore.js vì hai thứ khác nhau về bản chất: playerStore phục vụ
// NGƯỜI CHƠI (bảng xếp hạng, hồ sơ kỹ năng), còn file này phục vụ GIÁO VIÊN (câu
// nào lớp làm sai nhiều nhất). Gộp chung thì mỗi lần sửa dashboard lại phải đọc
// hiểu cả phần leaderboard.
//
// Nguyên tắc: MỘT request cho cả ván (`POST /api/runs/summary`), không phải một
// request mỗi câu. Ở phòng máy trường, 30 em × 10 câu = 300 request đồng thời chỉ
// để ghi log là cách nhanh nhất để tự làm sập chính mình.

var QuestionModel = require("../shared/questionModel");

var MAX_ANSWERS_PER_RUN = 60;
var MAX_ANSWER_MS = 600000;
var OUTCOMES = ["correct", "wrong", "timeout"];
var MODES = ["gate", "modal"];

function badRequest(message) {
	var error = new Error(message);
	error.statusCode = 400;
	return error;
}

function normalizeAnswer(entry, level) {
	var data = entry != null && typeof entry === "object" ? entry : {};
	var questionId = String(data.questionId == null ? "" : data.questionId).trim();

	if (questionId === "" || questionId.length > 120) {
		return null;
	}

	var outcome = String(data.outcome == null ? "" : data.outcome);

	if (OUTCOMES.indexOf(outcome) === -1) {
		return null;
	}

	var answerMs = Number(data.answerMs);
	var mode = String(data.mode == null ? "" : data.mode);
	var difficulty = String(data.difficulty == null ? "" : data.difficulty);

	return {
		level: level,
		questionId: questionId,
		outcome: outcome,
		answerMs: isFinite(answerMs) && answerMs >= 0 ? Math.min(Math.round(answerMs), MAX_ANSWER_MS) : null,
		mode: MODES.indexOf(mode) === -1 ? null : mode,
		difficulty: QuestionModel.DIFFICULTY_ORDER.indexOf(difficulty) === -1 ? null : difficulty
	};
}

/** Khi chưa có CSDL thì dashboard "tắt êm" y như leaderboard (docs/v2/A3). */
function createDisabledStatsStore() {
	return {
		recordRunSummary: function () {
			return Promise.resolve({ recorded: 0, disabled: true });
		},
		getStats: function () {
			return Promise.resolve({
				runsByDay: [],
				accuracyByLevel: [],
				accuracyByDifficulty: [],
				topWrongQuestions: [],
				skillDistribution: [],
				totals: { answers: 0, correct: 0, devices: 0 },
				disabled: true
			});
		}
	};
}

function createStatsStore(options) {
	var sql = options && options.sql ? options.sql : null;
	var ready = options && typeof options.ready === "function" ? options.ready : function () {
		return Promise.resolve();
	};

	if (sql == null) {
		return createDisabledStatsStore();
	}

	function run(text, params) {
		return ready().then(function () {
			return sql.query(text, params || []);
		});
	}

	/**
	 * Ghi cả ván trong MỘT lần gọi.
	 *
	 * Câu lỗi định dạng bị BỎ QUA chứ không làm hỏng cả mẻ: đây là log học tập, mất
	 * một dòng không sao, còn 400 cả ván thì mất sạch dữ liệu của em đó.
	 */
	function recordRunSummary(payload) {
		var data = payload || {};
		var deviceId = String(data.deviceId == null ? "" : data.deviceId).trim();

		if (deviceId === "" || deviceId.length > 64) {
			throw badRequest("A valid deviceId is required.");
		}

		try {
			QuestionModel.assertLevel(data.level);
		} catch (error) {
			throw badRequest(error.message);
		}

		var runId = data.runId != null ? String(data.runId).slice(0, 64) : null;
		var answers = Array.isArray(data.answers) ? data.answers.slice(0, MAX_ANSWERS_PER_RUN) : [];
		var rows = answers
			.map(function (entry) {
				return normalizeAnswer(entry, data.level);
			})
			.filter(Boolean);

		if (rows.length === 0) {
			return Promise.resolve({ recorded: 0 });
		}

		return ready().then(function () {
			return sql.batch(
				rows.map(function (row) {
					return {
						text:
							"INSERT INTO answer_events (device_id, level, question_id, outcome, answer_ms, mode, difficulty, run_id) " +
							"VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
						params: [deviceId, row.level, row.questionId, row.outcome, row.answerMs, row.mode, row.difficulty, runId]
					};
				})
			);
		}).then(function () {
			return { recorded: rows.length };
		});
	}

	/** Mệnh đề WHERE dùng chung cho mọi truy vấn thống kê. */
	function buildFilter(filters) {
		var conditions = [];
		var params = [];

		if (filters.level != null && String(filters.level).trim() !== "") {
			QuestionModel.assertLevel(filters.level);
			params.push(filters.level);
			conditions.push("level = $" + params.length);
		}

		if (filters.from != null && String(filters.from).trim() !== "") {
			params.push(String(filters.from));
			conditions.push("created_at >= $" + params.length + "::timestamptz");
		}

		if (filters.to != null && String(filters.to).trim() !== "") {
			params.push(String(filters.to));
			// `+ 1 day` để "đến ngày 27" bao gồm cả ngày 27, đúng cách giáo viên hiểu.
			conditions.push("created_at < ($" + params.length + "::timestamptz + interval '1 day')");
		}

		return {
			where: conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "",
			params: params
		};
	}

	function getStats(filters) {
		var filter = buildFilter(filters || {});
		var where = filter.where;
		var params = filter.params;

		var runsByDay = run(
			"SELECT to_char(created_at, 'YYYY-MM-DD') AS day, " +
				"COUNT(DISTINCT COALESCE(run_id, device_id || to_char(created_at, 'YYYYMMDDHH24MI'))) AS runs, " +
				"COUNT(*) AS answers " +
			"FROM answer_events" + where + " GROUP BY day ORDER BY day ASC",
			params
		);

		var accuracyByLevel = run(
			"SELECT level, COUNT(*) AS total, " +
				"SUM(CASE WHEN outcome = 'correct' THEN 1 ELSE 0 END) AS correct " +
			"FROM answer_events" + where + " GROUP BY level ORDER BY level ASC",
			params
		);

		var accuracyByDifficulty = run(
			"SELECT COALESCE(difficulty, 'khác') AS difficulty, COUNT(*) AS total, " +
				"SUM(CASE WHEN outcome = 'correct' THEN 1 ELSE 0 END) AS correct " +
			"FROM answer_events" + where + " GROUP BY difficulty ORDER BY total DESC",
			params
		);

		// TOP 10 CÂU SAI NHIỀU NHẤT — con số giáo viên thực sự dùng để dạy lại.
		// Lọc `total >= 3` để một câu bị sai đúng 1 lần không leo lên đầu bảng.
		var topWrong = run(
			"SELECT question_id, level, COUNT(*) AS total, " +
				"SUM(CASE WHEN outcome <> 'correct' THEN 1 ELSE 0 END) AS wrong " +
			"FROM answer_events" + where + " GROUP BY question_id, level " +
			"HAVING COUNT(*) >= 3 " +
			"ORDER BY (SUM(CASE WHEN outcome <> 'correct' THEN 1 ELSE 0 END)::float / COUNT(*)) DESC, wrong DESC " +
			"LIMIT 10",
			params
		);

		// Phân bố skill lấy từ `skill_profiles` (không lọc theo thời gian — đó là
		// trạng thái HIỆN TẠI của từng em, không phải sự kiện).
		var skillParams = [];
		var skillWhere = "";

		if (filters != null && filters.level != null && String(filters.level).trim() !== "") {
			skillParams.push(filters.level);
			skillWhere = " WHERE level = $1";
		}

		var skillDistribution = run(
			"SELECT width_bucket(skill, 0, 1, 5) AS bucket, COUNT(*) AS players " +
			"FROM skill_profiles" + skillWhere + " GROUP BY bucket ORDER BY bucket ASC",
			skillParams
		);

		var totals = run(
			"SELECT COUNT(*) AS answers, " +
				"SUM(CASE WHEN outcome = 'correct' THEN 1 ELSE 0 END) AS correct, " +
				"COUNT(DISTINCT device_id) AS devices " +
			"FROM answer_events" + where,
			params
		);

		return Promise.all([runsByDay, accuracyByLevel, accuracyByDifficulty, topWrong, skillDistribution, totals])
			.then(function (parts) {
				var totalRow = parts[5].rows[0] || {};

				return {
					runsByDay: parts[0].rows.map(function (row) {
						return { day: row.day, runs: Number(row.runs), answers: Number(row.answers) };
					}),
					accuracyByLevel: parts[1].rows.map(toAccuracyRow("level")),
					accuracyByDifficulty: parts[2].rows.map(toAccuracyRow("difficulty")),
					topWrongQuestions: parts[3].rows.map(function (row) {
						var total = Number(row.total);
						var wrong = Number(row.wrong);

						return {
							questionId: row.question_id,
							level: row.level,
							total: total,
							wrong: wrong,
							wrongRate: total > 0 ? wrong / total : 0
						};
					}),
					skillDistribution: parts[4].rows.map(function (row) {
						return { bucket: Number(row.bucket), players: Number(row.players) };
					}),
					totals: {
						answers: Number(totalRow.answers || 0),
						correct: Number(totalRow.correct || 0),
						devices: Number(totalRow.devices || 0)
					}
				};
			});
	}

	function toAccuracyRow(key) {
		return function (row) {
			var total = Number(row.total);
			var correct = Number(row.correct);

			return {
				key: row[key],
				total: total,
				correct: correct,
				accuracy: total > 0 ? correct / total : 0
			};
		};
	}

	return {
		recordRunSummary: recordRunSummary,
		getStats: getStats
	};
}

/**
 * CSV cho Excel. **BOM UTF-8 là bắt buộc** — thiếu nó thì Excel bản Windows đọc
 * file như CP-1252 và mọi dấu tiếng Việt vỡ thành ký tự lạ (DoD P1-6).
 */
function statsToCsv(stats) {
	var lines = [];

	function escapeCell(value) {
		var text = String(value == null ? "" : value);
		return /[",\n;]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
	}

	function section(title, header, rows) {
		lines.push(escapeCell(title));
		lines.push(header.map(escapeCell).join(","));

		rows.forEach(function (row) {
			lines.push(row.map(escapeCell).join(","));
		});

		lines.push("");
	}

	section("Tổng quan", ["Số câu trả lời", "Số câu đúng", "Số máy"], [
		[stats.totals.answers, stats.totals.correct, stats.totals.devices]
	]);

	section("Số ván theo ngày", ["Ngày", "Số ván", "Số câu"], stats.runsByDay.map(function (row) {
		return [row.day, row.runs, row.answers];
	}));

	section("Độ chính xác theo lớp", ["Lớp", "Tổng", "Đúng", "Tỉ lệ đúng"], stats.accuracyByLevel.map(function (row) {
		return [row.key, row.total, row.correct, formatPercent(row.accuracy)];
	}));

	section("Độ chính xác theo độ khó", ["Độ khó", "Tổng", "Đúng", "Tỉ lệ đúng"], stats.accuracyByDifficulty.map(function (row) {
		return [row.key, row.total, row.correct, formatPercent(row.accuracy)];
	}));

	section("Top câu sai nhiều nhất", ["Mã câu", "Lớp", "Lượt gặp", "Lượt sai", "Tỉ lệ sai"], stats.topWrongQuestions.map(function (row) {
		return [row.questionId, row.level, row.total, row.wrong, formatPercent(row.wrongRate)];
	}));

	return "﻿" + lines.join("\r\n");
}

function formatPercent(value) {
	return Math.round(Number(value || 0) * 100) + "%";
}

module.exports = {
	createStatsStore: createStatsStore,
	statsToCsv: statsToCsv,
	MAX_ANSWERS_PER_RUN: MAX_ANSWERS_PER_RUN
};
