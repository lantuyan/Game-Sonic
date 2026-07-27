"use strict";

// P2-5 · RÀO CHẮN CHO `npm run migrate`.
//
// Vì sao file này tồn tại (lỗi có sẵn, ghi ở mục P2-3 của tasks-version2.md):
// `scripts/migrate-neon.js` gọi `dotenv.config()` rồi chạy thẳng vào `DATABASE_URL`
// trong `.env` — tức là **CSDL Neon production của trường** — mà không hỏi lại,
// không có chế độ thử, và không in ra nó sắp làm gì. Việc nó làm hiện tại là
// idempotent nên vô hại, nhưng "vô hại" là tính chất của phiên bản hôm nay chứ
// không phải của cái nút bấm. Một câu `ALTER`/`UPDATE` thêm vào schema ngày mai
// là đủ để một lần gõ nhầm thành sự cố dữ liệu thật.
//
// Hai lớp rào, cố ý tách rời:
//   · `--dry-run` — in ra ĐÚNG những câu lệnh sẽ chạy và **không kết nối** tới bất
//     kỳ CSDL nào. Đây là chế độ mặc định nên dùng khi không chắc.
//   · `--yes-production` (hoặc `MIGRATE_CONFIRM=yes-production`) — bắt buộc khi
//     đích KHÔNG phải localhost/PGlite. Không có cờ thì script dừng, thoát khác 0,
//     và không mở kết nối nào.
//
// Toàn bộ luật ở đây là hàm THUẦN để test được mà không cần một CSDL nào.

var CONFIRM_FLAG = "--yes-production";
var DRY_RUN_FLAG = "--dry-run";
var CONFIRM_ENV_KEY = "MIGRATE_CONFIRM";
var CONFIRM_ENV_VALUE = "yes-production";

/**
 * Host được coi là "máy của mình". Mọi thứ khác — Neon, RDS, một IP nội bộ nào đó —
 * đều là CSDL của người khác cho tới khi có người xác nhận ngược lại.
 */
var LOCAL_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]", "host.docker.internal"];

function parseArgs(argv) {
	var args = Array.isArray(argv) ? argv : [];

	return {
		dryRun: args.indexOf(DRY_RUN_FLAG) !== -1,
		confirmFlag: args.indexOf(CONFIRM_FLAG) !== -1
	};
}

/** Đích của lần migrate này, suy ra từ chuỗi kết nối. */
function describeTarget(databaseUrl) {
	var value = String(databaseUrl == null ? "" : databaseUrl).trim();

	if (value === "") {
		return { kind: "pglite", host: "(PGlite trong máy)", local: true };
	}

	var host = "";

	try {
		host = new URL(value).hostname;
	} catch (error) {
		// Chuỗi kết nối lạ: KHÔNG đoán, và KHÔNG coi là local. Đoán sai theo hướng
		// "chắc là máy mình" đúng là cách tai nạn xảy ra.
		return { kind: "remote", host: "(không đọc được host)", local: false };
	}

	var normalized = String(host || "").toLowerCase();
	var local = LOCAL_HOSTS.indexOf(normalized) !== -1 || /^127\./.test(normalized);

	return {
		kind: local ? "local-postgres" : "remote",
		host: normalized === "" ? "(không rõ)" : normalized,
		local: local
	};
}

/**
 * Quyết định lần chạy này được phép làm gì.
 *
 * @returns {{
 *   dryRun: boolean, target: object, requiresConfirmation: boolean,
 *   confirmed: boolean, allowed: boolean, willConnect: boolean, message: string
 * }}
 */
function resolveMigrationPlan(options) {
	var settings = options || {};
	var env = settings.env || {};
	var flags = parseArgs(settings.argv);
	var target = describeTarget(settings.databaseUrl);
	var confirmed = flags.confirmFlag === true || String(env[CONFIRM_ENV_KEY] || "") === CONFIRM_ENV_VALUE;
	var requiresConfirmation = target.local !== true;

	if (flags.dryRun === true) {
		return {
			dryRun: true,
			target: target,
			requiresConfirmation: requiresConfirmation,
			confirmed: confirmed,
			allowed: true,
			willConnect: false,
			message:
				"CHẠY THỬ (--dry-run) — không kết nối CSDL nào, không ghi gì.\n" +
				"Đích sẽ dùng nếu chạy thật: " + target.kind + " · host: " + target.host
		};
	}

	if (requiresConfirmation === true && confirmed !== true) {
		return {
			dryRun: false,
			target: target,
			requiresConfirmation: true,
			confirmed: false,
			allowed: false,
			willConnect: false,
			message:
				"DỪNG LẠI — đích của lệnh này KHÔNG phải máy của bạn.\n" +
				"  host: " + target.host + "\n" +
				"Đây gần như chắc chắn là CSDL production trong file .env.\n\n" +
				"Muốn xem trước mà không đụng gì:\n" +
				"  npm run migrate -- " + DRY_RUN_FLAG + "\n\n" +
				"Chắc chắn muốn chạy thật lên chính CSDL đó:\n" +
				"  npm run migrate -- " + CONFIRM_FLAG + "\n" +
				"  (hoặc đặt " + CONFIRM_ENV_KEY + "=" + CONFIRM_ENV_VALUE + " cho môi trường CI)"
		};
	}

	return {
		dryRun: false,
		target: target,
		requiresConfirmation: requiresConfirmation,
		confirmed: confirmed,
		allowed: true,
		willConnect: true,
		message: requiresConfirmation === true
			? "Đã xác nhận chạy thật lên CSDL từ xa (host: " + target.host + ")."
			: "Đích là CSDL trong máy (" + target.kind + ") — chạy thẳng, không cần xác nhận."
	};
}

module.exports = {
	CONFIRM_FLAG: CONFIRM_FLAG,
	DRY_RUN_FLAG: DRY_RUN_FLAG,
	CONFIRM_ENV_KEY: CONFIRM_ENV_KEY,
	CONFIRM_ENV_VALUE: CONFIRM_ENV_VALUE,
	LOCAL_HOSTS: LOCAL_HOSTS,
	parseArgs: parseArgs,
	describeTarget: describeTarget,
	resolveMigrationPlan: resolveMigrationPlan
};
