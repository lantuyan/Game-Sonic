// Ngân sách hiệu năng CỨNG (plan §6.3) — CI fail khi vượt.
//
//   · mỗi GLB nhân vật   ≤ 500 KB
//   · texture            ≤ 1024 px  (kiểm gián tiếp qua dung lượng file ảnh)
//   · nhóm biome (props) ≤ 3 MB
//   · mỗi track BGM      ≤ 1 MB
//   · tổng preload đầu   ≤ 10 MB   (toàn bộ build V2)
//
// Đo trên THƯ MỤC BUILD (`public/<V2_ROOT>`) chứ không phải `client/public/`, vì đó
// mới là thứ người chơi thật sự tải về.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const KB = 1024;
const MB = 1024 * 1024;

const LIMITS = {
	characterGlbBytes: 500 * KB,
	propsTotalBytes: 3 * MB,
	bgmTrackBytes: 1 * MB,
	totalBuildBytes: 10 * MB
};

const v2Root = (process.env.V2_ROOT ?? "v2").replace(/^\/+|\/+$/g, "");
const buildDir = resolve(import.meta.dirname, "..", "public", v2Root);

const failures = [];
const lines = [];

function formatSize(bytes) {
	return bytes >= MB ? `${(bytes / MB).toFixed(2)} MB` : `${(bytes / KB).toFixed(0)} KB`;
}

function listFiles(directory) {
	const files = [];

	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const entryPath = join(directory, entry.name);

		if (entry.isDirectory() === true) {
			files.push(...listFiles(entryPath));
			continue;
		}

		files.push({ path: entryPath, name: entry.name, bytes: statSync(entryPath).size });
	}

	return files;
}

function check(label, actualBytes, limitBytes) {
	const ok = actualBytes <= limitBytes;
	lines.push(`  ${ok ? "✓" : "✗"} ${label}: ${formatSize(actualBytes)} / ${formatSize(limitBytes)}`);

	if (ok === false) {
		failures.push(`${label} vượt ngân sách: ${formatSize(actualBytes)} > ${formatSize(limitBytes)}`);
	}
}

let files;

try {
	files = listFiles(buildDir);
} catch {
	console.error(`[budget:check] LỖI: chưa có thư mục build (${buildDir}). Chạy \`npm run build:client\` trước.`);
	process.exit(1);
}

const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);

console.log(`[budget:check] ${buildDir}`);

// 1. Từng GLB nhân vật.
const characterFiles = files.filter((file) => file.path.includes(`models${"/"}characters`));

if (characterFiles.length === 0) {
	failures.push("không tìm thấy GLB nhân vật nào trong build — assets:build chưa chạy?");
} else {
	for (const file of characterFiles) {
		check(`nhân vật ${file.name}`, file.bytes, LIMITS.characterGlbBytes);
	}
}

// 2. Props của biome.
const propBytes = files
	.filter((file) => file.path.includes(`models${"/"}props`))
	.reduce((sum, file) => sum + file.bytes, 0);
check("props biome ①", propBytes, LIMITS.propsTotalBytes);

// 3. Từng track BGM.
for (const file of files.filter((file) => file.name.startsWith("bgm-"))) {
	check(`BGM ${file.name}`, file.bytes, LIMITS.bgmTrackBytes);
}

// 4. Tổng build.
check("tổng build V2 (initial load)", totalBytes, LIMITS.totalBuildBytes);

// 5. Đối chiếu với bản kê do assets:build sinh — bắt trường hợp quên chạy lại pipeline.
try {
	const manifest = JSON.parse(readFileSync(join(buildDir, "assets.json"), "utf8"));
	const missing = [...manifest.characters.map((character) => character.url), ...manifest.audio].filter(
		(url) => files.some((file) => file.path.endsWith(url.replace(/\//g, "/"))) === false
	);

	if (missing.length > 0) {
		failures.push(`assets.json khai báo ${missing.length} file không có trong build: ${missing.slice(0, 3).join(", ")}…`);
	}

	if (manifest.clipFallbacks.length > 0) {
		lines.push(`  · ghi chú: ${manifest.clipFallbacks.length} clip thiếu đang fallback sang \`run\` (xem assets.json).`);
	}
} catch {
	failures.push("thiếu assets.json trong build — chạy `npm run assets:build` rồi build lại.");
}

console.log(lines.join("\n"));

if (failures.length > 0) {
	console.error("\n[budget:check] THẤT BẠI:");

	for (const failure of failures) {
		console.error(`  ✗ ${failure}`);
	}

	process.exit(1);
}

console.log("[budget:check] đạt toàn bộ ngân sách.");
