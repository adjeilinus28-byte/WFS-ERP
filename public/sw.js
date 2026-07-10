// ============================================================================
//  WFS Enterprise service worker
//  - App shell (HTML/JS/CSS/icons): stale-while-revalidate, so the app opens
//    instantly and offline, while fresh assets download in the background.
//  - Navigations: network-first with cache fallback (offline still opens app).
//  - NEVER caches Supabase / API / auth calls — those must always hit network
//    so data is never stale and auth tokens are never served from cache.
//  Bump CACHE_VERSION to force old caches out on the next visit.
// ============================================================================
const CACHE_VERSION = 'wfs-v1'
const APP_SHELL = `${CACHE_VERSION}-shell`

// Hosts we must never cache (live data + auth).
const BYPASS_HOSTS = ['supabase.co', 'supabase.in', 'api.anthropic.com', 'brevo.com', 'sendinblue.com']
const isBypassed = (url) => BYPASS_HOSTS.some((h) => url.hostname.endsWith(h))

self.addEventListener('install', (event) => {
  // Pre-cache the entry point so a cold offline start still boots.
  event.waitUntil(caches.open(APP_SHELL).then((c) => c.addAll(['/', '/index.html', '/manifest.webmanifest'])).catch(() => {}))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  )
})

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting() })

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  // Only handle same-origin; let cross-origin (Supabase, fonts CDN, etc.) pass through.
  if (url.origin !== self.location.origin) return
  if (isBypassed(url)) return

  // Navigations → network-first, fall back to cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => { cachePut(APP_SHELL, request, res.clone()); return res })
        .catch(() => caches.match(request).then((r) => r || caches.match('/index.html')))
    )
    return
  }

  // Static assets (hashed JS/CSS/icons) → stale-while-revalidate.
  if (/\.(js|css|png|svg|webmanifest|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((res) => { cachePut(APP_SHELL, request, res.clone()); return res })
          .catch(() => cached)
        return cached || network
      })
    )
  }
})

function cachePut(cacheName, request, response) {
  if (!response || response.status !== 200 || response.type === 'opaque') return
  caches.open(cacheName).then((c) => c.put(request, response)).catch(() => {})
}
