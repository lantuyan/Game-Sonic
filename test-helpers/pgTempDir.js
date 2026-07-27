"use strict";

// Thư mục dữ liệu tạm cho test — TỰ DỌN, và tổng dung lượng luôn CÓ TRẦN.
//
// ================== VÌ SAO PHẢI CÓ FILE NÀY (đọc kỹ trước khi gỡ) ==================
//
// Mỗi file test backend dựng một CSDL PGlite bằng `fs.mkdtempSync(os.tmpdir(), ...)`.
// PGlite là Postgres biên dịch sang WASM: mỗi instance là một cluster đầy đủ, ~39 MB
// nằm lại trên đĩa. Trước đây KHÔNG ai xoá những thư mục đó — một lượt `npm test` để
// lại ~470 MB vĩnh viễn. Đo thật trước khi sửa: 666 thư mục còn sót, **25 GB** trong
// thư mục tạm, đủ để làm đầy ổ đĩa và hỏng cả buổi làm việc.
//
// Hai lớp bảo vệ, cố ý thừa một lớp:
//
//   1. **Dọn lúc thoát tiến trình.** `process.on("exit")` chạy cả khi test THẤT BẠI
//      hay khi có ngoại lệ không bắt — đó chính là lúc trước đây rác bị bỏ lại nhiều
//      nhất. Phải dùng bản đồng bộ (`rmSync`): trong handler `exit` không còn lượt I/O
//      bất đồng bộ nào chạy nữa.
//   2. **Quét rác cũ lúc khởi động.** `SIGKILL`, mất điện, hay một agent bấm dừng giữa
//      chừng thì lớp (1) không chạy. Vì mọi thư mục nằm gọn dưới MỘT gốc chung và
//      MANG SẴN PID của tiến trình tạo ra nó, lần chạy sau xoá ngay mọi thư mục có
//      chủ đã chết — không phải chờ hết thời hạn nào. Mốc thời gian chỉ còn là lưới
//      an toàn cuối cho trường hợp PID bị hệ điều hành cấp lại cho tiến trình khác.
//
// Trần dung lượng vì thế là: (số file test backend) × (một cluster PGlite) trong lúc
// chạy, và 0 sau khi chạy xong — không phụ thuộc số lượt đã chạy trong ngày.

var fs = require("fs");
var os = require("os");
var path = require("path");

/** MỘT gốc chung cho mọi thư mục tạm của test — điều kiện để quét được rác cũ. */
var ROOT = path.join(os.tmpdir(), "toan-runner-test");

/** Lưới an toàn cuối: quá mốc này thì xoá kể cả khi PID trùng với một tiến trình lạ. */
var STALE_MS = 2 * 60 * 60 * 1000;

/** `…-pid12345-abcdef` → 12345. Không đúng khuôn thì trả null (thư mục lạ, không đụng). */
function ownerPidOf(name) {
	var matched = /-pid(\d+)-[^-]*$/.exec(name);

	return matched == null ? null : Number(matched[1]);
}

function isProcessAlive(pid) {
	try {
		// Tín hiệu 0 không gửi gì cả, chỉ hỏi "tiến trình này còn không".
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM = còn sống nhưng thuộc người dùng khác ⇒ tuyệt đối không xoá.
		return error != null && error.code === "EPERM";
	}
}

var sweptOnce = false;
var registered = [];

function sweepStale() {
	if (sweptOnce) {
		return;
	}

	sweptOnce = true;

	var entries;

	try {
		entries = fs.readdirSync(ROOT);
	} catch (error) {
		return;
	}

	var cutoff = Date.now() - STALE_MS;

	entries.forEach(function (name) {
		var target = path.join(ROOT, name);
		var owner = ownerPidOf(name);

		try {
			var orphaned = owner != null && owner !== process.pid && isProcessAlive(owner) === false;

			if (orphaned || fs.statSync(target).mtimeMs < cutoff) {
				fs.rmSync(target, { recursive: true, force: true });
			}
		} catch (error) {
			// Thư mục của một tiến trình test đang chạy song song có thể biến mất giữa
			// chừng. Không phải lỗi — bỏ qua.
		}
	});
}

function cleanupAll() {
	registered.splice(0).forEach(function (dir) {
		try {
			fs.rmSync(dir, { recursive: true, force: true });
		} catch (error) {
			// Hết đường dọn ở đây rồi; lần chạy sau `sweepStale` sẽ nhặt nốt.
		}
	});
}

var hooked = false;

function hookProcess() {
	if (hooked) {
		return;
	}

	hooked = true;
	process.on("exit", cleanupAll);
}

/**
 * Thư mục tạm dùng chung cho MỘT file test, tự xoá khi tiến trình kết thúc.
 *
 * Thay thế nguyên chỗ cho `fs.mkdtempSync(path.join(os.tmpdir(), prefix))`.
 */
function createTempDir(prefix) {
	sweepStale();
	hookProcess();
	fs.mkdirSync(ROOT, { recursive: true });

	// PID nằm trong TÊN thư mục: đó là thứ duy nhất còn đọc được sau một `SIGKILL`,
	// và là cách lần chạy sau biết thư mục nào đã mồ côi.
	var dir = fs.mkdtempSync(path.join(ROOT, prefix + "pid" + process.pid + "-"));

	registered.push(dir);

	return dir;
}

module.exports = {
	createTempDir: createTempDir,
	ROOT: ROOT
};
