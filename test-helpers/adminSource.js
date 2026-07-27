"use strict";

// P2-7 — đọc MÃ NGUỒN trang quản trị.
//
// Trước P2-7 trang quản trị là một file `admin.html` ở gốc repo, nên vài test chỉ
// cần `fs.readFileSync(rootDir + "/admin.html")`. Nay nó là entry point của Vite:
// markup ở `client/admin.html`, logic rải ra `client/src/admin/*.ts`.
//
// Helper này ghép lại thành MỘT chuỗi để những test "canh mã nguồn" (không nhúng
// thư viện chart, nút xác nhận phải sinh ra ở trạng thái khoá, …) tiếp tục canh
// đúng thứ chúng vẫn canh — thay vì bị xoá đi vì file đổi chỗ.

var fs = require("fs");
var path = require("path");

var rootDir = path.resolve(__dirname, "..");
var ADMIN_HTML = path.join(rootDir, "client", "admin.html");
var ADMIN_SRC_DIR = path.join(rootDir, "client", "src", "admin");

/** Markup của trang quản trị (`client/admin.html`). */
function readAdminMarkup() {
	return fs.readFileSync(ADMIN_HTML, "utf8");
}

/** Markup + toàn bộ `client/src/admin/*` (TS và CSS), ghép theo thứ tự tên file. */
function readAdminSource() {
	var parts = [readAdminMarkup()];

	fs.readdirSync(ADMIN_SRC_DIR)
		.sort()
		.forEach(function (fileName) {
			parts.push(fs.readFileSync(path.join(ADMIN_SRC_DIR, fileName), "utf8"));
		});

	return parts.join("\n");
}

module.exports = {
	ADMIN_HTML: ADMIN_HTML,
	ADMIN_SRC_DIR: ADMIN_SRC_DIR,
	readAdminMarkup: readAdminMarkup,
	readAdminSource: readAdminSource
};
