/* 祥興沂融營運系統 — 最小 Service Worker
 * - 頁面導覽：network-first，斷線時回 offline.html
 * - 只處理同源 GET；Supabase API、非 GET 一律不攔截、不快取
 * - 不快取 JS/CSS bundle（避免部署後卡舊版）
 */
const CACHE = "xx-yr-shell-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // 跨網域（含 *.supabase.co REST／Auth／Realtime／Storage）完全不碰
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/rest/") || url.pathname.startsWith("/auth/") ||
      url.pathname.startsWith("/functions/") || url.pathname.startsWith("/realtime/") ||
      url.pathname.startsWith("/storage/") || url.pathname.startsWith("/_serverFn") ||
      url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(OFFLINE_URL).then((r) => r || new Response("離線中", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })),
      ),
    );
    return;
  }

  // 圖示與 manifest：cache-first（其餘資源走瀏覽器預設）
  if (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});
