import { defineConfig } from "vite";
import { resolve } from "node:path";
import { VitePWA } from "vite-plugin-pwa";

// V2_ROOT điều khiển thư mục build bên trong public/ (plan §7.5).
//
// ĐÃ BẬT CÔNG TẮC RELEASE (P0-15): mặc định là "" → build thẳng ra public/, V2 chiếm
// route "/". Muốn tạm quay lại bố cục thời P0 (V1 ở "/", V2 ở "/v2/") để so sánh hoặc
// cứu hoả thì đặt env `V2_ROOT=v2` khi build — không cần sửa code.
const v2Root = (process.env.V2_ROOT ?? "").replace(/^\/+|\/+$/g, "");

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
	plugins: [
		VitePWA({
			// injectManifest: ta tự viết SW (client/src/worker.ts) vì kịch bản chuyển tiếp
			// từ SW tay của V1 cần xử lý riêng — generateSW không làm được (plan §7.3.5).
			strategies: "injectManifest",
			srcDir: "src",
			filename: "worker.ts",
			// ⚠ TÊN FILE ĐẦU RA PHẢI LÀ `worker.js`: V1 đã đăng ký SW ở đúng URL này,
			// nên chỉ khi trùng URL thì trình duyệt mới coi là BẢN CẬP NHẬT của SW cũ
			// và thay thế nó. Đổi tên là V1 sống mãi trên máy học sinh.
			injectRegister: null,
			registerType: "prompt",
			manifest: {
				name: "Toán Runner",
				short_name: "Toán Runner",
				description: "Game chạy vượt chướng ngại kết hợp luyện Toán cho học sinh lớp 6–8.",
				lang: "vi",
				start_url: ".",
				display: "standalone",
				orientation: "any",
				background_color: "#1B2A4A",
				theme_color: "#1B2A4A",
				icons: [
					{ src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
					{ src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
					{ src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
				]
			},
			injectManifest: {
				// App-shell + font + nhân vật + biome ① đều nằm trong ngân sách 10MB.
				globPatterns: ["**/*.{js,css,html,woff2,glb,ogg,png,json}"],
				// P1-2: biome ② và ③ KHÔNG nằm trong precache lúc cài.
				//
				// Lý do là băng thông ở trường: nhét cả 3 biome vào lần cài đầu bắt học
				// sinh tải ~850KB nhạc cho hai chặng mà phần lớn các em chưa từng tới
				// (boss đầu tiên ở phút thứ 2.5). Thay vào đó: tải nóng lúc cắt cảnh boss
				// (RunScene.preloadNextBiome) rồi bơm vào cache SAU VÁN ĐẦU
				// (core/pwa.ts → thông điệp WARM_BIOME_CACHE), nên ván thứ hai đã offline được.
				//
				// ⚠ Danh sách này khớp với `client/src/fx/biomes.ts` và được
				// `test/biomes.test.js` canh — thêm prop biome mới mà quên ở đây thì
				// prop đó lặng lẽ chui vào lần tải đầu.
				globIgnores: [
					"**/models/props/{obstacle-low-beach,obstacle-full-beach}.glb",
					"**/models/props/{palm,rocks-sand,beach}-*.glb",
					"**/models/props/{obstacle-low-snow,obstacle-high-snow,obstacle-full-snow,snowman}.glb",
					"**/models/props/{pine,snow}-*.glb",
					"**/audio/bgm-biome{2,3}.ogg",
					// P1-3: nhân vật phải MỞ KHOÁ mới chơi được (~850KB) — không bắt
					// mọi học sinh tải ngay lúc cài. Route CacheFirst của SW sẽ giữ lại
					// từ lần chọn đầu tiên, tức ngay sau khi mở khoá.
					"**/models/characters/{mage,rogue,barbarian}.glb"
				],
				maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
				// IIFE chứ KHÔNG phải ES module: SW dạng module bắt buộc đăng ký bằng
				// `{type:"module"}`, thứ mà Chrome cũ trên máy phòng tin học và iOS <16.4
				// không hỗ trợ — SW sẽ im lặng không cài được. IIFE chạy ở mọi nơi.
				rollupFormat: "iife"
			},
			devOptions: {
				enabled: false
			}
		})
	],
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
