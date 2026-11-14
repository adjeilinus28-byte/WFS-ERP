// ============================================================================
//  WFS Enterprise service worker  (v2 — deploy-safe caching)
//
//  Strategy, by resource type:
//   • Navigations (HTML)      → NETWORK-FIRST. Always fetch the newest index.html
//                               so a fresh deploy is seen on the first load. Falls
//                               back to a cached copy only when offline.
//   • Hashed build assets      → CACHE-FIRST. Vite fingerprints every JS/CSS file
//     (/assets/*-<hash>.*)       (index-a6M0nYNe.js …); the filename IS the version,
//                               so a cached hit is guaranteed current. New builds
//                               have new filenames → automatic fresh fetch. No
//                               revalidation needed, so no "stale then update".
//   • Other static (icons,     → STALE-WHILE-REVALIDATE. Non-fingerprinted files
//     manifest, fonts)           (icon-192.png, manifest.webmanifest) update in the
//                               background.
//   • Supabase / API / auth    → never touched (must always hit network).
//
//  Bump CACHE_VERSION on any strategy change to purge old caches on activate.
// ============================================================================
const CACHE_VERSION = 'wfs-v3'
const SHELL_CACHE  = `${CACHE_VERSION}-shell`   // index.html (offline fallback only)
const ASSET_CACHE  = `${CACHE_VERSION}-assets`  // immutable hashed build files
const STATIC_CACHE = `${CACHE_VERSION}-static`  // icons, manifest, fonts

const BYPASS_HOSTS = ['supabase.co', 'supabase.in', 'api.anthropic.com', 'brevo.com', 'sendinblue.com']
const isBypassed = (url) => BYPASS_HOSTS.some((h) => url.hostname.endsWith(h))

// Fingerprinted build output: /assets/name-<hash>.js|css  (immutable)
const isHashedAsset = (url) =>
  url.pathname.startsWith('/assets/') && /\-[A-Za-z0-9_]{8,}\.(js|css)$/.test(url.pathname)

const isStatic = (url) =>
  /\.(png|svg|ico|webmanifest|woff2?)$/.test(url.pathname)

self.addEventListener('install', (event) => {
  // Warm the shell so a cold offline start still boots. Not used online
  // (navigations are network-first), so it can never serve a stale app.
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.add('/index.html')).catch(() => {})
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Drop every cache that isn't this version.
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting() })

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (isBypassed(url)) return

  // 1) Navigations → network-first (fresh HTML every deploy), offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(SHELL_CACHE).then((c) => c.put('/index.html', copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match('/index.html'))
    )
    return
  }

  // 2) Hashed build assets → cache-first (immutable; filename is the version).
  if (isHashedAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) =>
        cached || fetch(request).then((res) => {
          if (res.status === 200) {
            const copy = res.clone()
            caches.open(ASSET_CACHE).then((c) => c.put(request, copy)).catch(() => {})
          }
          return res
        })
      )
    )
    return
  }

  // 3) Other static (icons, manifest, fonts) → stale-while-revalidate.
  if (isStatic(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request).then((res) => {
          if (res.status === 200) {
            const copy = res.clone()
            caches.open(STATIC_CACHE).then((c) => c.put(request, copy)).catch(() => {})
          }
          return res
        }).catch(() => cached)
        return cached || network
      })
    )
  }
})
