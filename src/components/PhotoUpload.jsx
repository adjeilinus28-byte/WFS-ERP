import { useRef, useState } from 'react'
import { Camera, X, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// Multi-photo uploader → array of signed URLs (safety-files bucket).
export default function PhotoUpload({ label = 'Photos', value = [], onChange, entityId }) {
  const { activeOrgId } = useAuth()
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const urls = Array.isArray(value) ? value : []

  const handle = async (e) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setBusy(true)
    try {
      const added = []
      for (const file of files) {
        if (file.size > 10 * 1024 * 1024) continue
        const ext = file.name.split('.').pop()
        const path = `${activeOrgId}/${entityId || 'new'}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
        const { error } = await supabase.storage.from('safety-files').upload(path, file, { upsert: true })
        if (!error) {
          const { data: signed } = await supabase.storage.from('safety-files').createSignedUrl(path, 315360000)
          if (signed?.signedUrl) added.push(signed.signedUrl)
        }
      }
      onChange([...urls, ...added])
    } finally { setBusy(false) }
  }

  return (
    <div>
      <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-wider text-ice-faint">{label}</span>
      <div className="flex flex-wrap gap-2">
        {urls.map((u, i) => (
          <div key={i} className="relative h-16 w-16 overflow-hidden rounded-lg border border-white/10">
            <img src={u} alt="" className="h-full w-full object-cover" />
            <button type="button" onClick={() => onChange(urls.filter((_, idx) => idx !== i))}
              className="absolute right-0 top-0 grid h-5 w-5 place-items-center bg-navy/80 text-bad hover:bg-navy"><X size={12} /></button>
          </div>
        ))}
        <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
          className="grid h-16 w-16 place-items-center rounded-lg border border-dashed border-white/15 text-ice-faint hover:border-accent/50 hover:text-ice disabled:opacity-50">
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
        </button>
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple capture="environment" onChange={handle} className="hidden" />
    </div>
  )
}
