// Logo helpers.
//
// trimLogo(src): crops the empty (transparent or near-white) border around a
// logo so it shows at a readable size in letterheads and documents. Works on
// data: URLs (how logos are stored), returns a PNG data URL, and falls back to
// the original image if anything goes wrong.
const cache = new Map()

const load = (src) => new Promise((resolve, reject) => {
  const img = new Image()
  img.onload = () => resolve(img)
  img.onerror = reject
  img.src = src
})

export async function trimImageElement(img, { pad = 0.04 } = {}) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height
  if (!w || !h) return null
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0)
  const { data } = ctx.getImageData(0, 0, w, h)
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const a = data[i + 3]
      const blank = a < 16 || (data[i] > 242 && data[i + 1] > 242 && data[i + 2] > 242)
      if (!blank) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    }
  }
  if (x1 < 0) return null                                   // nothing visible
  const p = Math.round(Math.max(x1 - x0, y1 - y0) * pad)
  x0 = Math.max(0, x0 - p); y0 = Math.max(0, y0 - p)
  x1 = Math.min(w - 1, x1 + p); y1 = Math.min(h - 1, y1 + p)
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1
  if (cw >= w * 0.97 && ch >= h * 0.97) return null         // already tight
  const out = document.createElement('canvas'); out.width = cw; out.height = ch
  out.getContext('2d').drawImage(c, x0, y0, cw, ch, 0, 0, cw, ch)
  return out
}

export function trimLogo(src) {
  if (!src) return Promise.resolve(src)
  if (cache.has(src)) return cache.get(src)
  const job = load(src)
    .then((img) => trimImageElement(img))
    .then((canvas) => (canvas ? canvas.toDataURL('image/png') : src))
    .catch(() => src)
  cache.set(src, job)
  return job
}
