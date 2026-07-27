// Sinh `docs/LICENSE-ASSETS.md` từ assets-src/sources.json + client/public/assets.json.
//
// Sinh tự động thay vì gõ tay để hồ sơ license KHÔNG BAO GIỜ lệch với file thực có
// trong build (quy tắc vàng #7: mỗi asset phải có một dòng trong hồ sơ).

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Mỗi thư mục đầu ra thuộc về nguồn nào (id trong sources.json). */
const OUTPUT_OWNERS = [
	{ match: /^models\/characters\/knight\.glb$/, sourceId: "kaykit-adventurers-knight" },
	{ match: /^models\/characters\/robot\.glb$/, sourceId: "__robot__" },
	{ match: /^models\/characters\/(fox|parrot)\.glb$/, sourceId: "kenney-cube-pets" },
	// P1-3 — nhân vật mở khoá, cùng bộ KayKit Adventurers với Knight.
	{ match: /^models\/characters\/mage\.glb$/, sourceId: "kaykit-adventurers-mage" },
	{ match: /^models\/characters\/rogue\.glb$/, sourceId: "kaykit-adventurers-rogue" },
	{ match: /^models\/characters\/barbarian\.glb$/, sourceId: "kaykit-adventurers-barbarian" },
	// ⚠ Thứ tự QUAN TRỌNG: `find` lấy mục khớp ĐẦU TIÊN. Các mục riêng của biome
	// ②/③ (P1-2) phải đứng trước mục chung, và mục chung phải liệt kê tên đầy đủ —
	// `obstacle-full-` chung chung sẽ nuốt luôn `obstacle-full-beach.glb` và ghi sai
	// nguồn vào hồ sơ bản quyền, đúng thứ mà file này sinh ra để tránh.
	{
		match: /^models\/props\/(obstacle-low-beach|obstacle-full-beach|obstacle-move-beach|palm-|rocks-sand-|beach-)/,
		sourceId: "kenney-pirate-kit"
	},
	{
		match: /^models\/props\/(obstacle-low-snow|obstacle-high-snow|obstacle-full-snow|obstacle-move-snow|pine-|snowman|snow-)/,
		sourceId: "kenney-holiday-kit"
	},
	// P2-1 — biome ④ Không gian + chiếc tàu bay làm chướng ngại di động của nó.
	{
		match: /^models\/props\/(obstacle-(low|high|full|move)-space|space-)/,
		sourceId: "kenney-space-kit"
	},
	// P2-1 — chướng ngại di động của biome ① (chiếc taxi băng ngang đường).
	{ match: /^models\/props\/obstacle-move-city\.glb$/, sourceId: "kenney-car-kit" },
	{
		match: /^models\/props\/(coin|heart|star|obstacle-low-fence|obstacle-low-spikes|obstacle-full-crate|obstacle-full-barrel|grass|flowers|rocks\.glb|obstacle-high-sign)/,
		sourceId: "kenney-platformer-kit"
	},
	{ match: /^models\/props\/(obstacle-low-barrier|obstacle-cone|streetlight)/, sourceId: "kenney-city-kit-roads" },
	{ match: /^models\/props\/(building-|fence\.glb|planter)/, sourceId: "kenney-city-kit-suburban" },
	{ match: /^models\/props\/tree-/, sourceId: "kenney-nature-kit" },
	{ match: /^textures\/particles\//, sourceId: "kenney-particle-pack" },
	{ match: /^textures\/icons\//, sourceId: "kenney-game-icons" },
	{ match: /^audio\/(ui-|countdown)/, sourceId: "kenney-interface-sounds" },
	{ match: /^audio\/(coin|powerup|fever|jump|boss-appear|near-miss)\.ogg$/, sourceId: "kenney-digital-audio" },
	{ match: /^audio\/(answer-|game-over|new-record|boss-defeat)/, sourceId: "kenney-music-jingles" },
	{ match: /^audio\/(hit|land|gate-bell)\.ogg$/, sourceId: "kenney-impact-sounds" },
	{ match: /^audio\/bgm-menu\.ogg$/, sourceId: "oga-short-loops-menu" },
	{ match: /^audio\/bgm-biome1\.ogg$/, sourceId: "oga-short-loops-run" },
	{ match: /^audio\/bgm-biome2\.ogg$/, sourceId: "oga-short-loops-beach" },
	{ match: /^audio\/bgm-biome3\.ogg$/, sourceId: "oga-short-loops-snow" },
	{ match: /^audio\/bgm-biome4\.ogg$/, sourceId: "oga-observing-the-star" }
];

const ROBOT_SOURCE = {
	id: "__robot__",
	title: "RobotExpressive",
	author: "Tomás Laulhé, chỉnh sửa bởi Don McCurdy",
	license: "CC0-1.0",
	licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
	sourcePage: "https://github.com/mrdoob/three.js/tree/master/examples/models/gltf/RobotExpressive",
	note: "Đã có sẵn trong repo tại `characters/RobotExpressive.glb` từ V1 — giữ nguyên nhân vật `robot`."
};

function findSource(sources, outputUrl) {
	const owner = OUTPUT_OWNERS.find((entry) => entry.match.test(outputUrl));

	if (owner === undefined) {
		return null;
	}

	if (owner.sourceId === "__robot__") {
		return ROBOT_SOURCE;
	}

	return sources.find((source) => source.id === owner.sourceId) ?? null;
}

async function main() {
	const sourcesFile = JSON.parse(await readFile(path.join(rootDir, "assets-src", "sources.json"), "utf8"));
	const assets = JSON.parse(await readFile(path.join(rootDir, "client", "public", "assets.json"), "utf8"));
	const sources = sourcesFile.sources;

	const outputs = [
		...assets.characters.map((character) => character.url),
		...assets.props.map((prop) => prop.url),
		...assets.particles,
		...assets.icons,
		...assets.audio,
		"fonts/baloo-2-*.woff2",
		"fonts/nunito-*.woff2"
	];

	const rows = [];
	const orphans = [];

	for (const outputUrl of outputs) {
		if (outputUrl.startsWith("fonts/") === true) {
			const source = sources.find((entry) => entry.id === (outputUrl.includes("baloo") ? "font-baloo2" : "font-nunito"));
			rows.push({ outputUrl, source });
			continue;
		}

		const source = findSource(sources, outputUrl);

		if (source === null) {
			orphans.push(outputUrl);
			continue;
		}

		rows.push({ outputUrl, source });
	}

	if (orphans.length > 0) {
		throw new Error(
			`Có ${orphans.length} file trong build chưa gắn được nguồn license: ${orphans.join(", ")}. ` +
				"Bổ sung vào OUTPUT_OWNERS trong scripts/assets-license.mjs."
		);
	}

	const today = new Date().toISOString().slice(0, 10);
	const usedSources = [...new Set(rows.map((row) => row.source))];

	const document = [
		"# Hồ sơ bản quyền asset — Toán Runner (V2)",
		"",
		"> **File này do máy sinh** — chạy `npm run assets:license` sau mỗi lần đổi bộ asset.",
		"> Nguồn khai báo tại [`assets-src/sources.json`](../assets-src/sources.json); danh sách file",
		"> đầu ra lấy từ `client/public/assets.json` do `npm run assets:build` sinh ra.",
		"",
		`Cập nhật lần cuối: **${today}** · Tổng số file: **${rows.length}**`,
		"",
		"## 1. Nguyên tắc",
		"",
		"- Chỉ dùng asset **CC0** (model/âm thanh/texture) hoặc **OFL** (font).",
		"- **Cấm tuyệt đối** mọi asset Sonic/SEGA và fan-art IP — kể cả trên Sketchfab.",
		"- Mỗi file trong `client/public/models|audio|textures|fonts` phải có đúng một dòng ở §3.",
		"  `npm run assets:license` sẽ **báo lỗi** nếu có file chưa gắn nguồn.",
		"",
		"## 2. Nguồn đã dùng",
		"",
		"| Nguồn | Tác giả | License | Trang gốc |",
		"|---|---|---|---|",
		...usedSources.map(
			(source) =>
				`| ${source.title} | ${source.author} | [${source.license}](${source.licenseUrl}) | <${source.sourcePage}> |`
		),
		"",
		"### Ghi chú thay thế so với docs/v2/B1",
		"",
		...usedSources
			.filter((source) => typeof source.note === "string" && source.note !== "")
			.map((source) => `- **${source.title}** — ${source.note}`),
		"",
		"## 3. Từng file trong build",
		"",
		"| File trong `client/public/` | Nguồn | License |",
		"|---|---|---|",
		...rows.map((row) => `| \`${row.outputUrl}\` | ${row.source.title} | ${row.source.license} |`),
		"",
		"## 4. Ảnh chụp trang license",
		"",
		"Bản sao văn bản license đi kèm gói tải nằm ở `assets-src/downloads/**/License.txt`",
		"(Kenney) và `assets-src/downloads/licenses/` (KayKit). Thư mục `assets-src/downloads/`",
		"không commit vào git — chạy `npm run assets:fetch` để lấy lại nguyên trạng.",
		""
	].join("\n");

	await writeFile(path.join(rootDir, "docs", "LICENSE-ASSETS.md"), document, "utf8");
	console.log(`[assets:license] docs/LICENSE-ASSETS.md — ${rows.length} file, ${usedSources.length} nguồn.`);
}

main().catch((error) => {
	console.error(`[assets:license] LỖI: ${error.message}`);
	process.exitCode = 1;
});
