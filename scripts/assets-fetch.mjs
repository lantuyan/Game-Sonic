// Tải asset NGUỒN về `assets-src/downloads/` theo khai báo trong assets-src/sources.json.
//
// Tách khỏi assets-build.mjs có chủ đích: fetch cần mạng và chậm (hàng chục MB),
// build thì tất định và chạy trong CI/Vercel từ file đã có sẵn.
//
//   npm run assets:fetch              — tải những gì còn thiếu
//   npm run assets:fetch -- --refresh — quét lại link .zip Kenney rồi tải lại tất cả
//
// Link .zip của Kenney nhúng hash phiên bản nên sẽ đổi theo thời gian; vì vậy
// sources.json chỉ ghi `slug`, script tự quét trang asset để lấy URL hiện hành.

import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcesPath = path.join(rootDir, "assets-src", "sources.json");
const downloadsDir = path.join(rootDir, "assets-src", "downloads");
const lockPath = path.join(rootDir, "assets-src", "downloads.lock.json");

const refresh = process.argv.includes("--refresh");

async function exists(targetPath) {
	try {
		await stat(targetPath);
		return true;
	} catch {
		return false;
	}
}

async function fetchOk(url, description) {
	const response = await fetch(url, {
		redirect: "follow",
		headers: { "User-Agent": "toan-runner-assets-fetch" }
	});

	if (response.ok === false) {
		throw new Error(`${description}: HTTP ${response.status} — ${url}`);
	}

	return response;
}

/** Quét trang asset Kenney để lấy URL .zip hiện hành (hash đổi theo phiên bản). */
async function resolveKenneyZipUrl(slug) {
	const response = await fetchOk(`https://kenney.nl/assets/${slug}`, `Kenney ${slug}`);
	const html = await response.text();
	const pattern = new RegExp(`https://kenney\\.nl/media/pages/assets/${slug}/[^'"\\s]+\\.zip`);
	const match = html.match(pattern);

	if (match === null) {
		throw new Error(`Không tìm thấy link .zip trên https://kenney.nl/assets/${slug} — trang có thể đã đổi cấu trúc.`);
	}

	return match[0];
}

async function downloadTo(url, filePath, description) {
	await mkdir(path.dirname(filePath), { recursive: true });
	const response = await fetchOk(url, description);
	await pipeline(Readable.fromWeb(response.body), createWriteStream(filePath));
	const stats = await stat(filePath);
	return stats.size;
}

async function unzipTo(zipPath, targetDir) {
	await rm(targetDir, { recursive: true, force: true });
	await mkdir(targetDir, { recursive: true });
	// `unzip` có sẵn trên macOS/Linux runner; tránh thêm devDependency chỉ để giải nén.
	await execFileAsync("unzip", ["-o", "-q", zipPath, "-d", targetDir]);
}

async function main() {
	const manifest = JSON.parse(await readFile(sourcesPath, "utf8"));
	const lock = {};
	let downloadedBytes = 0;
	let skipped = 0;

	for (const source of manifest.sources) {
		const targetPath = path.join(downloadsDir, source.target);

		if (refresh === false && (await exists(targetPath))) {
			skipped += 1;
			lock[source.id] = { target: source.target, state: "cached" };
			continue;
		}

		const url = source.kind === "kenney-zip" ? await resolveKenneyZipUrl(source.slug) : source.url;

		if (source.kind === "file") {
			const size = await downloadTo(url, targetPath, source.title);
			downloadedBytes += size;
			lock[source.id] = { target: source.target, url, bytes: size };
			console.log(`  ✓ ${source.title} → ${source.target} (${(size / 1024).toFixed(0)} KB)`);
			continue;
		}

		// zip / kenney-zip: tải rồi giải nén vào thư mục đích.
		const zipPath = path.join(downloadsDir, "_zips", `${source.id}.zip`);
		const size = await downloadTo(url, zipPath, source.title);
		downloadedBytes += size;
		await unzipTo(zipPath, targetPath);
		lock[source.id] = { target: source.target, url, bytes: size };
		console.log(`  ✓ ${source.title} → ${source.target}/ (${(size / 1024 / 1024).toFixed(1)} MB)`);
	}

	await writeFile(lockPath, `${JSON.stringify(lock, null, "\t")}\n`, "utf8");

	console.log(
		`[assets:fetch] xong — tải mới ${(downloadedBytes / 1024 / 1024).toFixed(1)} MB, dùng lại ${skipped} mục đã có.`
	);
	console.log("[assets:fetch] chạy tiếp: npm run assets:build");
}

main().catch((error) => {
	console.error(`[assets:fetch] LỖI: ${error.message}`);
	process.exitCode = 1;
});
