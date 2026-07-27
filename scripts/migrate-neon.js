"use strict";

// Áp schema Postgres và gieo hạt ngân hàng câu hỏi.
//
//   - Có DATABASE_URL (Neon): migrate CSDL production — bảng người chơi
//     (players/scores/skill_profiles/answer_events), ngân hàng câu hỏi
//     (questions/level_settings, P1-7), nền kinh tế (wallet/coin_ledger/unlocks,
//     P2-3) VÀ lớp học (class_codes/class_members, P2-5 — chỉ tạo bảng, KHÔNG gieo
//     hạt: xu và lớp là dữ liệu của người dùng, không phải dữ liệu hạt giống).
//   - Không có DATABASE_URL (máy dev): khởi tạo kho PGlite nhúng. Ngân hàng câu
//     hỏi khi đó vẫn chạy trên kho JSON (xem server/db.js), nên bước gieo hạt
//     được bỏ qua — đúng chủ ý, không phải thiếu sót.
//
// Gieo hạt là IDEMPOTENT: chỉ chèn cho lớp nào bảng còn rỗng, nên chạy lại bao
// nhiêu lần cũng không ghi đè đề giáo viên đã sửa.
//
// ⚠ P2-5 — RÀO CHẮN PRODUCTION. Script này đọc `.env`, nên trước đây gõ
// `npm run migrate` ở máy dev là chạy thẳng vào Neon thật mà không hỏi lại.
// Từ nay:
//
//   npm run migrate -- --dry-run          # in ra câu lệnh sẽ chạy, KHÔNG kết nối
//   npm run migrate                       # chỉ chạy được khi đích là localhost/PGlite
//   npm run migrate -- --yes-production   # bắt buộc khi đích là CSDL từ xa
//
// Luật đầy đủ + lý do: server/migrateGuard.js.

var dotenv = require("dotenv");
var configModule = require("../server/config");
var createSqlClient = require("../server/sql").createSqlClient;
var schemaModule = require("../server/schema");
var migrateGuard = require("../server/migrateGuard");
var createQuestionStore = require("../server/questionStore").createQuestionStore;

dotenv.config();

(function run() {
	var config = configModule.resolveConfig();
	var plan = migrateGuard.resolveMigrationPlan({
		argv: process.argv.slice(2),
		env: process.env,
		databaseUrl: config.databaseUrl
	});

	// Rào chắn chạy TRƯỚC `createSqlClient`: bị chặn thì không một kết nối nào được
	// mở, chứ không phải mở rồi mới nghĩ lại.
	if (plan.allowed !== true) {
		console.error("\n" + plan.message + "\n");
		process.exit(1);
		return;
	}

	console.log(plan.message + "\n");

	if (plan.dryRun === true) {
		printDryRun(config);
		return;
	}

	var sql = createSqlClient(config);

	if (sql == null) {
		console.log("Chưa có DATABASE_URL (và đang chạy trên Vercel) — bảng xếp hạng/kỹ năng vẫn tắt. Không có gì để migrate.");
		return;
	}

	return schemaModule.applySchema(sql)
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

				// P2-3 — báo số dòng kinh tế hiện có. Chạy migrate lần hai mà con số
				// KHÔNG đổi chính là bằng chứng schema idempotent, xem được ngay tại chỗ.
				return sql.query(
					"SELECT (SELECT COUNT(*) FROM wallet) AS wallets, " +
						"(SELECT COUNT(*) FROM coin_ledger) AS ledger, " +
						"(SELECT COUNT(*) FROM unlocks) AS unlocks, " +
						"(SELECT COUNT(*) FROM class_codes) AS classes, " +
						"(SELECT COUNT(*) FROM class_members) AS members",
					[]
				);
			}).then(function (result) {
				var row = result.rows[0] || {};
				console.log(
					"Kinh tế (P2-3): " + (row.wallets || 0) + " ví · " +
					(row.ledger || 0) + " bút toán · " + (row.unlocks || 0) + " quyền sở hữu."
				);
				console.log(
					"Lớp học (P2-5): " + (row.classes || 0) + " lớp · " + (row.members || 0) + " máy đã vào lớp."
				);
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

/**
 * Chế độ thử: in ra ĐÚNG những câu lệnh `applySchema` sẽ chạy, theo đúng thứ tự.
 * Không tạo SQL client, không đọc file đề, không mở một kết nối nào.
 */
function printDryRun(config) {
	var statements = schemaModule.STATEMENTS;

	console.log("Sẽ chạy " + statements.length + " câu lệnh schema (tất cả đều idempotent):\n");

	statements.forEach(function (statement, index) {
		console.log("  " + String(index + 1).padStart(2, " ") + ". " + statement);
	});

	console.log("\nSau đó, CHỈ khi đích là Neon:");
	console.log("  · gieo ngân hàng câu hỏi cho những lớp còn RỖNG (không ghi đè đề đã sửa);");
	console.log("  · đếm và in số ví/bút toán/quyền sở hữu/lớp học hiện có.");
	console.log("\nKhông có câu lệnh nào ở trên được chạy trong chế độ thử.");
	console.log("Thư mục dữ liệu PGlite (nếu chạy ở máy): " + config.pgDataDir);
}
