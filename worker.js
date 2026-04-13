const filesToCache = [
	"./",
	"index.html",
	"admin.html",
	"EndlessRunner.htm",
	"EndlessRunner.js",
	"shared/questionModel.js",
	"questionBank.js",
	"EndlessRunner.json",
	"EndlessRunner.png",
	"EndlessRunnerFavIcon_16x16.png",
	"EndlessRunnerFavIcon_192x192.png",
	"EndlessRunnerFavIcon_512x512.png",
	"EndlessRunnerShare.png"
];

const staticCacheName = "endlessrunner-static-v8";
const apiCacheName = "endlessrunner-api-v1";

self.addEventListener("install", event => {
	event.waitUntil(
		caches.open(staticCacheName)
			.then(cache => cache.addAll(filesToCache))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener("activate", event => {
	event.waitUntil(
		caches.keys()
			.then(cacheNames => Promise.all(
				cacheNames
					.filter(cacheName => cacheName !== staticCacheName && cacheName !== apiCacheName)
					.map(cacheName => caches.delete(cacheName))
			))
			.then(() => self.clients.claim())
	);
});

self.addEventListener("fetch", event => {
	const request = event.request;
	const requestUrl = new URL(request.url);
	const isRootNavigationRequest = request.mode === "navigate" && (requestUrl.pathname.endsWith("/") || requestUrl.pathname.endsWith("/index.html"));
	const isGameShellRequest = requestUrl.pathname.endsWith("/EndlessRunner.htm") || requestUrl.pathname === "/EndlessRunner.htm";
	const isAdminShellRequest = requestUrl.pathname.endsWith("/admin.html") || requestUrl.pathname === "/admin.html";
	const isQuestionBankApiRequest = request.method === "GET" && /^\/api\/levels\/[^/]+\/question-bank$/.test(requestUrl.pathname);
	const isApiRequest = requestUrl.pathname.startsWith("/api/");

	if (isRootNavigationRequest || isGameShellRequest || isAdminShellRequest) {
		event.respondWith(
			fetch(request)
				.then(networkResponse => {
					if (networkResponse && networkResponse.ok) {
						caches.open(staticCacheName).then(cache => cache.put(request, networkResponse.clone()));
					}
					return networkResponse;
				})
				.catch(() => caches.match(request).then(response => response || caches.match("./")))
		);
		return;
	}

	if (isQuestionBankApiRequest) {
		event.respondWith(
			fetch(request)
				.then(networkResponse => {
					if (networkResponse && networkResponse.ok) {
						caches.open(apiCacheName).then(cache => cache.put(request, networkResponse.clone()));
					}
					return networkResponse;
				})
				.catch(() => caches.match(request).then(response => response || Promise.reject(new Error("Question bank request failed."))))
		);
		return;
	}

	if (isApiRequest) {
		event.respondWith(fetch(request));
		return;
	}

	event.respondWith(
		caches.match(request)
			.then(response => response || fetch(request))
	);
});
