// NivPay service worker. Caches the app shell only.
//
// Never cached, never even intercepted:
//  * anything on another origin, which includes the Monad RPC,
//  * anything under /api/,
//  * any request that is not a GET.
// Chain data must always be fresh, and a cached RPC answer could show money
// that is no longer there.

const VERSION = "shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isShellRequest(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/api/")) return false;
  return true;
}

async function putIfOk(cache, request, response) {
  if (response.ok && response.type === "basic") await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (!isShellRequest(request)) return;

  // Pages: network first, so a new deploy is picked up at once. Offline, fall
  // back to the cached shell and let the app show its offline state.
  if (request.mode === "navigate") {
    event.respondWith(
      caches.open(VERSION).then((cache) =>
        fetch(request)
          .then((response) => putIfOk(cache, "/", response))
          .catch(() => cache.match("/").then((hit) => hit ?? Response.error())),
      ),
    );
    return;
  }

  // Built assets are content hashed and never change: cache first.
  // Icons and the manifest: cache first too, refreshed on the next deploy.
  event.respondWith(
    caches.open(VERSION).then((cache) =>
      cache.match(request).then((hit) => hit ?? fetch(request).then((response) => putIfOk(cache, request, response))),
    ),
  );
});
