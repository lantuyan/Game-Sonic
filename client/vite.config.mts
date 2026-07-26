import { defineConfig } from "vite";
import { resolve } from "node:path";

// V2_ROOT điều khiển thư mục build bên trong public/ (plan §7.5).
// Trong suốt P0 mặc định là "v2" → build ra public/v2/, V1 vẫn phục vụ tại "/".
// Chỉ ở P0-15 (công tắc release) mới đặt V2_ROOT="" để V2 chiếm route "/".
const v2Root = (process.env.V2_ROOT ?? "v2").replace(/^\/+|\/+$/g, "");

// Guard: outDir dùng emptyOutDir:true — V2_ROOT sai kiểu "../x" sẽ xóa nhầm ngoài public/.
if (v2Root !== "" && !/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(v2Root)) {
	throw new Error(`V2_ROOT không hợp lệ: "${v2Root}" (chỉ cho phép tên thư mục đơn, ví dụ "v2", hoặc rỗng).`);
}

const clientDir = import.meta.dirname;

export default defineConfig(({ command }) => ({
	root: clientDir,
	base: command === "build" && v2Root !== "" ? `/${v2Root}/` : "/",
	resolve: {
		alias: {
			"@": resolve(clientDir, "src")
		}
	},
	build: {
		outDir: resolve(clientDir, "..", "public", v2Root),
		emptyOutDir: true,
		rollupOptions: {
			input: {
				index: resolve(clientDir, "index.html"),
				admin: resolve(clientDir, "admin.html")
			}
		}
	},
	server: {
		port: Number(process.env.PORT ?? 5173),
		proxy: {
			"/api": "http://localhost:3000",
			// Script legacy (questionBank.js + questionModel.js) nằm ở GỐC REPO, không
			// nằm trong `client/` nên dev server của Vite không tự phục vụ được.
			// Trên production, `scripts/vercel-build.js` copy chúng vào `public/` nên
			// cùng đường dẫn này chạy đúng — dev chỉ cần proxy sang Express.
			"/questionBank.js": "http://localhost:3000",
			"/shared": "http://localhost:3000"
		}
	}
}));
