const CACHE_NAME = "portal-ai-static-v4";
const APP_SHELL = ["/manifest.webmanifest", "/portal-ai-logo.png"];
const ROOT_STATIC_ASSETS = new Set([
  "/manifest.webmanifest",
  "/portal-ai-logo.png",
  "/favicon.svg",
  "/file.svg",
  "/globe.svg",
  "/window.svg",
]);

function isStaticAsset(request, url) {
  if (request.method !== "GET" || url.origin !== self.location.origin || url.search) return false;
  return url.pathname.startsWith("/_next/static/") || ROOT_STATIC_ASSETS.has(url.pathname);
}

function mayCache(response) {
  if (!response.ok || response.type !== "basic") return false;
  const cacheControl = response.headers.get("cache-control") || "";
  const vary = response.headers.get("vary") || "";
  if (/\b(?:no-store|private)\b/i.test(cacheControl)) return false;
  if (response.headers.has("set-cookie")) return false;
  return !/(?:^|,)\s*(?:cookie|authorization|\*)\s*(?:,|$)/i.test(vary);
}

async function cacheStaticAsset(cache, request) {
  const response = await fetch(request, { cache: "no-store" });
  if (mayCache(response)) await cache.put(request, response.clone());
  return response;
}

async function respondWithStaticAsset(cache, request, cacheFirst) {
  if (cacheFirst) {
    const cached = await cache.match(request);
    if (cached) return cached;
  }
  try {
    return await cacheStaticAsset(cache, request);
  } catch {
    return (await cache.match(request)) || Response.error();
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(APP_SHELL.map((asset) => cacheStaticAsset(cache, new Request(new URL(asset, self.location.origin))))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (!isStaticAsset(request, url)) return;
  event.respondWith(
    caches.open(CACHE_NAME)
      .then((cache) => respondWithStaticAsset(cache, request, url.pathname.startsWith("/_next/static/"))),
  );
});
