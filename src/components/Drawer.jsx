import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Field, Select } from './ui'

// Slide-over with a form rendered from a `fields` config:
//   { key, label, type: 'text'|'number'|'date'|'textarea'|'select', options?, span?, required? }
export default function Drawer({ open, onClose, title, fields, initial, onSubmit, submitting }) {
  const [form, setForm] = useState({})

  useEffect(() => {
    if (open) {
      const base = {}
      fields.forEach((f) => { base[f.key] = initial?.[f.key] ?? (f.type === 'number' ? '' : (f.default ?? '')) })
      setForm(base)
    }
  }, [open, initial, fields])

  if (!open) return null
  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }))

  const submit = () => {
    const payload = {}
    fields.forEach((f) => {
      let v = form[f.key]
      if (f.type === 'number') v = v === '' || v == null ? null : Number(v)
      if (v === '') v = null
      payload[f.key] = v
    })
    onSubmit(payload)
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-navy/70 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="relative h-full w-full max-w-md overflow-y-auto border-l border-white/10 bg-navy-800 shadow-pop animate-slide-in">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/[0.06] bg-navy-800/95 px-5 py-4 backdrop-blur">
          <h2 className="font-display text-lg font-bold text-ice">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1.5 text-ice-faint hover:bg-white/5 hover:text-ice"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          {fields.map((f) => (
            <Field key={f.key} label={f.label + (f.required ? ' *' : '')} span={f.span}>
              {f.type === 'select' ? (
                <Select value={form[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}
                  options={[{ value: '', label: '—' }, ...f.options]} />
              ) : f.type === 'textarea' ? (
                <textarea className="input min-h-[90px]" value={form[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} />
              ) : (
                <input className="input" type={f.type || 'text'} value={form[f.key] ?? ''}
                  onChange={(e) => set(f.key, e.target.value)} />
              )}
            </Field>
          ))}
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-white/[0.06] bg-navy-800/95 px-5 py-4 backdrop-blur">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={submit} disabled={submitting} className="btn-primary">
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
