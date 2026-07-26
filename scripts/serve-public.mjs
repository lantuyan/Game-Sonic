// Server tĩnh cho thư mục `public/` — dùng để kiểm BẢN BUILD THẬT ở máy dev.
//
// Vì sao cần: Express dev (`npm run dev`) phục vụ GỐC REPO để chạy V1, còn Vercel
// mới lấy `public/` làm gốc site. Không có server này thì không thể thử Service
// Worker / PWA / offline ở máy — mà đó đúng là những thứ chỉ sai khi chạy thật.
//
//   npm run build:client && npm run serve:public   → http://localhost:4173/v2/
//
// Có proxy `/api` sang Express :3000 để ngân hàng câu hỏi vẫn chạy.

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(rootDir, "public");
const port = Number(process.env.PORT ?? 4173);
const apiPort = Number(process.env.API_PORT ?? 3000);

const MIME_TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".webmanifest": "application/manifest+json; charset=utf-8",
	".png": "image/png",
	".jpg": "image/jpeg",
	".svg": "image/svg+xml",
	".woff2": "font/woff2",
	".glb": "model/gltf-binary",
	".ogg": "audio/ogg",
	".m4a": "audio/mp4",
	".webp": "image/webp"
};

function proxyToApi(request, response) {
	const proxied = httpRequest(
		{ hostname: "localhost", port: apiPort, path: request.url, method: request.method, headers: request.headers },
		(upstream) => {
			response.writeHead(upstream.statusCode ?? 502, upstream.headers);
			upstream.pipe(response);
		}
	);

	proxied.on("error", () => {
		response.writeHead(502, { "Content-Type": "application/json" });
		response.end(JSON.stringify({ error: `Không kết nối được API ở :${apiPort}. Chạy \`npm run dev\` chưa?` }));
	});

	request.pipe(proxied);
}

const server = createServer((request, response) => {
	const url = new URL(request.url ?? "/", `http://localhost:${port}`);

	if (url.pathname.startsWith("/api/")) {
		proxyToApi(request, response);
		return;
	}

	// Chặn thoát khỏi publicDir (../../etc/passwd).
	const requestedPath = path.normalize(path.join(publicDir, decodeURIComponent(url.pathname)));

	if (requestedPath.startsWith(publicDir) === false) {
		response.writeHead(403).end("Forbidden");
		return;
	}

	let filePath = requestedPath;

	if (existsSync(filePath) === true && statSync(filePath).isDirectory() === true) {
		filePath = path.join(filePath, "index.html");
	}

	if (existsSync(filePath) === false) {
		response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
		response.end("Không tìm thấy. Đã chạy `npm run build:client` chưa?");
		return;
	}

	const contentType = MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream";
	// KHÔNG cache ở tầng server: đang test chính hành vi cache của Service Worker.
	response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
	createReadStream(filePath).pipe(response);
});

server.listen(port, () => {
	console.log(`[serve:public] http://localhost:${port}/v2/  (proxy /api → :${apiPort})`);
});
