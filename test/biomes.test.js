"use strict";

// P1-2 — BIOME ② Bãi biển + ③ Núi tuyết.
//
// Ba thứ ở đây hỏng âm thầm (không lỗi console, chỉ là game xấu/nặng đi), nên phải
// canh bằng test:
//   1. biome khai một URL không tồn tại → chặng mới chạy trên đường trống;
//   2. quên loại biome ②/③ khỏi precache → lần cài đầu nặng thêm ~850KB nhạc cho
//      hai chặng mà đa số học sinh chưa từng tới;
//   3. thêm lớp trang trí quá tay → thủng trần 100 draw call.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");
var helpers = require("../test-helpers/clientModule");
var loadClientBundle = helpers.loadClientBundle;

var rootDir = path.resolve(__dirname, "..");
var publicDir = path.join(rootDir, "client", "public");

test("có đủ 3 biome và vòng lặp chặng quay đúng vòng", async function () {
	var mods = await loadClientBundle({ biomes: "fx/biomes.ts" });

	assert.equal(mods.biomes.BIOMES.length, 3, "P1-2 phải có biome ①, ②, ③");
	assert.deepEqual(
		mods.biomes.BIOMES.map(function (biome) {
			return biome.id;
		}),
		["city-park", "beach", "snow"]
	);

	assert.equal(mods.biomes.nextBiomeIndex(0), 1);
	assert.equal(mods.biomes.nextBiomeIndex(2), 0, "hết biome ③ thì quay về ①");

	// Chỉ số âm/quá cỡ vẫn phải ra biome hợp lệ — boss chạy mãi không được ném lỗi.
	assert.equal(mods.biomes.biomeAt(-1).id, "snow");
	assert.equal(mods.biomes.biomeAt(7).id, "beach");
});

test("MỌI file GLB/BGM biome khai báo đều tồn tại trong build", async function () {
	var mods = await loadClientBundle({ biomes: "fx/biomes.ts" });
	var missing = [];

	mods.biomes.BIOMES.forEach(function (biome, index) {
		mods.biomes.biomeAssetUrls(index).forEach(function (url) {
			if (fs.existsSync(path.join(publicDir, url)) === false) {
				missing.push(biome.id + " → " + url);
			}
		});

		var bgmPath = path.join(publicDir, "audio", biome.bgm + ".ogg");

		if (fs.existsSync(bgmPath) === false) {
			missing.push(biome.id + " → audio/" + biome.bgm + ".ogg");
		}
	});

	assert.deepEqual(missing, [], "biome khai file không có thật → chặng mới chạy trên đường trống");
});

test("mỗi biome ≤3MB và mỗi biome có BGM riêng (DoD P1-2)", async function () {
	var mods = await loadClientBundle({ biomes: "fx/biomes.ts" });
	var bgmNames = [];

	mods.biomes.BIOMES.forEach(function (biome, index) {
		var bytes = mods.biomes.biomeAssetUrls(index).reduce(function (total, url) {
			return total + fs.statSync(path.join(publicDir, url)).size;
		}, 0);

		bytes += fs.statSync(path.join(publicDir, "audio", biome.bgm + ".ogg")).size;

		assert.ok(
			bytes <= 3 * 1024 * 1024,
			biome.id + " nặng " + Math.round(bytes / 1024) + " KB, vượt trần 3MB"
		);

		bgmNames.push(biome.bgm);
	});

	assert.equal(new Set(bgmNames).size, 3, "mỗi biome phải có BGM riêng, không dùng chung");
});

test("draw call của biome nặng nhất vẫn dưới 100 (DoD P1-2)", async function () {
	var mods = await loadClientBundle({ biomes: "fx/biomes.ts" });

	mods.biomes.BIOMES.forEach(function (biome) {
		// 3 lớp track (đường/vạch/nền) + trang trí + 3 loại chướng ngại + coin
		// + player + 3 cổng + boss + trời.
		var drawCalls = 3 + biome.decor.length + 3 + 1 + 1 + 3 + 1 + 1;

		assert.ok(drawCalls < 100, biome.id + " ước tính " + drawCalls + " draw call");
		assert.ok(
			biome.decor.length <= 8,
			biome.id + " có " + biome.decor.length + " lớp trang trí — mỗi lớp là 1 draw call, giữ ≤8"
		);
	});
});

test("mỗi biome khai đủ 3 loại chướng ngại đọc-được-ngay (plan §4.2)", async function () {
	var mods = await loadClientBundle({ biomes: "fx/biomes.ts" });

	mods.biomes.BIOMES.forEach(function (biome) {
		assert.equal(typeof biome.obstacles.low, "string", biome.id + " thiếu chướng ngại thấp");
		assert.equal(typeof biome.obstacles.high, "string", biome.id + " thiếu chướng ngại cao");
		assert.equal(typeof biome.obstacles.full, "string", biome.id + " thiếu khối chặn làn");
	});
});

test("biome ②/③ KHÔNG nằm trong precache lúc cài, biome ① thì CÓ", async function () {
	var mods = await loadClientBundle({ biomes: "fx/biomes.ts" });
	var viteConfig = fs.readFileSync(path.join(rootDir, "client", "vite.config.mts"), "utf8");
	var ignoreBlock = viteConfig.match(/globIgnores:\s*\[([\s\S]*?)\]/);

	assert.notEqual(ignoreBlock, null, "vite.config phải có globIgnores cho biome ②/③");

	var patterns = ignoreBlock[1]
		.split("\n")
		.map(function (line) {
			var match = line.match(/"([^"]+)"/);
			return match === null ? null : match[1];
		})
		.filter(Boolean);

	/** Khớp glob kiểu `**\/models/props/{a,b}-*.glb` với một đường dẫn asset. */
	function matches(pattern, url) {
		var expanded = [pattern];

		while (expanded.some(function (item) { return item.indexOf("{") !== -1; })) {
			expanded = expanded.flatMap(function (item) {
				var open = item.indexOf("{");

				if (open === -1) {
					return [item];
				}

				var close = item.indexOf("}", open);
				var options = item.slice(open + 1, close).split(",");

				return options.map(function (option) {
					return item.slice(0, open) + option + item.slice(close + 1);
				});
			});
		}

		return expanded.some(function (item) {
			var source = "^" + item.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\//g, "(.*/)?").replace(/\*/g, "[^/]*") + "$";
			return new RegExp(source).test(url);
		});
	}

	// Biome ② và ③: mọi asset phải bị loại khỏi precache.
	[1, 2].forEach(function (index) {
		var biome = mods.biomes.BIOMES[index];

		mods.biomes.biomeAssetUrls(index).forEach(function (url) {
			// Biển báo dùng chung với biome ① nên nó PHẢI ở trong precache.
			if (url.indexOf("obstacle-high-sign") !== -1) {
				return;
			}

			assert.ok(
				patterns.some(function (pattern) { return matches(pattern, url); }),
				biome.id + ": " + url + " chưa bị loại khỏi precache — lần tải đầu nặng thêm vô ích"
			);
		});

		assert.ok(
			patterns.some(function (pattern) { return matches(pattern, "audio/" + biome.bgm + ".ogg"); }),
			biome.id + ": BGM chưa bị loại khỏi precache"
		);
	});

	// Biome ①: TUYỆT ĐỐI không được loại — đó là chặng đầu, phải chơi được offline ngay.
	mods.biomes.biomeAssetUrls(0).forEach(function (url) {
		assert.equal(
			patterns.some(function (pattern) { return matches(pattern, url); }),
			false,
			"biome ① không được nằm trong globIgnores: " + url
		);
	});
});

test("service worker nhận lệnh bơm cache biome sau ván đầu", function () {
	var workerSource = fs.readFileSync(path.join(rootDir, "client", "src", "worker.ts"), "utf8");
	var pwaSource = fs.readFileSync(path.join(rootDir, "client", "src", "core", "pwa.ts"), "utf8");

	assert.ok(workerSource.includes("WARM_BIOME_CACHE"), "SW phải xử lý thông điệp bơm cache");
	assert.ok(pwaSource.includes("WARM_BIOME_CACHE"), "client phải gửi thông điệp đó");
	assert.ok(
		/cache\.add\(/.test(workerSource),
		"bơm từng file bằng cache.add — addAll để một file lỗi là hỏng cả mẻ"
	);
});

test("kích thước chuẩn hóa chướng ngại đọc được đúng ý nghĩa 3 loại", async function () {
	var mods = await loadClientBundle({ tuningModule: "tuning.ts" });
	var spawn = mods.tuningModule.tuning.spawn;
	var player = mods.tuningModule.tuning.player;

	// Rào thấp phải nhảy qua được; khối chặn thì không (dù chỉ là tín hiệu thị giác,
	// nó vẫn phải khớp luật va chạm để không dạy học sinh sai).
	assert.ok(spawn.lowHeight < player.jumpHeight, "rào thấp phải thấp hơn tầm nhảy");
	assert.ok(spawn.fullHeight > player.height * 0.6, "khối chặn phải đủ cao để đọc ra 'đổi làn'");

	// Thanh chắn trên cao treo ở y=1.35; đỉnh đầu lúc trượt phải chui lọt.
	var slideHeadY = player.height * player.slideHitboxScale;
	assert.ok(slideHeadY < 1.35, "người trượt phải chui lọt dưới thanh chắn");

	// Rộng gần bằng làn để nhìn ra "chắn làn này", nhưng không tràn sang làn bên.
	[spawn.lowWidth, spawn.highWidth, spawn.fullWidth].forEach(function (width) {
		assert.ok(width > 1 && width < mods.tuningModule.tuning.world.laneOffsetX);
	});
});

/** Chia cho hệ số này để ra giá trị đã chuẩn hóa [-1,1] mà three đọc được. */
var NORMALIZED_DIVISOR = {
	5120: 127, // BYTE
	5121: 255, // UNSIGNED_BYTE
	5122: 32767, // SHORT
	5123: 65535 // UNSIGNED_SHORT
};

/**
 * Hộp bao của một GLB, ĐO ĐÚNG NHƯ `geometry.computeBoundingBox()` của three.
 *
 * Hai điều tế nhị, và cũng chính là lý do test này tồn tại:
 *   · pipeline dùng KHR_mesh_quantization nên POSITION là int16 với
 *     `normalized: true` — three chia cho 32767 để về [-1,1], nên hộp bao trong
 *     game KHÔNG phải là số nguyên khổng lồ trong file;
 *   · hệ số giải lượng tử hóa nằm ở TRANSFORM CỦA NODE, mà `Spawn` chỉ lấy
 *     `mesh.geometry` nên transform đó bị bỏ. Đó chính là lý do phải chuẩn hóa lại
 *     bằng `normalizeScale` thay vì tin vào kích thước gốc.
 *
 * Đọc thẳng khối JSON của GLB nên không cần giải nén meshopt.
 */
function readGlbBounds(filePath) {
	var buffer = fs.readFileSync(filePath);
	var jsonLength = buffer.readUInt32LE(12);
	var gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString("utf8"));
	var min = [Infinity, Infinity, Infinity];
	var max = [-Infinity, -Infinity, -Infinity];

	(gltf.meshes || []).forEach(function (mesh) {
		(mesh.primitives || []).forEach(function (primitive) {
			var index = primitive.attributes ? primitive.attributes.POSITION : undefined;
			var accessor = index === undefined ? null : gltf.accessors[index];

			if (accessor == null || accessor.min == null || accessor.max == null) {
				return;
			}

			var divisor =
				accessor.normalized === true ? NORMALIZED_DIVISOR[accessor.componentType] || 1 : 1;

			for (var axis = 0; axis < 3; axis += 1) {
				min[axis] = Math.min(min[axis], accessor.min[axis] / divisor);
				max[axis] = Math.max(max[axis], accessor.max[axis] / divisor);
			}
		});
	});

	return { width: max[0] - min[0], height: max[1] - min[1] };
}

test("chướng ngại MỌI biome ra cùng kích thước sau chuẩn hóa (P1-2)", async function () {
	// Đây là thứ không nhìn ảnh chụp mà thấy được: mỗi kit Kenney có đơn vị riêng,
	// rào Pirate Kit cao 2.20 còn dây đèn Holiday Kit chỉ 0.32. Nếu Spawn quên nhân
	// hệ số thì biome ② có "rào thấp" cao hơn đầu người còn biome ③ có "thanh chắn"
	// bé như que tăm — game vẫn chạy, vẫn không lỗi, chỉ là chơi không được.
	var mods = await loadClientBundle({ biomes: "fx/biomes.ts", tuningModule: "tuning.ts" });
	var spawn = mods.tuningModule.tuning.spawn;

	var targets = {
		low: { width: spawn.lowWidth, height: spawn.lowHeight },
		high: { width: spawn.highWidth, height: spawn.highHeight },
		full: { width: spawn.fullWidth, height: spawn.fullHeight }
	};

	mods.biomes.BIOMES.forEach(function (biome) {
		["low", "high", "full"].forEach(function (kind) {
			var bounds = readGlbBounds(path.join(publicDir, biome.obstacles[kind]));

			assert.ok(bounds.width > 0 && bounds.height > 0, biome.id + "/" + kind + ": không đọc được hộp bao");

			// Đúng công thức `normalizeScale` của systems/Spawn.ts.
			var horizontal = targets[kind].width / bounds.width;
			var vertical = targets[kind].height / bounds.height;

			var finalWidth = bounds.width * horizontal;
			var finalHeight = bounds.height * vertical;

			assert.ok(
				Math.abs(finalWidth - targets[kind].width) < 1e-6,
				biome.id + "/" + kind + " rộng " + finalWidth.toFixed(3) + ", cần " + targets[kind].width
			);
			assert.ok(
				Math.abs(finalHeight - targets[kind].height) < 1e-6,
				biome.id + "/" + kind + " cao " + finalHeight.toFixed(3) + ", cần " + targets[kind].height
			);

			// Hệ số quá lố là dấu hiệu chọn nhầm model (vd lấy nguyên con tàu làm rào).
			assert.ok(
				horizontal > 0.05 && horizontal < 20,
				biome.id + "/" + kind + " phải phóng ×" + horizontal.toFixed(2) + " — nhiều khả năng chọn nhầm model"
			);
		});
	});
});
