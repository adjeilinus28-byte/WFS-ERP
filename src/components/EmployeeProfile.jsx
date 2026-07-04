import { X, Phone, Mail, MapPin, FileText, ExternalLink, AlertTriangle } from 'lucide-react'
import { Badge, statusTone } from './ui'
import { date, initials } from '../lib/format'

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4 border-b border-white/[0.05] py-2">
      <span className="font-mono text-[11px] uppercase tracking-wider text-ice-faint">{label}</span>
      <span className="text-right text-sm text-ice/90">{value || '—'}</span>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="mb-5">
      <div className="eyebrow mb-2">{title}</div>
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4">{children}</div>
    </div>
  )
}

function FileLink({ label, url, icon: Icon = FileText }) {
  return (
    <div className="flex items-center justify-between border-b border-white/[0.05] py-2.5">
      <span className="flex items-center gap-2 text-sm text-ice/90"><Icon size={14} className="text-ice-faint" /> {label}</span>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-info hover:underline">
          Open <ExternalLink size={11} />
        </a>
      ) : <span className="text-xs text-ice-faint">Not uploaded</span>}
    </div>
  )
}

export default function EmployeeProfile({ employee, onClose, onEdit, canWrite }) {
  if (!employee) return null
  const e = employee
  const kids = Array.isArray(e.dependants) ? e.dependants : []

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-navy/70 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="relative h-full w-full max-w-lg overflow-y-auto border-l border-white/10 bg-navy-800 shadow-pop animate-slide-in">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-white/[0.06] bg-navy-800/95 px-5 py-4 backdrop-blur">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              {e.photo_url ? (
                <img src={e.photo_url} alt="" className="h-14 w-14 rounded-xl border border-white/10 object-cover" />
              ) : (
                <div className="grid h-14 w-14 place-items-center rounded-xl bg-accent-soft font-mono text-lg font-bold text-accent">
                  {initials(e.full_name)}
                </div>
              )}
              <div>
                <h2 className="font-display text-xl font-bold text-ice">{e.full_name}</h2>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="font-mono text-xs text-accent">{e.employee_no || '—'}</span>
                  <Badge tone={statusTone(e.status)}>{e.status}</Badge>
                </div>
              </div>
            </div>
            <button onClick={onClose} className="rounded-md p-1.5 text-ice-faint hover:bg-white/5 hover:text-ice"><X size={18} /></button>
          </div>
          {canWrite && (
            <button onClick={() => onEdit(e)} className="btn-primary btn-sm mt-3 w-full">Edit full profile</button>
          )}
        </div>

        <div className="p-5">
          <Section title="Employment">
            <Row label="Department" value={e.department} />
            <Row label="Position" value={e.position} />
            <Row label="Worker type" value={e.worker_type} />
            <Row label="Hired on" value={date(e.hired_on)} />
          </Section>

          <Section title="Contact">
            <Row label="Email" value={e.email} />
            <Row label="Phone" value={e.phone} />
            <Row label="Home address" value={e.home_address} />
            <Row label="Postal / PO address" value={e.postal_address} />
          </Section>

          <Section title="Personal">
            <Row label="Date of birth" value={date(e.date_of_birth)} />
            <Row label="Gender" value={e.gender} />
            <Row label="Nationality" value={e.nationality} />
            <Row label="Marital status" value={e.marital_status} />
          </Section>

          {(e.spouse_name || e.number_of_kids > 0 || kids.length > 0) && (
            <Section title="Family">
              <Row label="Spouse name" value={e.spouse_name} />
              <Row label="Spouse phone" value={e.spouse_phone} />
              <Row label="Number of children" value={e.number_of_kids} />
              {kids.length > 0 && (
                <div className="py-2">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-ice-faint">Dependants</span>
                  <div className="mt-1.5 space-y-1">
                    {kids.map((k, i) => (
                      <div key={i} className="flex justify-between rounded bg-white/[0.03] px-2 py-1 text-sm">
                        <span>{k.name}</span>
                        <span className="text-ice-faint">{k.relation}{k.dob ? ` · ${date(k.dob)}` : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Section>
          )}

          <Section title="Emergency / Next of kin">
            <Row label="Name" value={e.next_of_kin_name} />
            <Row label="Relationship" value={e.next_of_kin_relation} />
            <Row label="Phone" value={e.next_of_kin_phone} />
          </Section>

          <Section title="Identity & statutory">
            <Row label="ID type" value={e.id_type} />
            <Row label="ID number" value={e.id_number} />
            <Row label="SSNIT number" value={e.ssnit_number} />
            <Row label="TIN" value={e.tin_number} />
          </Section>

          <Section title="Sizing (PPE / uniform)">
            <Row label="Top / shirt size" value={e.top_size || e.dress_size} />
            <Row label="Trouser waist" value={e.trouser_waist} />
            <Row label="Shoe size" value={e.shoe_size} />
          </Section>

          <Section title="Bank & payroll">
            <Row label="Bank" value={e.bank_name} />
            <Row label="Branch" value={e.bank_branch} />
            <Row label="Account name" value={e.account_name} />
            <Row label="Account number" value={e.account_number} />
            <Row label="Account type" value={e.account_type?.replace('_', ' ')} />
            <Row label="Mobile money" value={e.mobile_money_no} />
          </Section>

          <Section title="Documents">
            <FileLink label="Passport photo" url={e.photo_url} />
            <FileLink label="Contract letter" url={e.contract_url} />
            <FileLink label={e.id_document_type ? `ID document (${e.id_document_type.replace('_', ' ')})` : 'ID document'} url={e.id_document_url} />
            <FileLink label="Non-compliance letter" url={e.compliance_url} icon={AlertTriangle} />
          </Section>

          {e.compliance_note && (
            <Section title="Non-compliance note">
              <p className="py-3 text-sm text-warn">{e.compliance_note}</p>
            </Section>
          )}

          {e.notes && (
            <Section title="Notes">
              <p className="py-3 text-sm text-ice/80">{e.notes}</p>
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}
