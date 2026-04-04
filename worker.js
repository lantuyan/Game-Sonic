const filesToCache = [
	"./",
	"index.html",
	"EndlessRunner.htm",
	"EndlessRunner.js",
	"EndlessRunner.json",
	"EndlessRunner.png",
	"EndlessRunnerFavIcon_16x16.png",
	"EndlessRunnerFavIcon_192x192.png",
	"EndlessRunnerFavIcon_512x512.png",
	"EndlessRunnerShare.png"
];

const staticCacheName = "endlessrunner-v3";

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
	const isQuestionsRequest = requestUrl.pathname.endsWith("/questions.json") || requestUrl.pathname.endsWith("questions.json");

	if (isRootNavigationRequest) {
		event.respondWith(
			fetch(event.request)
			.catch(() => caches.match("./"))
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
