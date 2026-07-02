import { useRef, useState } from 'react'
import { Upload, FileText, Image as ImageIcon, X, ExternalLink, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// Uploads to the 'employee-files' bucket under {org_id}/{entityId}/{field}-{ts}.
// Stores a signed-URL-friendly path; returns a public-ish URL via createSignedUrl.
export default function FileUpload({ label, value, onChange, entityId, field, accept = '*', image = false }) {
  const { activeOrgId } = useAuth()
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const pick = () => inputRef.current?.click()

  const handle = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { setErr('Max 10 MB'); return }
    setBusy(true); setErr('')
    try {
      const ext = file.name.split('.').pop()
      const path = `${activeOrgId}/${entityId || 'new'}/${field}-${Date.now()}.${ext}`
      const { error } = await supabase.storage.from('employee-files').upload(path, file, { upsert: true })
      if (error) throw error
      // Signed URL valid for ~10 years (private bucket)
      const { data: signed } = await supabase.storage.from('employee-files').createSignedUrl(path, 315360000)
      onChange(signed?.signedUrl || path, path)
    } catch (e2) {
      setErr(e2.message || 'Upload failed')
    } finally { setBusy(false) }
  }

  return (
    <div>
      <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-wider text-ice-faint">{label}</span>
      <input ref={inputRef} type="file" accept={accept} onChange={handle} className="hidden" />

      {value ? (
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-navy/50 px-3 py-2">
          {image ? <ImageIcon size={15} className="text-accent" /> : <FileText size={15} className="text-accent" />}
          <a href={value} target="_blank" rel="noreferrer" className="flex-1 truncate text-xs text-info hover:underline">
            View file <ExternalLink size={11} className="inline" />
          </a>
          <button type="button" onClick={pick} className="text-[11px] text-ice-faint hover:text-ice">Replace</button>
          <button type="button" onClick={() => onChange('', '')} className="text-ice-faint hover:text-bad"><X size={14} /></button>
        </div>
      ) : (
        <button type="button" onClick={pick} disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 bg-navy/40 px-3 py-2.5 text-xs text-ice-dim transition hover:border-accent/50 hover:text-ice disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {busy ? 'Uploading…' : `Upload ${label.toLowerCase()}`}
        </button>
      )}
      {err && <p className="mt-1 text-[11px] text-bad">{err}</p>}
    </div>
  )
}
