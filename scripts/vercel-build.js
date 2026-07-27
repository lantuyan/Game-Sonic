"use strict";

var childProcess = require("child_process");
var fs = require("fs");
var path = require("path");

var rootDir = path.resolve(__dirname, "..");
var publicDir = path.join(rootDir, "public");

// P0-15 (công tắc release): V2 đã chiếm "/" nên KHÔNG copy các file của V1 nữa.
//
// Cụ thể đã bỏ khỏi danh sách:
//   · `index.html` + `worker.js` — Vite build ra chính 2 tên này, copy đè là xoá V2;
//   · `EndlessRunner.htm` + `EndlessRunner.js` (~7MB texture base64) + ảnh kèm theo —
//     bookmark cũ đã được `server/app.js` 301 về "/", không cần file tĩnh nữa.
//
// Các file này VẪN CÒN trong git history và trong repo; chỉ là không phát hành nữa.
// Cần quay lại V1 khẩn cấp: `git revert` commit này rồi deploy, hoặc build với
// `V2_ROOT=v2` và khôi phục danh sách cũ.
// P2-7: `admin.html` ĐÃ RA KHỎI danh sách này.
//
// Trang quản trị nay là entry point thứ hai của Vite (`client/admin.html` →
// `public/admin.html`). Trước P2-7, bước copy dưới đây ĐÈ file Vite vừa sinh bằng
// bản legacy ở gốc repo — và vì manifest Service Worker được tính TRƯỚC lúc copy,
// máy nào đã cài PWA sẽ giữ mãi bản admin cũ trong precache (chi tiết ở
// `client/vite.config.mts` → globIgnores). Đừng thêm lại tên file này.
var staticFiles = [
	// questionBank.js là hợp đồng tích hợp — client V2 nạp qua questionBridge.
	"questionBank.js",
	// Favicon/ảnh chia sẻ giữ lại để link cũ không vỡ.
	"EndlessRunnerFavIcon_16x16.png",
	"EndlessRunnerFavIcon_192x192.png",
	"EndlessRunnerFavIcon_512x512.png",
	"EndlessRunnerShare.png"
];

function run(command) {
	childProcess.execSync(command, { cwd: rootDir, stdio: "inherit" });
}

// The deploy build only assembles static assets. Tests run via `npm test`
// (locally / CI), not in the deploy build, so a flaky integration test can't
// block a production deploy.
fs.rmSync(publicDir, { recursive: true, force: true });
fs.mkdirSync(publicDir, { recursive: true });

// Thứ tự build V2 (plan §7.5): assets:build → vite build → copy legacy.
// Vite build ra public/<V2_ROOT>/ (mặc định "v2") để V1 vẫn chiếm route "/".
// ⚠ P0-15 (công tắc release): riêng việc đặt V2_ROOT="" là CHƯA đủ — bước copy
// legacy bên dưới sẽ đè index.html của Vite. P0-15 phải đồng thời cắt danh sách
// staticFiles (bỏ index.html + EndlessRunner.*) theo đúng task. P2-7 bỏ nốt
// admin.html khỏi danh sách đó vì cùng lý do.
// `client/public/` (bộ asset đã tối ưu, ~3MB) ĐƯỢC commit vào git và chính là thứ
// Vite đóng gói. Còn `assets-src/downloads/` (~45MB nguồn thô) thì KHÔNG commit, nên
// trên Vercel sẽ không có — bỏ qua assets:build là đúng, không phải lỗi.
// Muốn dựng lại bộ asset: `npm run assets:fetch && npm run assets:build` ở máy dev,
// rồi commit `client/public/`.
if (fs.existsSync(path.join(rootDir, "assets-src", "downloads"))) {
	run("npm run assets:build");
} else {
	console.log("[vercel-build] bỏ qua assets:build — không có assets-src/downloads/, dùng client/public/ đã commit.");
}

run("npm run build:client");

staticFiles.forEach(function (fileName) {
	fs.copyFileSync(path.join(rootDir, fileName), path.join(publicDir, fileName));
});

// `questionBank.js` (và qua đó cả trang quản trị) nạp "shared/questionModel.js" —
// trước đây file này không được copy nên request rơi vào serverless function thay vì
// CDN (docs/v2/A3 §3.2). Copy bổ sung để phục vụ tĩnh.
fs.mkdirSync(path.join(publicDir, "shared"), { recursive: true });
fs.copyFileSync(
	path.join(rootDir, "shared", "questionModel.js"),
	path.join(publicDir, "shared", "questionModel.js")
);

// KHÔNG copy questions/ ra public: server chặn 404 có chủ đích (server/app.js:158-179)
// để nguồn sự thật câu hỏi chỉ đi qua API.

// Copy selectable character models (3D GLB) so they are served as static assets.
var charactersSrc = path.join(rootDir, "characters");
if (fs.existsSync(charactersSrc)) {
	fs.cpSync(charactersSrc, path.join(publicDir, "characters"), { recursive: true });
}
