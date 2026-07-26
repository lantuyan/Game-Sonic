// Stub P0-1 — budget-check (plan §6.3: initial ≤10MB, nhân vật ≤500KB, biome ≤3MB).
// Ngưỡng thật + fail CI vào ở P0-3 khi có asset; hiện chỉ đo tổng dung lượng build V2.
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const v2Root = (process.env.V2_ROOT ?? "v2").replace(/^\/+|\/+$/g, "");
const buildDir = resolve(import.meta.dirname, "..", "public", v2Root);

function directorySizeBytes(dir) {
	let total = 0;

	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const entryPath = join(dir, entry.name);
		total += entry.isDirectory() ? directorySizeBytes(entryPath) : statSync(entryPath).size;
	}

	return total;
}

try {
	const sizeMb = directorySizeBytes(buildDir) / (1024 * 1024);
	console.log(`[budget:check] stub P0-1 — build V2 (${buildDir}): ${sizeMb.toFixed(2)} MB (ngân sách initial ≤ 10 MB; ngưỡng fail thật vào ở P0-3).`);
} catch {
	console.log(`[budget:check] stub P0-1 — chưa có thư mục build (${buildDir}); chạy \`npm run build:client\` trước.`);
}
