"use strict";

// Nạp module TypeScript của client vào `node --test`.
//
// Vì sao cần: logic lõi (fixed timestep, input buffer, luật pattern, luật cổng…)
// phải kiểm được tất định, không phụ thuộc trình duyệt. esbuild đã có sẵn trong
// node_modules (vite kéo về) nên không thêm devDependency nào.
//
// Cách dùng:
//   var loadClientModule = require("../test-helpers/clientModule").loadClientModule;
//   var Engine = await loadClientModule("core/Engine.ts");

var fs = require("fs");
var os = require("os");
var path = require("path");
var { pathToFileURL } = require("url");
var esbuild = require("esbuild");

var CLIENT_SRC_DIR = path.resolve(__dirname, "..", "client", "src");
var cacheDir = null;
var moduleCache = new Map();

function getCacheDir() {
	if (cacheDir === null) {
		cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "toan-runner-client-"));
	}

	return cacheDir;
}

/**
 * Bundle một file .ts trong client/src rồi import ra ESM.
 * `three` để external — test lõi không được đụng WebGL.
 */
async function loadClientModule(relativePath) {
	if (moduleCache.has(relativePath) === true) {
		return moduleCache.get(relativePath);
	}

	var entryPath = path.join(CLIENT_SRC_DIR, relativePath);

	if (fs.existsSync(entryPath) === false) {
		throw new Error("Không tìm thấy module client: " + entryPath);
	}

	var outFile = path.join(getCacheDir(), relativePath.replace(/[\\/]/g, "__").replace(/\.ts$/, ".mjs"));

	await esbuild.build({
		entryPoints: [entryPath],
		outfile: outFile,
		bundle: true,
		format: "esm",
		platform: "neutral",
		target: "node20",
		external: ["three", "howler", "postprocessing"],
		alias: {
			"@": CLIENT_SRC_DIR
		},
		logLevel: "silent"
	});

	var loaded = await import(pathToFileURL(outFile).href);
	moduleCache.set(relativePath, loaded);
	return loaded;
}

/**
 * Nạp một module client nhưng THAY một vài package ngoài bằng bản giả.
 *
 * Dùng cho module bọc thư viện bên thứ ba (vd AudioManager bọc Howler): thay vì
 * phải chạy Howler thật (cần WebAudio), ta trỏ `howler` sang một shim tí hon
 * re-export từ `globalThis`, nhờ vậy test soi được từng lời gọi play/volume/fade.
 *
 *   var module = await loadClientModuleWithStubs("core/AudioManager.ts", {
 *     howler: "globalThis.__fakeHowler"
 *   });
 */
async function loadClientModuleWithStubs(relativePath, stubs) {
	var stubNames = Object.keys(stubs).sort();
	var cacheKey = "stubs:" + relativePath + "|" + stubNames.map(function (name) {
		return name + "=" + stubs[name];
	}).join(",");

	if (moduleCache.has(cacheKey) === true) {
		return moduleCache.get(cacheKey);
	}

	var aliases = {};
	var shimDir = path.join(getCacheDir(), "shims");
	fs.mkdirSync(shimDir, { recursive: true });

	stubNames.forEach(function (name) {
		var shimPath = path.join(shimDir, name.replace(/[^a-z0-9]/gi, "_") + ".mjs");
		// Proxy động: đọc globalThis mỗi lần truy cập nên test đổi stub giữa chừng
		// vẫn có hiệu lực, không bị đóng băng giá trị lúc nạp.
		fs.writeFileSync(
			shimPath,
			"const target = () => " + stubs[name] + ";\n" +
				"export const Howl = new Proxy(function () {}, {\n" +
				"  construct: (_t, args) => new (target().Howl)(...args),\n" +
				"  get: (_t, key) => target().Howl[key]\n" +
				"});\n" +
				"export const Howler = new Proxy({}, { get: (_t, key) => target().Howler[key] });\n",
			"utf8"
		);
		aliases[name] = shimPath;
	});

	var entryPath = path.join(CLIENT_SRC_DIR, relativePath);
	var outFile = path.join(
		getCacheDir(),
		"stubbed-" + relativePath.replace(/[\\/]/g, "__").replace(/\.ts$/, "") + ".mjs"
	);

	await esbuild.build({
		entryPoints: [entryPath],
		outfile: outFile,
		bundle: true,
		format: "esm",
		platform: "neutral",
		target: "node20",
		external: ["three", "postprocessing"],
		alias: Object.assign({ "@": CLIENT_SRC_DIR }, aliases),
		logLevel: "silent"
	});

	var loaded = await import(pathToFileURL(outFile).href);
	moduleCache.set(cacheKey, loaded);
	return loaded;
}

/**
 * Nạp NHIỀU module trong CÙNG một bundle — giống hệt lúc chạy thật dưới Vite.
 *
 * Cần thiết khi test trạng thái dùng chung: `loadClientModule` gọi 2 lần sẽ tạo 2
 * bundle độc lập, mỗi bundle có bản sao `tuning.ts` riêng, nên sửa tuning ở bundle
 * này không ảnh hưởng bundle kia — trong khi ứng dụng thật chỉ có MỘT bản.
 *
 *   var mods = await loadClientBundle({ curve: "fx/CurvedWorld.ts", tuning: "tuning.ts" });
 *   mods.tuning.setTuningValue(...)  // ảnh hưởng đúng mods.curve
 */
async function loadClientBundle(entryMap) {
	var names = Object.keys(entryMap).sort();
	var cacheKey = "bundle:" + names.map(function (name) { return name + "=" + entryMap[name]; }).join("|");

	if (moduleCache.has(cacheKey) === true) {
		return moduleCache.get(cacheKey);
	}

	var contents = names
		.map(function (name) {
			var importPath = path.join(CLIENT_SRC_DIR, entryMap[name]).replace(/\\/g, "/");
			return "export * as " + name + " from " + JSON.stringify(importPath) + ";";
		})
		.join("\n");

	var outFile = path.join(getCacheDir(), "bundle-" + names.join("-") + "-" + names.length + ".mjs");

	await esbuild.build({
		stdin: {
			contents: contents,
			resolveDir: CLIENT_SRC_DIR,
			sourcefile: "test-bundle.ts",
			loader: "ts"
		},
		outfile: outFile,
		bundle: true,
		format: "esm",
		platform: "neutral",
		target: "node20",
		external: ["three", "howler", "postprocessing"],
		alias: { "@": CLIENT_SRC_DIR },
		logLevel: "silent"
	});

	var loaded = await import(pathToFileURL(outFile).href);
	moduleCache.set(cacheKey, loaded);
	return loaded;
}

/**
 * Dựng bộ DOM/timing giả tối thiểu cho các module chạm window/document.
 * Trả về hàm dọn dẹp + bộ điều khiển thời gian để test bấm nhịp thủ công.
 */
function installBrowserStubs() {
	var originals = {};
	var listenersByTarget = new Map();
	var nowMs = 0;
	var rafCallbacks = new Map();
	var nextRafId = 1;

	function makeTarget(extra) {
		var target = Object.assign(
			{
				addEventListener: function (type, listener) {
					var byType = listenersByTarget.get(target) || new Map();
					var list = byType.get(type) || [];
					list.push(listener);
					byType.set(type, list);
					listenersByTarget.set(target, byType);
				},
				removeEventListener: function (type, listener) {
					var byType = listenersByTarget.get(target);
					var list = byType == null ? null : byType.get(type);

					if (list == null) {
						return;
					}

					var index = list.indexOf(listener);

					if (index !== -1) {
						list.splice(index, 1);
					}
				},
				dispatch: function (type, event) {
					var byType = listenersByTarget.get(target);
					var list = byType == null ? byType : byType.get(type);

					(list || []).slice().forEach(function (listener) {
						listener(event || { type: type });
					});
				}
			},
			extra || {}
		);

		return target;
	}

	var documentStub = makeTarget({ visibilityState: "visible" });
	var windowStub = makeTarget({ devicePixelRatio: 1 });

	function setGlobal(name, value) {
		originals[name] = Object.prototype.hasOwnProperty.call(globalThis, name)
			? { present: true, value: globalThis[name] }
			: { present: false };
		globalThis[name] = value;
	}

	setGlobal("document", documentStub);
	setGlobal("window", windowStub);
	setGlobal("performance", {
		now: function () {
			return nowMs;
		}
	});
	setGlobal("requestAnimationFrame", function (callback) {
		var id = nextRafId;
		nextRafId += 1;
		rafCallbacks.set(id, callback);
		return id;
	});
	setGlobal("cancelAnimationFrame", function (id) {
		rafCallbacks.delete(id);
	});

	return {
		document: documentStub,
		window: windowStub,
		/** Đẩy đồng hồ tới và chạy đúng 1 frame rAF. */
		advanceFrame: function (deltaMs) {
			nowMs += deltaMs;
			var pending = Array.from(rafCallbacks.entries());
			rafCallbacks.clear();
			pending.forEach(function (entry) {
				entry[1](nowMs);
			});
		},
		/** Đẩy đồng hồ mà KHÔNG chạy frame (giả lập tab bị treo). */
		advanceTime: function (deltaMs) {
			nowMs += deltaMs;
		},
		now: function () {
			return nowMs;
		},
		restore: function () {
			Object.keys(originals).forEach(function (name) {
				if (originals[name].present === true) {
					globalThis[name] = originals[name].value;
					return;
				}

				delete globalThis[name];
			});
			listenersByTarget.clear();
			rafCallbacks.clear();
		}
	};
}

module.exports = {
	loadClientModule: loadClientModule,
	loadClientBundle: loadClientBundle,
	loadClientModuleWithStubs: loadClientModuleWithStubs,
	installBrowserStubs: installBrowserStubs
};
