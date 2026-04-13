const filesToCache = [
	"./",
	"index.html",
	"admin.html",
	"EndlessRunner.htm",
	"EndlessRunner.js",
	"questionBank.js",
	"EndlessRunner.json",
	"questions/lop6.json",
	"questions/lop7.json",
	"questions/lop8.json",
	"EndlessRunner.png",
	"EndlessRunnerFavIcon_16x16.png",
	"EndlessRunnerFavIcon_192x192.png",
	"EndlessRunnerFavIcon_512x512.png",
	"EndlessRunnerShare.png"
];

const staticCacheName = "endlessrunner-v7";

self.addEventListener("install", event => {
	event.waitUntil(
		caches.open(staticCacheName)
		.then(cache => {
			return cache.addAll(filesToCache);
		})
		.then(() => self.skipWaiting())
	);
});

self.addEventListener("activate", event => {
	event.waitUntil(
		caches.keys()
		.then(cacheNames => Promise.all(
			cacheNames
				.filter(cacheName => cacheName !== staticCacheName)
				.map(cacheName => caches.delete(cacheName))
		))
		.then(() => self.clients.claim())
	);
});

self.addEventListener("fetch", event => {
	const requestUrl = new URL(event.request.url);
	const isRootNavigationRequest = event.request.mode === "navigate" && (requestUrl.pathname.endsWith("/") || requestUrl.pathname.endsWith("/index.html"));
	const isGameShellRequest = requestUrl.pathname.endsWith("/EndlessRunner.htm") || requestUrl.pathname === "/EndlessRunner.htm";
	const isAdminShellRequest = requestUrl.pathname.endsWith("/admin.html") || requestUrl.pathname === "/admin.html";
	const isQuestionsRequest = requestUrl.pathname.indexOf("/questions/") !== -1 && requestUrl.pathname.endsWith(".json");

	if (isRootNavigationRequest || isGameShellRequest || isAdminShellRequest) {
		event.respondWith(
			fetch(event.request)
			.then(networkResponse => {
				if (networkResponse && networkResponse.ok) {
					const networkResponseClone = networkResponse.clone();
					caches.open(staticCacheName).then(cache => cache.put(event.request, networkResponseClone));
				}
				return networkResponse;
			})
			.catch(() => caches.match(event.request).then(response => response || caches.match("./")))
		);
		return;
	}

	if (isQuestionsRequest) {
		event.respondWith(
			fetch(event.request)
			.then(networkResponse => {
				if (networkResponse && networkResponse.ok) {
					const networkResponseClone = networkResponse.clone();
					caches.open(staticCacheName).then(cache => cache.put(event.request, networkResponseClone));
				}
				return networkResponse;
			})
			.catch(() => caches.match(event.request))
		);
		return;
	}

	event.respondWith(
		caches.match(event.request)
		.then(response => {
			if (response) {
				return response;
			}
			return fetch(event.request);
		}).catch(() => {
		})
	);
});
