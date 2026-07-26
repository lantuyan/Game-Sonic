// Dựng lại TOÀN BỘ `client/public/` từ `assets-src/downloads/`.
//
// Chạy sau `npm run assets:fetch`. Tất định: cùng input → cùng output, nên CI và
// máy dev ra cùng một bộ file (DoD P0-3).
//
// Việc chính:
//   1. Nhân vật  — giữ ĐÚNG 6 clip (idle/run/jump/slide/death/hit), đổi tên chuẩn,
//                  nén meshopt, texture ≤1024 → mỗi GLB phải ≤500KB.
//   2. Props     — danh sách tuyển chọn từ các kit Kenney, nén như trên.
//   3. Particle  — 12 texture PNG từ Kenney Particle Pack.
//   4. Icon UI   — bộ icon trắng Kenney Game Icons.
//   5. Audio     — SFX chọn lọc + 2 track BGM, đổi tên theo vai trò trong game.
//   6. Font      — WOFF2 subset vietnamese+latin.
//
// Thiếu clip thì fallback sang `run` và GHI RÕ ra console + assets.json (task P0-3).

import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, resample, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const downloadsDir = path.join(rootDir, "assets-src", "downloads");
const publicDir = path.join(rootDir, "client", "public");
const kenneyDir = path.join(downloadsDir, "kenney");

/** Tên clip chuẩn mà CharacterAnimator (P0-5) trông đợi. */
const CANONICAL_CLIPS = ["idle", "run", "jump", "slide", "death", "hit"];
const MAX_TEXTURE_SIZE = 1024;

/**
 * 4 nhân vật P0 + ánh xạ id cũ (plan §3 Q5, hợp đồng §7.3.3).
 * `clips` map tên chuẩn → tên clip trong file nguồn; thiếu thì fallback `run`.
 */
const CHARACTERS = [
	{
		id: "knight",
		legacyId: "sonic",
		label: "Hiệp sĩ",
		source: path.join(downloadsDir, "characters", "Knight.glb"),
		credit: "KayKit — Adventurers (CC0)",
		clips: {
			idle: "Idle",
			run: "Running_A",
			jump: "Jump_Full_Long",
			slide: "Dodge_Forward",
			death: "Death_A",
			hit: "Hit_A"
		}
	},
	{
		id: "robot",
		legacyId: "robot",
		label: "Rô-bốt",
		source: path.join(rootDir, "characters", "RobotExpressive.glb"),
		credit: "Tomás Laulhé / Don McCurdy — RobotExpressive (CC0)",
		clips: {
			idle: "Idle",
			run: "Running",
			jump: "Jump",
			slide: null,
			death: "Death",
			// "No" là cái lắc đầu — đọc ra "ối, trúng rồi" tự nhiên hơn "Punch" (đòn tấn công).
			hit: "No"
		}
	},
	{
		id: "fox",
		legacyId: "horse",
		label: "Cáo",
		source: path.join(kenneyDir, "cube-pets", "Models", "GLB format", "animal-fox.glb"),
		credit: "Kenney — Cube Pets (CC0)",
		clips: {
			idle: "idle",
			run: "run",
			jump: null,
			slide: null,
			death: "gesture-negative",
			hit: "gesture-negative"
		}
	},
	{
		id: "parrot",
		legacyId: "parrot",
		label: "Vẹt",
		source: path.join(kenneyDir, "cube-pets", "Models", "GLB format", "animal-parrot.glb"),
		credit: "Kenney — Cube Pets (CC0)",
		clips: {
			idle: "idle",
			run: "run",
			jump: null,
			slide: null,
			death: "gesture-negative",
			hit: "gesture-negative"
		}
	}
];

/** Props tuyển chọn. `as` = tên file đầu ra (dùng trong code, ổn định hơn tên kit). */
const PROPS = [
	// Vật phẩm
	{ kit: "platformer-kit", file: "coin-gold.glb", as: "coin.glb", group: "items" },
	{ kit: "platformer-kit", file: "heart.glb", as: "heart.glb", group: "items" },
	{ kit: "platformer-kit", file: "star.glb", as: "star.glb", group: "items" },
	// Chướng ngại — 3 loại đọc-được-ngay (plan §4.2)
	{ kit: "platformer-kit", file: "fence-straight.glb", as: "obstacle-low-fence.glb", group: "obstacles" },
	{ kit: "platformer-kit", file: "trap-spikes.glb", as: "obstacle-low-spikes.glb", group: "obstacles" },
	{ kit: "platformer-kit", file: "crate.glb", as: "obstacle-full-crate.glb", group: "obstacles" },
	{ kit: "platformer-kit", file: "crate-strong.glb", as: "obstacle-full-crate-strong.glb", group: "obstacles" },
	{ kit: "platformer-kit", file: "barrel.glb", as: "obstacle-full-barrel.glb", group: "obstacles" },
	{ kit: "city-kit-roads", file: "construction-barrier.glb", as: "obstacle-low-barrier.glb", group: "obstacles" },
	{ kit: "city-kit-roads", file: "construction-cone.glb", as: "obstacle-cone.glb", group: "obstacles" },
	{ kit: "platformer-kit", file: "sign.glb", as: "obstacle-high-sign.glb", group: "obstacles" },
	// Trang trí hai bên đường — biome ① Thành phố + Công viên
	{ kit: "city-kit-suburban", file: "building-type-a.glb", as: "building-a.glb", group: "city" },
	{ kit: "city-kit-suburban", file: "building-type-c.glb", as: "building-b.glb", group: "city" },
	{ kit: "city-kit-suburban", file: "building-type-e.glb", as: "building-c.glb", group: "city" },
	{ kit: "city-kit-suburban", file: "building-type-h.glb", as: "building-d.glb", group: "city" },
	{ kit: "city-kit-suburban", file: "building-type-l.glb", as: "building-e.glb", group: "city" },
	{ kit: "city-kit-suburban", file: "building-type-q.glb", as: "building-f.glb", group: "city" },
	{ kit: "city-kit-suburban", file: "fence-1x4.glb", as: "fence.glb", group: "city" },
	{ kit: "city-kit-suburban", file: "planter.glb", as: "planter.glb", group: "city" },
	{ kit: "city-kit-roads", file: "light-square.glb", as: "streetlight.glb", group: "city" },
	{ kit: "nature-kit", file: "tree_default.glb", as: "tree-a.glb", group: "park", format: "GLTF format" },
	{ kit: "nature-kit", file: "tree_oak.glb", as: "tree-b.glb", group: "park", format: "GLTF format" },
	{ kit: "nature-kit", file: "tree_cone.glb", as: "tree-c.glb", group: "park", format: "GLTF format" },
	{ kit: "nature-kit", file: "tree_fat.glb", as: "tree-d.glb", group: "park", format: "GLTF format" },
	{ kit: "platformer-kit", file: "grass.glb", as: "grass.glb", group: "park" },
	{ kit: "platformer-kit", file: "flowers.glb", as: "flowers.glb", group: "park" },
	{ kit: "platformer-kit", file: "rocks.glb", as: "rocks.glb", group: "park" }
];

const PARTICLES = [
	"circle_05.png",
	"dirt_02.png",
	"flare_01.png",
	"light_01.png",
	"magic_05.png",
	"muzzle_01.png",
	"smoke_04.png",
	"spark_04.png",
	"star_08.png",
	"trace_01.png",
	"twirl_02.png",
	"symbol_01.png"
];

const ICONS = [
	"star.png",
	"trophy.png",
	"medal1.png",
	"gear.png",
	"home.png",
	"pause.png",
	"return.png",
	"musicOn.png",
	"musicOff.png",
	"audioOn.png",
	"audioOff.png",
	"checkmark.png",
	"cross.png",
	"locked.png",
	"unlocked.png",
	"information.png",
	"arrowLeft.png",
	"arrowRight.png",
	"arrowUp.png",
	"arrowDown.png"
];

/** SFX: vai trò trong game → file nguồn. Tên đầu ra là vai trò, không phải tên Kenney. */
const SOUNDS = [
	{ as: "ui-click.ogg", kit: "interface-sounds", file: "Audio/click_002.ogg" },
	{ as: "ui-back.ogg", kit: "interface-sounds", file: "Audio/back_001.ogg" },
	{ as: "ui-confirm.ogg", kit: "interface-sounds", file: "Audio/confirmation_001.ogg" },
	{ as: "countdown.ogg", kit: "interface-sounds", file: "Audio/bong_001.ogg" },
	{ as: "coin.ogg", kit: "digital-audio", file: "Audio/pepSound1.ogg" },
	{ as: "powerup.ogg", kit: "digital-audio", file: "Audio/powerUp2.ogg" },
	{ as: "fever.ogg", kit: "digital-audio", file: "Audio/zapThreeToneUp.ogg" },
	{ as: "answer-correct.ogg", kit: "music-jingles", file: "Audio/8-Bit jingles/jingles_NES07.ogg" },
	{ as: "answer-wrong.ogg", kit: "music-jingles", file: "Audio/8-Bit jingles/jingles_NES13.ogg" },
	{ as: "game-over.ogg", kit: "music-jingles", file: "Audio/8-Bit jingles/jingles_NES09.ogg" },
	{ as: "new-record.ogg", kit: "music-jingles", file: "Audio/8-Bit jingles/jingles_NES00.ogg" },
	{ as: "hit.ogg", kit: "impact-sounds", file: "Audio/impactGeneric_light_002.ogg" },
	{ as: "land.ogg", kit: "impact-sounds", file: "Audio/footstep_concrete_003.ogg" },
	{ as: "jump.ogg", kit: "digital-audio", file: "Audio/highUp.ogg" },
	{ as: "gate-bell.ogg", kit: "impact-sounds", file: "Audio/impactBell_heavy_001.ogg" }
];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
	"meshopt.encoder": MeshoptEncoder
});

const report = { characters: [], props: [], fallbacks: [], sizes: {} };

async function fileSize(filePath) {
	const stats = await stat(filePath);
	return stats.size;
}

function formatKb(bytes) {
	return `${(bytes / 1024).toFixed(0)} KB`;
}

/**
 * Nén chung cho mọi GLB đầu ra: hàn đỉnh, bỏ rác, texture ≤1024, meshopt.
 *
 * `meshopt({method: FILTER})` là mấu chốt của ngân sách 500KB/nhân vật: nó lọc +
 * lượng tử hoá cả **track animation** (quaternion/exponential filter), chỗ chiếm
 * ~1.5MB trong bản Knight gốc — chỉ nén mesh thôi thì không tài nào đạt ngân sách.
 */
async function optimizeDocument(document) {
	await document.transform(
		// resample() rút gọn keyframe thừa. Dung sai 0.0005 vẫn mượt mắt trên nhân vật
		// cao ~1.75 unit nhưng bỏ được phần lớn keyframe trùng lặp của clip KayKit.
		resample({ tolerance: 0.0005 }),
		// dedup() PHẢI chạy SAU resample: resample tách mỗi sampler thành accessor riêng
		// (Knight → 8700 accessor, riêng phần JSON đã ~960KB). dedup gộp chúng lại.
		dedup(),
		prune({ keepAttributes: false, keepLeaves: false }),
		weld(),
		textureCompress({
			encoder: sharp,
			targetFormat: "webp",
			resize: [MAX_TEXTURE_SIZE, MAX_TEXTURE_SIZE],
			resizeFilter: "lanczos3"
		}),
		meshopt({
			encoder: MeshoptEncoder,
			level: "high",
			method: EXTMeshoptCompression.EncoderMethod.FILTER
		})
	);
}

async function buildCharacters() {
	const outputDir = path.join(publicDir, "models", "characters");
	await mkdir(outputDir, { recursive: true });

	for (const character of CHARACTERS) {
		const document = await io.read(character.source);
		const root = document.getRoot();
		const animationsByName = new Map();

		for (const animation of root.listAnimations()) {
			animationsByName.set(animation.getName(), animation);
		}

		const keep = new Map();

		for (const canonicalName of CANONICAL_CLIPS) {
			const sourceName = character.clips[canonicalName];
			const animation = sourceName === null ? undefined : animationsByName.get(sourceName);

			if (animation === undefined) {
				// Thiếu clip → dùng `run` và ghi vào báo cáo (yêu cầu của task P0-3).
				report.fallbacks.push(
					`${character.id}.${canonicalName} → run` +
						(sourceName === null ? " (nguồn không có clip này)" : ` (không tìm thấy "${sourceName}")`)
				);
				continue;
			}

			keep.set(canonicalName, animation);
		}

		if (keep.has("run") === false) {
			throw new Error(
				`${character.id}: không tìm thấy clip run "${character.clips.run}" — không thể dựng nhân vật.`
			);
		}

		// Xóa mọi clip không dùng TRƯỚC khi nén: đây là chỗ giảm dung lượng lớn nhất
		// (Knight nguồn có 60+ clip, chỉ giữ 6).
		//
		// ⚠ Phải dispose channel + sampler TRƯỚC animation. Chỉ gọi animation.dispose()
		// sẽ để lại sampler mồ côi vẫn giữ tham chiếu tới accessor, nên prune() không
		// dọn được — Knight kẹt ở 8.839 accessor (riêng phần JSON ~960KB) thay vì 675.
		const kept = new Set(keep.values());

		for (const animation of root.listAnimations()) {
			if (kept.has(animation) === true) {
				continue;
			}

			for (const channel of animation.listChannels()) {
				channel.dispose();
			}

			for (const sampler of animation.listSamplers()) {
				sampler.dispose();
			}

			animation.dispose();
		}

		for (const [canonicalName, animation] of keep) {
			animation.setName(canonicalName);
		}

		await optimizeDocument(document);

		const outputPath = path.join(outputDir, `${character.id}.glb`);
		await io.write(outputPath, document);

		const size = await fileSize(outputPath);
		report.characters.push({
			id: character.id,
			legacyId: character.legacyId,
			label: character.label,
			credit: character.credit,
			clips: [...keep.keys()],
			bytes: size
		});
		console.log(`  ✓ nhân vật ${character.id}: ${[...keep.keys()].join("/")} — ${formatKb(size)}`);
	}
}

async function buildProps() {
	const outputDir = path.join(publicDir, "models", "props");
	await mkdir(outputDir, { recursive: true });

	for (const prop of PROPS) {
		const format = prop.format ?? "GLB format";
		const sourcePath = path.join(kenneyDir, prop.kit, "Models", format, prop.file);
		const document = await io.read(sourcePath);

		await optimizeDocument(document);

		const outputPath = path.join(outputDir, prop.as);
		await io.write(outputPath, document);
		report.props.push({
			as: prop.as,
			kit: prop.kit,
			file: prop.file,
			group: prop.group,
			bytes: await fileSize(outputPath)
		});
	}

	const total = report.props.reduce((sum, prop) => sum + prop.bytes, 0);
	console.log(`  ✓ ${report.props.length} props — tổng ${formatKb(total)}`);
}

async function copyList(names, sourcePathBuilder, outputDir, label) {
	await mkdir(outputDir, { recursive: true });
	let total = 0;

	for (const name of names) {
		const outputPath = path.join(outputDir, name);
		await cp(sourcePathBuilder(name), outputPath);
		total += await fileSize(outputPath);
	}

	console.log(`  ✓ ${names.length} ${label} — tổng ${formatKb(total)}`);
	return total;
}

async function buildFonts() {
	const outputDir = path.join(publicDir, "fonts");
	await mkdir(outputDir, { recursive: true });
	let total = 0;

	for (const family of ["baloo-2", "nunito"]) {
		const sourceDir = path.join(downloadsDir, "fonts", family);

		for (const entry of await readdir(sourceDir)) {
			if (entry.endsWith(".woff2") === false) {
				continue;
			}

			const outputPath = path.join(outputDir, entry);
			await cp(path.join(sourceDir, entry), outputPath);
			total += await fileSize(outputPath);
		}
	}

	console.log(`  ✓ font WOFF2 — tổng ${formatKb(total)}`);
	return total;
}

async function buildAudio() {
	const outputDir = path.join(publicDir, "audio");
	await mkdir(outputDir, { recursive: true });
	let total = 0;

	for (const sound of SOUNDS) {
		const outputPath = path.join(outputDir, sound.as);
		await cp(path.join(kenneyDir, sound.kit, sound.file), outputPath);
		total += await fileSize(outputPath);
	}

	for (const track of ["bgm-menu.ogg", "bgm-biome1.ogg"]) {
		const outputPath = path.join(outputDir, track);
		await cp(path.join(downloadsDir, "audio", track), outputPath);
		total += await fileSize(outputPath);
	}

	console.log(`  ✓ ${SOUNDS.length} SFX + 2 BGM — tổng ${formatKb(total)}`);
	return total;
}

/** Bản kê máy đọc được — budget-check và AssetManager (P0-5) dùng chung. */
async function writeAssetManifest() {
	const manifest = {
		generatedBy: "scripts/assets-build.mjs",
		characters: report.characters.map((character) => ({
			id: character.id,
			legacyId: character.legacyId,
			label: character.label,
			url: `models/characters/${character.id}.glb`,
			clips: character.clips,
			bytes: character.bytes
		})),
		props: report.props.map((prop) => ({
			url: `models/props/${prop.as}`,
			group: prop.group,
			bytes: prop.bytes
		})),
		particles: PARTICLES.map((name) => `textures/particles/${name}`),
		icons: ICONS.map((name) => `textures/icons/${name}`),
		audio: [...SOUNDS.map((sound) => `audio/${sound.as}`), "audio/bgm-menu.ogg", "audio/bgm-biome1.ogg"],
		clipFallbacks: report.fallbacks
	};

	await writeFile(path.join(publicDir, "assets.json"), `${JSON.stringify(manifest, null, "\t")}\n`, "utf8");
}

async function main() {
	console.log("[assets:build] dựng client/public/ từ assets-src/downloads/…");

	// Xóa sạch để build tất định — mọi thứ trong các thư mục này đều do script sinh.
	for (const directory of ["models", "textures", "audio", "fonts"]) {
		await rm(path.join(publicDir, directory), { recursive: true, force: true });
	}

	await buildCharacters();
	await buildProps();
	report.sizes.particles = await copyList(
		PARTICLES,
		(name) => path.join(kenneyDir, "particle-pack", "PNG (Transparent)", name),
		path.join(publicDir, "textures", "particles"),
		"particle texture"
	);
	report.sizes.icons = await copyList(
		ICONS,
		(name) => path.join(kenneyDir, "game-icons", "PNG", "White", "2x", name),
		path.join(publicDir, "textures", "icons"),
		"icon UI"
	);
	report.sizes.audio = await buildAudio();
	report.sizes.fonts = await buildFonts();
	await writeAssetManifest();

	if (report.fallbacks.length > 0) {
		console.log("[assets:build] clip thiếu (đã fallback sang `run`):");

		for (const line of report.fallbacks) {
			console.log(`    · ${line}`);
		}
	}

	console.log("[assets:build] xong.");
}

main().catch((error) => {
	console.error(`[assets:build] LỖI: ${error.message}`);
	process.exitCode = 1;
});
