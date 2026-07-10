// Registers the service worker in production and surfaces an "update ready"
// prompt when a new version is waiting. Safe no-op if SW is unsupported.
export function registerSW() {
  if (!('serviceWorker' in navigator)) return
  if (!import.meta.env.PROD) return   // don't cache during local dev

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // A new SW has installed and is waiting → tell the user.
      reg.addEventListener('updatefind', () => {})
      reg.onupdatefound = () => {
        const sw = reg.installing
        if (!sw) return
        sw.onstatechange = () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateToast(() => { sw.postMessage('skipWaiting') })
          }
        }
      }
    }).catch(() => {})

    // When the new SW takes control, reload once to get fresh assets.
    let reloaded = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return
      reloaded = true
      window.location.reload()
    })
  })
}

// Minimal, dependency-free toast (runs outside React so it can't be missed).
function showUpdateToast(onUpdate) {
  if (document.getElementById('wfs-update-toast')) return
  const el = document.createElement('div')
  el.id = 'wfs-update-toast'
  el.setAttribute('role', 'status')
  el.style.cssText =
    'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:9999;' +
    'display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:12px;' +
    'background:#0E1424;color:#F1F5F9;border:1px solid rgba(255,255,255,.12);' +
    'box-shadow:0 18px 50px -12px rgba(0,0,0,.7);font:500 14px system-ui,sans-serif'
  const label = document.createElement('span')
  label.textContent = 'A new version is available.'
  const btn = document.createElement('button')
  btn.textContent = 'Update'
  btn.style.cssText = 'background:#F59E0B;color:#080C16;border:0;border-radius:8px;padding:6px 12px;font-weight:600;cursor:pointer'
  btn.onclick = onUpdate
  const dismiss = document.createElement('button')
  dismiss.textContent = '✕'
  dismiss.setAttribute('aria-label', 'Dismiss')
  dismiss.style.cssText = 'background:none;border:0;color:#64748B;cursor:pointer;font-size:15px'
  dismiss.onclick = () => el.remove()
  el.append(label, btn, dismiss)
  document.body.appendChild(el)
}
