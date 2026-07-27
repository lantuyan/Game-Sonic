// Service Worker V2 (injectManifest) — RỦI RO R1, làm chính xác từng bước.
//
// Kịch bản chuyển tiếp bắt buộc (hợp đồng plan §7.3.5):
//   1. SW mới đăng ký ở CÙNG URL `worker.js` và cùng scope `/` với V1;
//   2. XÓA cache cũ `endlessrunner-static-v9` + `endlessrunner-api-v1`;
//   3. `skipWaiting` + `clientsClaim` để không phải chờ đóng hết tab;
//   4. đề bài (`/api/levels/*/question-bank`) dùng NETWORK-FIRST — giữ đúng hành
//      vi offline của V1: có mạng thì luôn lấy đề mới nhất giáo viên vừa sửa,
//      mất mạng thì rơi về bản đã cache.

/// <reference lib="webworker" />

import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { clientsClaim } from "workbox-core";
import { registerRoute } from "workbox-routing";
import { CacheFirst, NetworkFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

/** Cache của V1 phải bị xóa sạch khi V2 lên (plan §7.3.5). */
const LEGACY_CACHE_NAMES = ["endlessrunner-static-v9", "endlessrunner-api-v1"];

const RUNTIME_MEDIA_CACHE = "toan-runner-media-v2";
const QUESTION_BANK_CACHE = "toan-runner-question-bank-v2";

// App-shell + font + nhân vật mặc định + biome ① do vite-plugin-pwa bơm vào đây.
precacheAndRoute(self.__WB_MANIFEST);
// Xóa precache của các bản build V2 trước đó.
cleanupOutdatedCaches();

self.addEventListener("install", () => {
	// Không chờ tab cũ đóng — người chơi tải lại một lần là có bản mới.
	void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			const names = await caches.keys();

			await Promise.all(
				names.filter((name) => LEGACY_CACHE_NAMES.includes(name)).map((name) => caches.delete(name))
			);
		})()
	);
});

clientsClaim();

// Đề bài: NETWORK-FIRST. Giáo viên sửa đề ở admin thì học sinh phải thấy ngay;
// mất mạng mới rơi về bản cache (docs/v2/A2 §4).
registerRoute(
	({ url }) => url.pathname.includes("/api/levels/") && url.pathname.endsWith("/question-bank"),
	new NetworkFirst({
		cacheName: QUESTION_BANK_CACHE,
		networkTimeoutSeconds: 5,
		plugins: [new ExpirationPlugin({ maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 30 })]
	})
);

// Model/audio/texture còn lại: CACHE-FIRST, tải một lần dùng mãi.
registerRoute(
	({ request, url }) =>
		url.origin === self.location.origin &&
		(request.destination === "audio" ||
			url.pathname.endsWith(".glb") ||
			url.pathname.startsWith("/models/") ||
			url.pathname.startsWith("/audio/") ||
			url.pathname.startsWith("/textures/")),
	new CacheFirst({
		cacheName: RUNTIME_MEDIA_CACHE,
		plugins: [new ExpirationPlugin({ maxEntries: 160, maxAgeSeconds: 60 * 60 * 24 * 60 })]
	})
);

// Trang mở prompt "Đã có bản mới — Tải lại" bằng cách nghe message này.
self.addEventListener("message", (event) => {
	if (event.data === "SKIP_WAITING") {
		void self.skipWaiting();
		return;
	}

	// P1-2: bơm biome ②/③ vào cache SAU VÁN ĐẦU (xem globIgnores ở vite.config).
	// Dùng `add` từng cái thay vì `addAll`: một file lỗi không được huỷ cả mẻ.
	if (
		typeof event.data === "object" &&
		event.data !== null &&
		(event.data as { type?: string }).type === "WARM_BIOME_CACHE"
	) {
		const urls = (event.data as { urls?: unknown }).urls;

		if (Array.isArray(urls) === false) {
			return;
		}

		event.waitUntil(
			(async () => {
				const cache = await caches.open(RUNTIME_MEDIA_CACHE);

				for (const url of urls as string[]) {
					if (typeof url !== "string") {
						continue;
					}

					if ((await cache.match(url)) !== undefined) {
						continue;
					}

					try {
						await cache.add(url);
					} catch {
						// Mất mạng giữa chừng: lần sau warm lại, không có gì để báo.
					}
				}
			})()
		);
	}
});
