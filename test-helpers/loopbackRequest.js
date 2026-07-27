"use strict";

// supertest CHỈ NGHE TRÊN 127.0.0.1 — thay thế nguyên chỗ cho `require("supertest")`.
//
// ================== VÌ SAO PHẢI CÓ FILE NÀY (đọc kỹ trước khi gỡ) ==================
//
// Mặc định `request(app)` của supertest dựng MỘT http.Server mới cho MỖI request rồi
// gọi `app.listen(0)`. `listen(0)` không có tham số địa chỉ nghĩa là bind vào ĐỊA CHỈ
// ĐẠI DIỆN (`::` / `0.0.0.0`), và nhân hệ điều hành tự chọn một cổng phù du trong dải
// 49152–65535 (macOS). Ngay sau đó supertest lại kết nối tới `http://127.0.0.1:<cổng>`.
//
// Trên máy lập trình viên, dải 49152–65535 KHÔNG hề trống: các máy chủ ngôn ngữ, MCP
// server, công cụ dev… nằm sẵn ở đó và chúng bind vào ĐÚNG `127.0.0.1`. Trên macOS/BSD
// (libuv luôn bật `SO_REUSEADDR`), bind `0.0.0.0:P` VẪN THÀNH CÔNG khi đã có ai đó giữ
// `127.0.0.1:P` — nhân chọn cổng phù du cho địa chỉ đại diện mà không loại trừ các
// cổng đã bị chiếm riêng trên loopback. Và khi có kết nối tới `127.0.0.1:P`, socket
// CỤ THỂ HƠN (loopback) thắng: request của test đi thẳng sang tiến trình lạ.
//
// Hậu quả đã đo được: test nhận 406 kèm thân `{"jsonrpc":"2.0",...,"Not Acceptable:
// Client must accept both application/json and text/event-stream"}` — phản hồi của một
// MCP server, không phải của Express. Cũng thấy 405 và 404 từ các dịch vụ khác. Vì
// `node --test` chạy ~9 file song song và mỗi request là một `listen(0)`, một lượt
// `npm test` bắn hàng nghìn lần bind ⇒ 13% số lượt chạy đỏ ngẫu nhiên, ở file bất kỳ.
// Chạy riêng một file thì ít lần bind hơn hẳn nên gần như luôn xanh — đúng triệu chứng.
//
// CÁCH SỬA: bind TƯỜNG MINH vào `127.0.0.1`. Lúc đó nhân chỉ chọn cổng còn trống TRÊN
// CHÍNH loopback, nên không thể trùng với dịch vụ lạ nữa — đây là bảo đảm của nhân hệ
// điều hành, không phải xác suất. Mỗi app dùng lại MỘT server (thay vì một server mỗi
// request) nên số lần bind giảm từ hàng nghìn xuống hàng chục.
//
// ĐÁNH ĐỔI: `listen(0, "127.0.0.1")` đi qua `dns.lookup` nên địa chỉ chỉ có sau một
// `nextTick`, trong khi supertest đọc `app.address().port` NGAY LẬP TỨC. Vì vậy mỗi
// app phải được `await request.ready(app)` MỘT LẦN trước request đầu tiên. Gọi
// `request(app)` khi chưa sẵn sàng sẽ ném lỗi có hướng dẫn — cố ý ồn ào, vì im lặng ở
// đây chính là con đường quay lại đúng lỗi cũ.

var http = require("http");
var supertest = require("supertest");

/** app (hoặc http.Server) → { server, ready }. Một server cho cả vòng đời tiến trình. */
var entriesByApp = new Map();

/** Nhận `runtime` (`{ app }`) hay chính app/server — mọi chỗ gọi đều tiện. */
function unwrap(target) {
	if (target != null && typeof target === "object" && target.app != null && typeof target.listen !== "function") {
		return target.app;
	}

	return target;
}

function entryFor(target) {
	var app = unwrap(target);
	var existing = entriesByApp.get(app);

	if (existing != null) {
		return existing;
	}

	var server = typeof app === "function" ? http.createServer(app) : app;
	var entry = {
		server: server,
		ready: new Promise(function (resolve, reject) {
			if (server.listening === true && server.address() != null) {
				resolve(server);
				return;
			}

			server.once("error", reject);
			server.listen(0, "127.0.0.1", function () {
				// `unref` để `node --test` vẫn thoát được: các server này cố ý sống tới
				// hết tiến trình (không đóng sau mỗi request nữa) nên nếu còn giữ vòng
				// lặp sự kiện thì file test sẽ treo thay vì kết thúc.
				server.unref();
				resolve(server);
			});
		})
	};

	entriesByApp.set(app, entry);

	return entry;
}

/** Chờ server loopback của app sẵn sàng. Gọi MỘT LẦN cho mỗi app, trước request đầu. */
function ready(target) {
	return entryFor(target).ready;
}

function requireListening(entry) {
	if (entry.server.address() == null) {
		throw new Error(
			"loopbackRequest: server chưa nghe. Thêm `await request.ready(app)` một lần " +
			"sau khi tạo app (xem chú thích đầu test-helpers/loopbackRequest.js)."
		);
	}

	return entry.server;
}

function request(target) {
	return supertest(requireListening(entryFor(target)));
}

request.ready = ready;

request.agent = function (target, options) {
	return supertest.agent(requireListening(entryFor(target)), options);
};

module.exports = request;
