import { useEffect, useState } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import { Field, Select } from './ui'
import FileUpload from './FileUpload'

const GENDER  = ['male', 'female', 'other']
const MARITAL = ['single', 'married', 'divorced', 'widowed']
const STATUS  = ['active', 'leave', 'suspended', 'exited']
const WORKER  = ['surface', 'underground', 'office', 'field']
const IDTYPE  = ['ghana_card', 'passport', 'voter', 'drivers']

const TABS = [['employment', 'Employment'], ['contact', 'Contact'], ['personal', 'Personal & Family'], ['identity', 'Identity & Sizing'], ['docs', 'Documents']]

export default function EmployeeEditor({ open, initial, deptOptions, onClose, onSubmit, submitting }) {
  const [f, setF] = useState({})
  const [tab, setTab] = useState('employment')

  useEffect(() => {
    if (open) {
      setF({ ...(initial || {}), dependants: Array.isArray(initial?.dependants) ? initial.dependants : [] })
      setTab('employment')
    }
  }, [open, initial])

  if (!open) return null
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }))
  const setFile = (k) => (url) => set(k, url)

  const addKid = () => set('dependants', [...(f.dependants || []), { name: '', relation: 'child', dob: '' }])
  const setKid = (i, key, val) => set('dependants', f.dependants.map((k, idx) => idx === i ? { ...k, [key]: val } : k))
  const delKid = (i) => set('dependants', f.dependants.filter((_, idx) => idx !== i))

  const submit = () => {
    const p = { ...f }
    if (p.number_of_kids !== '' && p.number_of_kids != null) p.number_of_kids = Number(p.number_of_kids)
    Object.keys(p).forEach((k) => { if (p[k] === '') p[k] = null })
    p.dependants = f.dependants || []
    onSubmit(p)
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-navy/70 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-xl flex-col border-l border-white/10 bg-navy-800 shadow-pop animate-slide-in">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <h2 className="font-display text-lg font-bold text-ice">{initial?.id ? 'Edit Employee' : 'New Employee'}</h2>
          <button onClick={onClose} className="rounded-md p-1.5 text-ice-faint hover:bg-white/5 hover:text-ice"><X size={18} /></button>
        </div>

        {/* Tab strip */}
        <div className="flex gap-1 overflow-x-auto border-b border-white/[0.06] px-4 py-2">
          {TABS.map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition ${tab === k ? 'bg-accent text-navy' : 'text-ice-dim hover:text-ice'}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'employment' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Full name *" span><input className="input" value={f.full_name || ''} onChange={(e) => set('full_name', e.target.value)} /></Field>
              <Field label="Employee no."><input className="input" value={f.employee_no || ''} onChange={(e) => set('employee_no', e.target.value)} /></Field>
              <Field label="Department"><Select value={f.department || ''} onChange={(e) => set('department', e.target.value)} options={[{ value: '', label: '—' }, ...deptOptions]} /></Field>
              <Field label="Position"><input className="input" value={f.position || ''} onChange={(e) => set('position', e.target.value)} /></Field>
              <Field label="Worker type"><Select value={f.worker_type || ''} onChange={(e) => set('worker_type', e.target.value)} options={[{ value: '', label: '—' }, ...WORKER.map((s) => ({ value: s, label: s }))]} /></Field>
              <Field label="Status"><Select value={f.status || 'active'} onChange={(e) => set('status', e.target.value)} options={STATUS.map((s) => ({ value: s, label: s }))} /></Field>
              <Field label="Hired on"><input className="input" type="date" value={f.hired_on || ''} onChange={(e) => set('hired_on', e.target.value)} /></Field>
            </div>
          )}

          {tab === 'contact' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Email"><input className="input" type="email" value={f.email || ''} onChange={(e) => set('email', e.target.value)} /></Field>
              <Field label="Phone"><input className="input" value={f.phone || ''} onChange={(e) => set('phone', e.target.value)} /></Field>
              <Field label="Home address" span><textarea className="input min-h-[70px]" value={f.home_address || ''} onChange={(e) => set('home_address', e.target.value)} /></Field>
              <Field label="Postal / PO address" span><textarea className="input min-h-[70px]" value={f.postal_address || ''} onChange={(e) => set('postal_address', e.target.value)} /></Field>
              <div className="sm:col-span-2 mt-2 border-t border-white/[0.06] pt-3">
                <div className="eyebrow mb-3">Emergency / Next of kin</div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Name"><input className="input" value={f.next_of_kin_name || ''} onChange={(e) => set('next_of_kin_name', e.target.value)} /></Field>
                  <Field label="Relationship"><input className="input" value={f.next_of_kin_relation || ''} onChange={(e) => set('next_of_kin_relation', e.target.value)} /></Field>
                  <Field label="Phone" span><input className="input" value={f.next_of_kin_phone || ''} onChange={(e) => set('next_of_kin_phone', e.target.value)} /></Field>
                </div>
              </div>
            </div>
          )}

          {tab === 'personal' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Date of birth"><input className="input" type="date" value={f.date_of_birth || ''} onChange={(e) => set('date_of_birth', e.target.value)} /></Field>
              <Field label="Gender"><Select value={f.gender || ''} onChange={(e) => set('gender', e.target.value)} options={[{ value: '', label: '—' }, ...GENDER.map((s) => ({ value: s, label: s }))]} /></Field>
              <Field label="Nationality"><input className="input" value={f.nationality || ''} onChange={(e) => set('nationality', e.target.value)} /></Field>
              <Field label="Marital status"><Select value={f.marital_status || ''} onChange={(e) => set('marital_status', e.target.value)} options={[{ value: '', label: '—' }, ...MARITAL.map((s) => ({ value: s, label: s }))]} /></Field>
              <Field label="Spouse name"><input className="input" value={f.spouse_name || ''} onChange={(e) => set('spouse_name', e.target.value)} /></Field>
              <Field label="Spouse phone"><input className="input" value={f.spouse_phone || ''} onChange={(e) => set('spouse_phone', e.target.value)} /></Field>
              <Field label="Number of children"><input className="input" type="number" min="0" value={f.number_of_kids ?? ''} onChange={(e) => set('number_of_kids', e.target.value)} /></Field>

              <div className="sm:col-span-2 mt-1">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-ice-faint">Dependants / children</span>
                  <button type="button" onClick={addKid} className="btn-ghost btn-sm"><Plus size={13} /> Add</button>
                </div>
                <div className="space-y-2">
                  {(f.dependants || []).map((k, i) => (
                    <div key={i} className="flex gap-2">
                      <input className="input" placeholder="Name" value={k.name} onChange={(e) => setKid(i, 'name', e.target.value)} />
                      <input className="input w-28" placeholder="Relation" value={k.relation} onChange={(e) => setKid(i, 'relation', e.target.value)} />
                      <input className="input w-36" type="date" value={k.dob} onChange={(e) => setKid(i, 'dob', e.target.value)} />
                      <button type="button" onClick={() => delKid(i)} className="rounded-md px-2 text-ice-faint hover:text-bad"><Trash2 size={15} /></button>
                    </div>
                  ))}
                  {(f.dependants || []).length === 0 && <p className="text-xs text-ice-faint">No dependants added.</p>}
                </div>
              </div>
            </div>
          )}

          {tab === 'identity' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="ID type"><Select value={f.id_type || ''} onChange={(e) => set('id_type', e.target.value)} options={[{ value: '', label: '—' }, ...IDTYPE.map((s) => ({ value: s, label: s.replace('_', ' ') }))]} /></Field>
              <Field label="ID number"><input className="input" value={f.id_number || ''} onChange={(e) => set('id_number', e.target.value)} /></Field>
              <Field label="SSNIT number"><input className="input" value={f.ssnit_number || ''} onChange={(e) => set('ssnit_number', e.target.value)} /></Field>
              <Field label="TIN"><input className="input" value={f.tin_number || ''} onChange={(e) => set('tin_number', e.target.value)} /></Field>
              <div className="sm:col-span-2 mt-2 border-t border-white/[0.06] pt-3">
                <div className="eyebrow mb-3">Sizing (PPE / uniform)</div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Dress / clothing size"><input className="input" value={f.dress_size || ''} onChange={(e) => set('dress_size', e.target.value)} placeholder="e.g. L, XL, 42" /></Field>
                  <Field label="Shoe size"><input className="input" value={f.shoe_size || ''} onChange={(e) => set('shoe_size', e.target.value)} placeholder="e.g. 43" /></Field>
                </div>
              </div>
            </div>
          )}

          {tab === 'docs' && (
            <div className="space-y-4">
              <FileUpload label="Passport photo" image accept="image/*" value={f.photo_url} onChange={setFile('photo_url')} entityId={f.id} field="photo" />
              <FileUpload label="Contract letter" accept=".pdf,.doc,.docx,image/*" value={f.contract_url} onChange={setFile('contract_url')} entityId={f.id} field="contract" />
              <FileUpload label="ID document" accept=".pdf,image/*" value={f.id_document_url} onChange={setFile('id_document_url')} entityId={f.id} field="id" />
              <div className="border-t border-white/[0.06] pt-4">
                <Field label="Non-compliance note" span><textarea className="input min-h-[70px]" value={f.compliance_note || ''} onChange={(e) => set('compliance_note', e.target.value)} placeholder="Describe any non-compliance issue…" /></Field>
                <div className="mt-3"><FileUpload label="Non-compliance letter" accept=".pdf,.doc,.docx,image/*" value={f.compliance_url} onChange={setFile('compliance_url')} entityId={f.id} field="compliance" /></div>
              </div>
              <div className="border-t border-white/[0.06] pt-4">
                <Field label="Additional notes" span><textarea className="input min-h-[70px]" value={f.notes || ''} onChange={(e) => set('notes', e.target.value)} /></Field>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-between gap-2 border-t border-white/[0.06] px-5 py-4">
          <p className="self-center text-[11px] text-ice-faint">Tab: {TABS.find(([k]) => k === tab)?.[1]}</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={submit} disabled={submitting} className="btn-primary">{submitting ? 'Saving…' : 'Save employee'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
