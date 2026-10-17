// NivPay service worker. Caches the app shell only: the page, its scripts and
// styles, fonts, icons and the manifest.
//
// Never cached, never even intercepted:
//  * anything on another origin, which includes the Monad RPC,
//  * anything under /api/,
//  * any request that is not a GET.
// Chain data must always be fresh, and a cached RPC answer could show money
// that is no longer there. Offline, the app opens from this cache and says
// it is offline; it shows no balance as current until a read comes back.

// Filled in by the build (app/sw-build.ts): this build's scripts and styles,
// every screen's included, so screens not opened yet still open offline, and
// a version that changes with them. Left as null when not built.
const BUILD = /* NIVPAY_BUILD */ null;

// Filled in by the build too: what a notification says, per language, from
// the app's dictionaries (src/lib/push.ts pushTexts), with {amount} and {pot}
// left for the push to fill. Left as null when not built.
const PUSH_TEXTS = /* NIVPAY_PUSH_TEXTS */ null;

const VERSION = `shell-${BUILD ? BUILD.version : "dev"}`;
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png", ...(BUILD ? BUILD.assets : [])];

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

// Notifications on the phone (README, "Notifications on the phone"). A push
// carries the kind, the phone's language, the pot's number and name, and an
// amount only if the person chose to see amounts on the lock screen. Nothing
// here reads the chain or calls the server.

// BEGIN push (src/lib/push.test.ts runs these exact functions)
function formatPushAmount(a, d, s, lang) {
  const n = Number((BigInt(a) * 100n) / 10n ** BigInt(d)) / 100;
  try {
    return s === "$" ? new Intl.NumberFormat(lang, { style: "currency", currency: "USD" }).format(n) : `${new Intl.NumberFormat(lang, { maximumFractionDigits: 2 }).format(n)} ${s}`;
  } catch {
    return `${n.toFixed(2)} ${s}`;
  }
}

function notificationFor(texts, p) {
  const t = (texts && (texts[p.l] || texts.en)) || {};
  const withAmount = p.a !== undefined && t[p.k] !== undefined;
  const raw = (withAmount ? t[p.k] : t[`${p.k}NoAmount`]) || "";
  const amount = withAmount ? formatPushAmount(p.a, p.d === undefined ? 6 : p.d, p.s || "$", p.l) : "";
  return { title: t.title || "NivPay", body: raw.replace("{amount}", amount).replace("{pot}", p.n || "") };
}

function urlFor(p) {
  const num = (v) => typeof v === "string" && /^\d{1,20}$/.test(v);
  // A pot on NivPayPotsV2 comes as "v2:" and its number.
  const pot = (v) => typeof v === "string" && /^(v2:)?\d{1,20}$/.test(v);
  if (p.k === "received") return "/?go=receive";
  if (p.k === "askYes" && pot(p.p) && num(p.r)) return `/?go=request&pot=${p.p}&ask=${p.r}`;
  if ((p.k === "chippedIn" || p.k === "potNamesYou" || p.k === "changeApproved") && pot(p.p)) return `/?go=pot&pot=${p.p}`;
  return "/?go=notes";
}
// END push

self.addEventListener("push", (event) => {
  let p;
  try {
    p = event.data.json();
  } catch {
    p = { k: "notes", l: "en" };
  }
  const { title, body } = notificationFor(PUSH_TEXTS, p);
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: urlFor(p) },
    }),
  );
});

// A tap opens the screen it is about: in the app if it is open, else in a new window.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => new URL(c.url).origin === self.location.origin);
      if (open) {
        open.postMessage({ nivpayGo: url });
        return open.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
