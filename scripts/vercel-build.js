"use strict";

var childProcess = require("child_process");
var fs = require("fs");
var path = require("path");

var rootDir = path.resolve(__dirname, "..");
var publicDir = path.join(rootDir, "public");

// Danh sách legacy V1 GIỮ NGUYÊN (12 file — gồm EndlessRunner.htm/.js, index.html,
// worker.js): V1 còn phục vụ tại "/" cho tới P0-15 (công tắc release).
var staticFiles = [
	"EndlessRunner.htm",
	"EndlessRunner.js",
	"EndlessRunner.json",
	"EndlessRunner.png",
	"EndlessRunnerFavIcon_16x16.png",
	"EndlessRunnerFavIcon_192x192.png",
	"EndlessRunnerFavIcon_512x512.png",
	"EndlessRunnerShare.png",
	"admin.html",
	"index.html",
	"questionBank.js",
	"worker.js"
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
// legacy bên dưới sẽ đè index.html/admin.html của Vite. P0-15 phải đồng thời
// cắt danh sách staticFiles (bỏ index.html + EndlessRunner.*) theo đúng task.
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

// EndlessRunner.htm + admin.html load "shared/questionModel.js" — trước đây file
// này không được copy nên request rơi vào serverless function thay vì CDN
// (docs/v2/A3 §3.2). Copy bổ sung để phục vụ tĩnh.
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
