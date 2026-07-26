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
	installBrowserStubs: installBrowserStubs
};
