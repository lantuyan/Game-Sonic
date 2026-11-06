"use strict";

// Local dev server used by 2-start.bat / 2-start.command.
//
// - Runs the real game server (server/app.js) in a child process.
// - Watches the project folder:
//     * edits in server/, shared/, questions/, .env  -> restart the server, then reload the browser
//     * any other edit (EndlessRunner.htm, admin.html, *.js, images...) -> reload the browser
// - Injects a tiny live-reload script into every .html/.htm page it serves.
//
// Run: node scripts/dev.js

var path = require("path");
var fs = require("fs");
var os = require("os");

var ROOT_DIR = path.resolve(__dirname, "..");

if (process.env.DEV_CHILD === "1") {
	runChild();
} else {
	runParent();
}

// ---------------------------------------------------------------------------
// Parent: file watcher + restarts the child server.
// ---------------------------------------------------------------------------

function runParent() {
	var childProcess = require("child_process");

	var IGNORED_TOP = {
		"node_modules": true,
		".git": true,
		".runtime": true,
		".vercel": true,
		".claude": true,
		".kilo": true,
		"public": true,
		"assets": true,
		"assets-src": true,
		"docs": true,
		"test": true,
		"coverage": true
	};
	var RESTART_TOP = {
		"server": true,
		"shared": true,
		"questions": true
	};
	var RESTART_FILES = {
		".env": true,
		"package.json": true
	};

	var child = null;
	var port = null;
	var firstStart = true;
	var stopping = false;
	var pending = null; // "restart" | "reload"
	var timer = null;

	function startChild() {
		var env = Object.assign({}, process.env, { DEV_CHILD: "1" });
		if (port != null) {
			env.DEV_FIXED_PORT = String(port);
		}

		child = childProcess.fork(__filename, [], { cwd: ROOT_DIR, env: env });

		child.on("message", function (message) {
			if (message && message.type === "listening") {
				port = message.port;
				if (firstStart) {
					firstStart = false;
					printBanner(port);
					openBrowser("http://localhost:" + port);
				} else {
					log("✅ Server đã chạy lại.");
				}
			}
		});

		child.on("exit", function (code) {
			child = null;
			if (stopping) {
				return;
			}
			if (code === 2) {
				log("❌ Thiếu thư viện. Hãy tắt cửa sổ này và chạy lại file 1-install.");
			} else if (code === 3) {
				log("❌ Không mở được server vì các cổng 3000-3020 đều bận. Hãy khởi động lại máy rồi thử lại.");
			} else if (code !== 0 && code !== null) {
				log("❌ Server bị lỗi (xem thông báo đỏ ở trên). Hãy sửa code rồi lưu lại (Ctrl+S) — server sẽ tự chạy lại.");
			}
		});
	}

	function stopChild(callback) {
		if (child == null) {
			callback();
			return;
		}
		var current = child;
		var done = false;
		function finish() {
			if (done) {
				return;
			}
			done = true;
			callback();
		}
		current.once("exit", finish);
		try {
			current.send({ type: "shutdown" });
		} catch (error) {
			current.kill();
		}
		setTimeout(function () {
			if (!done) {
				current.kill();
			}
		}, 3000);
	}

	function flush() {
		var action = pending;
		pending = null;
		if (!probeDone || stopping) {
			return;
		}

		if (action === "restart") {
			log("🔄 Code server thay đổi → đang khởi động lại server...");
			stopChild(startChild);
		} else if (action === "reload") {
			log("🔄 Code thay đổi → tải lại trình duyệt.");
			if (child != null) {
				try {
					child.send({ type: "reload" });
				} catch (error) {
					// child is restarting; the browser reloads when it reconnects.
				}
			} else {
				startChild();
			}
		}
	}

	function onChange(fileName) {
		if (!fileName) {
			return;
		}
		var normalized = String(fileName).split(path.sep).join("/");
		var parts = normalized.split("/");
		var top = parts[0];
		var base = parts[parts.length - 1];

		if (IGNORED_TOP[top] === true) {
			return;
		}
		if (base === ".DS_Store" || base.charAt(0) === "~" || /\.(swp|tmp|log)$/i.test(base) || /~$/.test(base)) {
			return;
		}

		var action = RESTART_TOP[top] === true || (parts.length === 1 && RESTART_FILES[base] === true) ? "restart" : "reload";
		if (pending !== "restart") {
			pending = action;
		}
		clearTimeout(timer);
		timer = setTimeout(flush, 300);
	}

	try {
		var watcher = fs.watch(ROOT_DIR, { recursive: true }, function (eventType, fileName) {
			onChange(fileName);
		});
		watcher.on("error", function (error) {
			log("⚠️  Ngừng theo dõi thay đổi file (" + error.message + "). Sửa code xong hãy bấm F5 trên trình duyệt.");
		});
	} catch (error) {
		log("⚠️  Không theo dõi được thay đổi file (" + error.message + "). Sửa code xong hãy bấm F5 trên trình duyệt.");
	}

	function shutdown() {
		if (stopping) {
			return;
		}
		stopping = true;
		log("👋 Đang tắt server...");
		stopChild(function () {
			process.exit(0);
		});
	}

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
	process.on("SIGHUP", shutdown);

	// If the game is already running in another window, just open the browser.
	var probePort = Number(readEnvPort()) || 3000;
	var probeDone = false;
	function probeFinished(alreadyRunning) {
		if (probeDone) {
			return;
		}
		probeDone = true;
		if (alreadyRunning) {
			stopping = true;
			console.log("");
			console.log("✅ Game ĐÃ ĐANG CHẠY ở một cửa sổ khác: http://localhost:" + probePort);
			console.log("   (Không cần mở thêm. Cửa sổ này sẽ tự đóng.)");
			openBrowser("http://localhost:" + probePort);
			setTimeout(function () { process.exit(0); }, 3000);
			return;
		}
		startChild();
	}
	var probe = require("http").get({ host: "127.0.0.1", port: probePort, path: "/__dev/ping", timeout: 1000 }, function (response) {
		var body = "";
		response.on("data", function (chunk) { body += chunk; });
		response.on("end", function () { probeFinished(body === "game-sonic-dev"); });
	});
	probe.on("error", function () { probeFinished(false); });
	probe.on("timeout", function () { probe.destroy(); probeFinished(false); });
}

function readEnvPort() {
	if (process.env.PORT) {
		return process.env.PORT;
	}
	try {
		var match = fs.readFileSync(path.join(ROOT_DIR, ".env"), "utf8").match(/^\s*PORT\s*=\s*['"]?(\d+)/m);
		return match ? match[1] : null;
	} catch (error) {
		return null;
	}
}

function log(message) {
	var time = new Date().toTimeString().slice(0, 8);
	console.log("[" + time + "] " + message);
}

function getLanAddress() {
	var interfaces = os.networkInterfaces();
	var names = Object.keys(interfaces);
	for (var i = 0; i < names.length; i++) {
		var list = interfaces[names[i]] || [];
		for (var j = 0; j < list.length; j++) {
			var item = list[j];
			if ((item.family === "IPv4" || item.family === 4) && item.internal === false) {
				return item.address;
			}
		}
	}
	return null;
}

function printBanner(port) {
	var url = "http://localhost:" + port;
	var lan = getLanAddress();
	var line = "==============================================================";
	console.log("");
	console.log(line);
	console.log("  🎮  GAME ĐÃ CHẠY! Mở trình duyệt vào địa chỉ:");
	console.log("");
	console.log("      👉  " + url);
	console.log("");
	console.log("  Trang quản trị (admin): " + url + "/admin.html");
	if (lan) {
		console.log("  Máy khác cùng mạng wifi: http://" + lan + ":" + port);
	}
	console.log("");
	console.log("  ✏️  Sửa code rồi lưu (Ctrl+S) → trình duyệt TỰ cập nhật.");
	console.log("  ⛔  Muốn tắt game: đóng cửa sổ này hoặc nhấn Ctrl + C.");
	console.log(line);
	console.log("");
}

function openBrowser(url) {
	if (process.env.DEV_NO_OPEN === "1") {
		return;
	}
	var childProcess = require("child_process");
	try {
		if (process.platform === "win32") {
			childProcess.spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
		} else if (process.platform === "darwin") {
			childProcess.spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
		} else {
			childProcess.spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
		}
	} catch (error) {
		// Not fatal: the link is printed in the terminal.
	}
}

// ---------------------------------------------------------------------------
// Child: the actual web server + live-reload endpoint.
// ---------------------------------------------------------------------------

function runChild() {
	var express;
	try {
		require("dotenv").config({ path: path.join(ROOT_DIR, ".env") });
		express = require("express");
		require("bcryptjs");
		require("@electric-sql/pglite");
	} catch (error) {
		console.error(error && error.message ? error.message : error);
		process.exit(2);
		return;
	}

	var createApp = require("../server/app").createApp;

	var runtime = createApp();
	var bootId = String(Date.now());
	var clients = new Set();
	var outer = express();

	var RELOAD_SNIPPET =
		"<script>(function(){" +
		"try{if(window.__devReload){window.__devReload.close();}}catch(e){}" +
		"var es=new EventSource('/__dev/reload');window.__devReload=es;" +
		"es.onmessage=function(ev){var d={};try{d=JSON.parse(ev.data);}catch(e){}" +
		"if(d.type==='hello'){if(window.__devBoot&&window.__devBoot!==d.boot){location.reload();return;}window.__devBoot=d.boot;}" +
		"else if(d.type==='reload'){location.reload();}};" +
		"})();</script>";

	outer.disable("x-powered-by");

	outer.get("/__dev/ping", function (request, response) {
		response.type("text/plain").send("game-sonic-dev");
	});

	outer.get("/__dev/reload", function (request, response) {
		response.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-store",
			"Connection": "keep-alive"
		});
		response.write("retry: 500\n");
		response.write("data: " + JSON.stringify({ type: "hello", boot: bootId }) + "\n\n");
		clients.add(response);
		request.on("close", function () {
			clients.delete(response);
		});
	});

	// The game registers worker.js (a caching service worker). While developing,
	// serve a replacement that wipes its caches and unregisters itself, so the
	// browser never shows an old copy of an edited file.
	outer.get("/worker.js", function (request, response) {
		response.setHeader("Content-Type", "application/javascript; charset=utf-8");
		response.setHeader("Cache-Control", "no-store");
		response.send(
			"self.addEventListener('install',function(){self.skipWaiting();});" +
			"self.addEventListener('activate',function(e){e.waitUntil(" +
			"caches.keys().then(function(k){return Promise.all(k.map(function(n){return caches.delete(n);}));})" +
			".then(function(){return self.registration.unregister();}));});" +
			"self.addEventListener('fetch',function(){});"
		);
	});

	// Serve .html/.htm pages with the live-reload snippet injected and no caching.
	outer.use(function (request, response, next) {
		if (request.method !== "GET" && request.method !== "HEAD") {
			next();
			return;
		}
		var requestPath;
		try {
			requestPath = decodeURIComponent(request.path);
		} catch (error) {
			next();
			return;
		}
		if (requestPath === "/") {
			requestPath = "/index.html";
		}
		if (!/\.html?$/i.test(requestPath)) {
			next();
			return;
		}
		var segments = requestPath.split("/").filter(Boolean);
		var blocked = { server: true, test: true, questions: true, node_modules: true };
		if (segments.length === 0 || segments.some(function (s) { return s.charAt(0) === "." || s === ".."; }) || blocked[segments[0]] === true) {
			next();
			return;
		}
		var filePath = path.join(ROOT_DIR, segments.join(path.sep));
		fs.readFile(filePath, "utf8", function (error, html) {
			if (error) {
				next();
				return;
			}
			var index = html.toLowerCase().lastIndexOf("</body>");
			html = index === -1 ? html + RELOAD_SNIPPET : html.slice(0, index) + RELOAD_SNIPPET + html.slice(index);
			response.setHeader("Content-Type", "text/html; charset=utf-8");
			response.setHeader("Cache-Control", "no-store");
			response.send(html);
		});
	});

	// Never let the browser keep stale copies of other files while developing.
	outer.use(function (request, response, next) {
		response.setHeader("Cache-Control", "no-store");
		var originalSetHeader = response.setHeader;
		response.setHeader = function (name, value) {
			if (String(name).toLowerCase() === "cache-control") {
				return this;
			}
			return originalSetHeader.apply(this, arguments);
		};
		next();
	});

	outer.use(runtime.app);

	process.on("message", function (message) {
		if (!message) {
			return;
		}
		if (message.type === "reload") {
			clients.forEach(function (client) {
				client.write("data: " + JSON.stringify({ type: "reload" }) + "\n\n");
			});
		} else if (message.type === "shutdown") {
			closeAndExit();
		}
	});

	var server = null;

	function closeAndExit() {
		clients.forEach(function (client) {
			client.end();
		});
		clients.clear();
		var exit = function () {
			try {
				runtime.close();
			} catch (error) {
				// ignore
			}
			process.exit(0);
		};
		if (server == null) {
			exit();
			return;
		}
		server.close(exit);
		if (typeof server.closeAllConnections === "function") {
			server.closeAllConnections();
		}
		setTimeout(exit, 1500);
	}

	process.on("SIGINT", closeAndExit);
	process.on("SIGTERM", closeAndExit);
	process.on("SIGHUP", closeAndExit);
	process.on("disconnect", closeAndExit);

	var fixedPort = Number(process.env.DEV_FIXED_PORT || 0);
	var basePort = fixedPort || Number(runtime.config.port) || 3000;
	var attempt = 0;

	function listen(port) {
		server = outer.listen(port);
		server.on("listening", function () {
			if (process.send) {
				process.send({ type: "listening", port: port });
			}
		});
		server.on("error", function (error) {
			// EACCES: on Windows, Hyper-V/WSL/Docker often reserve port ranges incl. 3000.
			if (error && (error.code === "EADDRINUSE" || error.code === "EACCES")) {
				if (fixedPort && attempt < 10) {
					// The previous server may still be releasing the port.
					attempt += 1;
					setTimeout(function () { listen(port); }, 300);
					return;
				}
				if (!fixedPort && attempt < 20) {
					attempt += 1;
					console.log("Cổng " + port + " đang bận, thử cổng " + (port + 1) + "...");
					listen(port + 1);
					return;
				}
			}
			console.error(error);
			process.exit(error && (error.code === "EADDRINUSE" || error.code === "EACCES") ? 3 : 1);
		});
	}

	listen(basePort);
}
