"use strict";

// Áp schema Postgres và gieo hạt ngân hàng câu hỏi.
//
//   - Có DATABASE_URL (Neon): migrate CSDL production — bảng người chơi
//     (players/scores/skill_profiles/answer_events) VÀ ngân hàng câu hỏi
//     (questions/level_settings, P1-7).
//   - Không có DATABASE_URL (máy dev): khởi tạo kho PGlite nhúng. Ngân hàng câu
//     hỏi khi đó vẫn chạy trên kho JSON (xem server/db.js), nên bước gieo hạt
//     được bỏ qua — đúng chủ ý, không phải thiếu sót.
//
// Gieo hạt là IDEMPOTENT: chỉ chèn cho lớp nào bảng còn rỗng, nên chạy lại bao
// nhiêu lần cũng không ghi đè đề giáo viên đã sửa.
//
//   node scripts/migrate-neon.js   (hoặc: npm run migrate)

var dotenv = require("dotenv");
var configModule = require("../server/config");
var createSqlClient = require("../server/sql").createSqlClient;
var applySchema = require("../server/schema").applySchema;
var createQuestionStore = require("../server/questionStore").createQuestionStore;

dotenv.config();

(function run() {
	var config = configModule.resolveConfig();
	var sql = createSqlClient(config);

	if (sql == null) {
		console.log("Chưa có DATABASE_URL (và đang chạy trên Vercel) — bảng xếp hạng/kỹ năng vẫn tắt. Không có gì để migrate.");
		return;
	}

	return applySchema(sql)
		.then(function () {
			console.log("Đã áp schema. Backend: " + sql.kind);

			if (sql.kind !== "neon") {
				console.log("\nGhi chú: DATABASE_URL chưa đặt nên script này chỉ khởi tạo kho PGlite ở máy.");
				console.log("Ngân hàng câu hỏi vẫn dùng kho JSON — đặt DATABASE_URL để chuyển sang Neon.");
				return null;
			}

			// Chỉ gieo hạt khi thật sự chạy Neon: kho câu hỏi cũng chỉ dùng Postgres
			// trong trường hợp đó (server/db.js).
			console.log("Đang gieo ngân hàng câu hỏi (chỉ những lớp còn rỗng)…");
			return createQuestionStore({ sql: sql, rootDir: config.rootDir }).ready().then(function () {
				return sql.query("SELECT level, COUNT(*)::int AS total FROM questions GROUP BY level ORDER BY level", []);
			}).then(function (result) {
				result.rows.forEach(function (row) {
					console.log("  · " + row.level + ": " + row.total + " câu");
				});
			});
		})
		.then(function () {
			return sql.close();
		})
		.catch(function (error) {
			console.error("Migration thất bại:", error);
			process.exit(1);
		});
})();
