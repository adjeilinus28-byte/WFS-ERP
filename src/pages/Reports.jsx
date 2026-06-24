import { useEffect, useState } from 'react'
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { PageHeader, StatCard, useToast } from '../components/ui'
import { money } from '../lib/format'
import { Sparkles, Printer, FileBarChart } from 'lucide-react'

const PALETTE = ['rgb(var(--accent))', '#38BDF8', '#34D399', '#F472B6', '#A78BFA']

export default function Reports() {
  const { activeOrgId, activeOrg } = useAuth()
  const toast = useToast()
  const [snap, setSnap] = useState(null)
  const [report, setReport] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!activeOrgId) return
    const f = (t, sel = '*') => supabase.from(t).select(sel).eq('org_id', activeOrgId)
    Promise.all([f('assets'), f('work_orders'), f('inventory_items'), f('hse_incidents')])
      .then(([a, w, i, h]) => {
        const inv = i.data || []
        setSnap({
          assets: a.data || [], wos: w.data || [], hse: h.data || [],
          invValue: inv.reduce((s, r) => s + Number(r.qty_on_hand || 0) * Number(r.unit_cost || 0), 0),
          lowStock: inv.filter((r) => Number(r.qty_on_hand) <= Number(r.reorder_level)).length,
          skus: inv.length,
        })
      })
  }, [activeOrgId])

  const generate = async () => {
    setBusy(true); setReport('')
    try {
      const res = await fetch('/.netlify/functions/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: activeOrgId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Generation failed')
      setReport(data.report || '')
    } catch (e) {
      toast.error(e.message + ' — deploy the Netlify functions and set ANTHROPIC_API_KEY first.')
    } finally { setBusy(false) }
  }

  if (!snap) return <div className="grid h-64 place-items-center text-ice-faint">Loading…</div>

  const woPie = ['open', 'in_progress', 'on_hold', 'done', 'cancelled']
    .map((s) => ({ name: s.replace('_', ' '), value: snap.wos.filter((r) => r.status === s).length }))
    .filter((x) => x.value)
  const hsePie = ['near_miss', 'injury', 'spill', 'equipment', 'environmental']
    .map((s) => ({ name: s.replace('_', ' '), value: snap.hse.filter((r) => r.incident_type === s).length }))
    .filter((x) => x.value)

  return (
    <div>
      <PageHeader eyebrow="Insight" title="Reports">
        <button className="btn-ghost" onClick={() => window.print()}><Printer size={15} /> Print</button>
        <button className="btn-primary" onClick={generate} disabled={busy}>
          <Sparkles size={15} /> {busy ? 'Generating…' : 'Generate AI report'}
        </button>
      </PageHeader>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Registered assets" value={snap.assets.length} icon={FileBarChart} />
        <StatCard label="Work orders" value={snap.wos.length} icon={FileBarChart} />
        <StatCard label="Stock value" value={money(snap.invValue, activeOrg?.currency)} icon={FileBarChart} />
        <StatCard label="HSE cases" value={snap.hse.length} icon={FileBarChart} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel p-5">
          <div className="eyebrow mb-4">Work order distribution</div>
          {woPie.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={woPie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {woPie.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: '#0E1424', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#CBD5E1' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <div className="grid h-56 place-items-center text-sm text-ice-faint">No data</div>}
        </div>

        <div className="panel p-5">
          <div className="eyebrow mb-4">HSE incidents by type</div>
          {hsePie.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={hsePie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {hsePie.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: '#0E1424', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#CBD5E1' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <div className="grid h-56 place-items-center text-sm text-ice-faint">No incidents — good news</div>}
        </div>
      </div>

      {report && (
        <div className="panel mt-4 p-6 animate-rise">
          <div className="eyebrow mb-3">AI operations summary</div>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-ice/90">{report}</div>
        </div>
      )}
    </div>
  )
}
