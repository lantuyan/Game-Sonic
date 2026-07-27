"use strict";

// P1-7 — NGÂN HÀNG CÂU HỎI TRÊN POSTGRES.
//
// DoD: trên preview có Neon, admin sửa câu → redeploy/cold-start → chỉnh sửa còn
// nguyên; không có DATABASE_URL → hành vi như hiện tại; full test xanh.
//
// "Redeploy/cold-start" ở đây được mô phỏng bằng cách DỰNG LẠI store từ đầu trên
// cùng CSDL — đó chính xác là điều xảy ra khi instance serverless bị thu hồi.
// Chạy trên PGlite thật; PGlite và Neon nói cùng một phương ngữ Postgres.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");
var QuestionModel = require("../shared/questionModel");
var createQuestionStore = require("../server/questionStore").createQuestionStore;
var pgTempDir = require("../test-helpers/pgTempDir");
var createSqlClient = require("../server/sql").createSqlClient;
var applySchema = require("../server/schema").applySchema;

var rootDir = path.resolve(__dirname, "..");

// Một PGlite dùng chung cho cả file — xem ghi chú ở test/anticheat.test.js về việc
// mỗi instance là một cluster Postgres vài chục MB.
var sharedTempDir = pgTempDir.createTempDir("question-store-");
var sql = createSqlClient({ pgDataDir: path.join(sharedTempDir, "pgdata"), databaseUrl: "" });

async function freshStore() {
	await applySchema(sql);
	await sql.query("DELETE FROM questions", []);
	await sql.query("DELETE FROM level_settings", []);

	var store = createQuestionStore({ sql: sql, rootDir: rootDir });
	// PHẢI đợi gieo hạt xong. Bỏ lửng thì test nào chỉ gọi phương thức ném lỗi sớm
	// (vd lớp sai) sẽ kết thúc trong lúc gieo vẫn đang chạy, và giẫm vào test sau.
	await store.ready();
	return store;
}

/** Store MỚI trên CÙNG CSDL — mô phỏng cold-start của serverless. */
function restartStore() {
	return createQuestionStore({ sql: sql, rootDir: rootDir });
}

test("gieo hạt từ questions/*.json khi bảng rỗng, và bundle đúng shape hợp đồng", async function () {
	var store = await freshStore();
	var bundle = await store.getLevelBundle("lop6");

	assert.ok(Array.isArray(bundle.questions));
	assert.ok(bundle.questions.length > 0, "phải gieo được đề lớp 6");

	// Shape phải TRÙNG hợp đồng §7.3.1 — client V2 và V1 đều đọc đúng các khoá này.
	assert.deepEqual(
		Object.keys(bundle).sort(),
		["gameSpeed", "pointSettings", "questions", "quizMode", "timeSettings"]
	);

	var question = bundle.questions[0];
	["id", "difficulty", "question", "answers", "availableAnswers", "correctAnswer", "point", "time"].forEach(
		function (key) {
			assert.ok(question[key] !== undefined, "câu hỏi thiếu khoá " + key);
		}
	);

	assert.equal(bundle.quizMode, QuestionModel.QUIZ_MODE_DEFAULT);
	assert.equal(bundle.gameSpeed, QuestionModel.GAME_SPEED_DEFAULT);
});

test("gieo hạt IDEMPOTENT — chạy lại KHÔNG ghi đè đề giáo viên đã sửa (DoD)", async function () {
	var store = await freshStore();
	var seeded = await store.getLevelBundle("lop6");

	// Giáo viên thay toàn bộ đề lớp 6 bằng 2 câu của mình.
	var edited = [
		{
			id: "gv-1",
			difficulty: "easy",
			question: "Giáo viên tự soạn: 1 + 1 = ?",
			answers: { A: "2", B: "3" },
			correctAnswer: "A",
			point: 10,
			time: 20,
			explanation: "Một cộng một bằng hai."
		},
		{
			id: "gv-2",
			difficulty: "hard",
			question: "Giáo viên tự soạn: 12 × 12 = ?",
			answers: { A: "144", B: "124" },
			correctAnswer: "A",
			point: 30,
			time: 40
		}
	];

	await store.replaceQuestionsForLevel("lop6", edited);

	// COLD-START: store mới, cùng CSDL. Bước gieo hạt phải thấy bảng KHÔNG rỗng
	// và không đụng vào gì.
	var afterRestart = await restartStore().getLevelBundle("lop6");

	assert.equal(afterRestart.questions.length, 2, "gieo lại là mất trắng công soạn đề của giáo viên");
	assert.equal(afterRestart.questions[0].id, "gv-1");
	assert.equal(afterRestart.questions[0].explanation, "Một cộng một bằng hai.");
	assert.notEqual(afterRestart.questions.length, seeded.questions.length);
});

test("cold-start giữ nguyên MỌI chỉnh sửa: đề, điểm, thời gian, tốc độ, cách hỏi", async function () {
	var store = await freshStore();

	await store.replaceQuestionsForLevel("lop7", [
		{
			id: "l7-1",
			difficulty: "medium",
			question: "Câu của lớp 7",
			answers: { A: "x", B: "y" },
			correctAnswer: "B",
			point: 15,
			time: 25
		}
	]);
	await store.updatePointSettingsForLevel("lop7", { medium: 55 });
	await store.updateTimeSettingsForLevel("lop7", { medium: 33 });
	await store.updateGameSpeedForLevel("lop7", 1.5);
	await store.updateQuizModeForLevel("lop7", "modal");

	var bundle = await restartStore().getLevelBundle("lop7");

	assert.equal(bundle.questions.length, 1);
	assert.equal(bundle.questions[0].id, "l7-1");
	assert.equal(bundle.questions[0].point, 55, "điểm theo độ khó phải áp vào chính câu hỏi");
	assert.equal(bundle.questions[0].time, 33);
	assert.equal(bundle.pointSettings.medium, 55);
	assert.equal(bundle.timeSettings.medium, 33);
	assert.equal(bundle.gameSpeed, 1.5);
	assert.equal(bundle.quizMode, "modal");
});

test("thứ tự câu hỏi được GIỮ NGUYÊN (game pop từ cuối mảng — hợp đồng §7.3.1)", async function () {
	var store = await freshStore();
	var ids = ["z-cuoi", "a-dau", "m-giua"];

	await store.replaceQuestionsForLevel("lop8", ids.map(function (id, index) {
		return {
			id: id,
			difficulty: "easy",
			question: "Câu " + id,
			answers: { A: "1", B: "2" },
			correctAnswer: "A",
			point: 10,
			time: 20 + index
		};
	}));

	var bundle = await restartStore().getLevelBundle("lop8");

	assert.deepEqual(
		bundle.questions.map(function (question) { return question.id; }),
		ids,
		"sắp theo id thay vì theo thứ tự nhập là đổi luôn câu nào ra trước trong game"
	);
});

test("điểm/thời gian áp cho MỌI lớp, còn quizMode CHỈ lớp được chọn (P0-14)", async function () {
	var store = await freshStore();

	await store.updatePointSettingsForLevel("lop6", { easy: 77 });
	await store.updateQuizModeForLevel("lop6", "modal");

	var lop7 = await store.getLevelBundle("lop7");

	assert.equal(lop7.pointSettings.easy, 77, "điểm là cài đặt chung — giống hệt kho JSON và V1");
	assert.equal(lop7.quizMode, "gate", "quizMode phải RIÊNG từng lớp, đổi lop6 không được đụng lop7");
});

test("thay đề là MỘT transaction — không bao giờ để lớp trống giữa chừng", async function () {
	var store = await freshStore();
	var before = (await store.getLevelBundle("lop6")).questions.length;

	// Đề không hợp lệ → ném lỗi TRƯỚC khi chạm CSDL.
	await assert.rejects(function () {
		return store.replaceQuestionsForLevel("lop6", [{ id: "hong" }]);
	});

	var after = (await store.getLevelBundle("lop6")).questions.length;
	assert.equal(after, before, "đề cũ phải còn nguyên khi bản mới không hợp lệ");
});

test("lời giải là TÙY CHỌN — câu không có thì không mọc thêm khoá (P0-14)", async function () {
	var store = await freshStore();

	await store.replaceQuestionsForLevel("lop6", [
		{
			id: "khong-loi-giai",
			difficulty: "easy",
			question: "Không có lời giải",
			answers: { A: "1", B: "2" },
			correctAnswer: "A",
			point: 10,
			time: 20
		},
		{
			id: "co-loi-giai",
			difficulty: "easy",
			question: "Có lời giải",
			answers: { A: "1", B: "2" },
			correctAnswer: "A",
			point: 10,
			time: 20,
			explanation: "Vì thế thôi."
		}
	]);

	var bundle = await restartStore().getLevelBundle("lop6");

	assert.equal("explanation" in bundle.questions[0], false, "shape câu V1 phải giữ nguyên từng khoá");
	assert.equal(bundle.questions[1].explanation, "Vì thế thôi.");
});

test("lớp lạ bị từ chối ở mọi phương thức", async function () {
	var store = await freshStore();

	await assert.rejects(function () { return store.getLevelBundle("lop99"); });
	await assert.rejects(function () { return store.replaceQuestionsForLevel("lop99", []); });
	await assert.rejects(function () { return store.updateQuizModeForLevel("lop99", "gate"); });
});

// --- Chọn kho: DoD "không có DATABASE_URL → hành vi như hiện tại" -------------

test("không có DATABASE_URL → vẫn là kho JSON, không đụng Postgres", function () {
	var dbModule = require("../server/db");
	var tempDir = fs.mkdtempSync(path.join(sharedTempDir, "json-"));
	var store = dbModule.createDatabase(
		{ rootDir: rootDir, runtimeDir: tempDir, databaseUrl: "" },
		sql
	);

	assert.notEqual(store.kind, "postgres", "thiếu DATABASE_URL mà nhảy sang Postgres là đổi đường chạy của dev/CI");

	var bundle = store.getLevelBundle("lop6");
	assert.ok(Array.isArray(bundle.questions), "kho JSON trả về ĐỒNG BỘ như trước");
});

test("có DATABASE_URL + có SQL client → chuyển sang kho Postgres", async function () {
	var dbModule = require("../server/db");
	var store = dbModule.createDatabase(
		{ rootDir: rootDir, runtimeDir: sharedTempDir, databaseUrl: "postgres://gia-lap" },
		sql
	);

	assert.equal(store.kind, "postgres");
	// PHẢI đợi: `createQuestionStore` khởi động chuỗi gieo hạt ngay lúc dựng. Bỏ lửng
	// thì nó chạy tiếp sau khi test kết thúc và giẫm vào test sau (đã thấy lỗi
	// "duplicate key" đúng như vậy).
	await store.ready();
});

test("có DATABASE_URL nhưng KHÔNG có client → rơi về kho JSON thay vì sập", function () {
	var dbModule = require("../server/db");
	var tempDir = fs.mkdtempSync(path.join(sharedTempDir, "nosql-"));
	var store = dbModule.createDatabase(
		{ rootDir: rootDir, runtimeDir: tempDir, databaseUrl: "postgres://gia-lap" },
		null
	);

	// Đây chính là tình huống Vercel: DATABASE_URL có nhưng createSqlClient trả null.
	// Game phải chạy được, không được ném lỗi lúc khởi động.
	assert.notEqual(store.kind, "postgres");
	assert.ok(Array.isArray(store.getLevelBundle("lop6").questions));
});

test("API surface của hai kho GIỐNG HỆT nhau (contract-test xanh nguyên trạng)", async function () {
	var dbModule = require("../server/db");
	var tempDir = fs.mkdtempSync(path.join(sharedTempDir, "shape-"));
	var jsonStore = dbModule.createDatabase({ rootDir: rootDir, runtimeDir: tempDir, databaseUrl: "" }, null);
	var pgStore = await freshStore();

	[
		"getLevelBundle",
		"replaceQuestionsForLevel",
		"updatePointSettingsForLevel",
		"updateTimeSettingsForLevel",
		"updateGameSpeedForLevel",
		"updateQuizModeForLevel",
		"close"
	].forEach(function (method) {
		assert.equal(typeof jsonStore[method], "function", "kho JSON thiếu " + method);
		assert.equal(typeof pgStore[method], "function", "kho Postgres thiếu " + method);
	});

	// Và bundle phải có ĐÚNG cùng bộ khoá — app.js không được biết đang chạy kho nào.
	var jsonBundle = jsonStore.getLevelBundle("lop6");
	var pgBundle = await pgStore.getLevelBundle("lop6");

	assert.deepEqual(Object.keys(jsonBundle).sort(), Object.keys(pgBundle).sort());
});

test("script migrate có gieo hạt và ghi rõ là idempotent", function () {
	var script = fs.readFileSync(path.join(rootDir, "scripts", "migrate-neon.js"), "utf8");

	assert.ok(/createQuestionStore/.test(script), "migrate phải gieo được ngân hàng câu hỏi");
	assert.ok(/idempotent|IDEMPOTENT/i.test(script));
	// Chỉ gieo khi thật sự chạy Neon — máy dev vẫn dùng kho JSON.
	assert.ok(/sql\.kind !== "neon"/.test(script));
});

test("schema questions/level_settings đủ cột theo plan.md §2.1 + P0-14", function () {
	var schema = fs.readFileSync(path.join(rootDir, "server", "schema.js"), "utf8");

	["level", "difficulty", "question", "answers", "correct_answer", "point", "time", "explanation", "position"].forEach(
		function (column) {
			assert.ok(schema.includes(column), "bảng questions thiếu cột " + column);
		}
	);

	["point_settings", "time_settings", "game_speed", "quiz_mode"].forEach(function (column) {
		assert.ok(schema.includes(column), "bảng level_settings thiếu cột " + column);
	});

	assert.ok(/CREATE TABLE IF NOT EXISTS questions/.test(schema), "phải IF NOT EXISTS — chạy lại được trên DB có sẵn");
	assert.ok(/CREATE TABLE IF NOT EXISTS level_settings/.test(schema));
});
