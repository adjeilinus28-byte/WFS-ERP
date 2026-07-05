import { CAT } from '../components/NewsFlash'
import ModuleScaffold from '../components/ModuleScaffold'
import { Badge, StatCard } from '../components/ui'
import { date } from '../lib/format'
import { Megaphone, Sparkles, Pin, Calendar } from 'lucide-react'

const CAT_OPTS = Object.keys(CAT).map((k) => ({ value: k, label: CAT[k].label }))
const PRIORITY = ['low', 'normal', 'high']

export default function NewsFlashAdmin() {
  return (
    <ModuleScaffold
      eyebrow="Overview" title="News Flash" table="news_flash"
      newLabel="Post announcement" emptyTitle="No announcements yet"
      emptyHint="Post announcements, campaigns, and notices — they appear on everyone's Command Deck."
      searchKeys={['title', 'category', 'body']}
      columns={[
        { key: 'title', label: 'Title' },
        { key: 'category', label: 'Category', render: (v) => <Badge>{CAT[v]?.label || v}</Badge> },
        { key: 'priority', label: 'Priority', render: (v) => <Badge tone={v === 'high' ? 'bad' : 'mute'}>{v}</Badge> },
        { key: 'pinned', label: 'Pinned', render: (v) => v ? <Pin size={14} className="text-accent" /> : '—' },
        { key: 'starts_on', label: 'Starts', render: (v) => date(v) },
        { key: 'ends_on', label: 'Ends', render: (v) => v ? date(v) : '—' },
        { key: 'active', label: 'Active', render: (v) => <Badge tone={v ? 'ok' : 'mute'}>{v ? 'live' : 'off'}</Badge> },
      ]}
      fields={[
        { key: 'title', label: 'Title', required: true, span: true },
        { key: 'body', label: 'Message', type: 'textarea', span: true },
        { key: 'category', label: 'Category', type: 'select', options: CAT_OPTS, default: 'announcement' },
        { key: 'priority', label: 'Priority', type: 'select', options: PRIORITY.map((s) => ({ value: s, label: s })), default: 'normal' },
        { key: 'link_url', label: 'Link URL (optional)' },
        { key: 'link_label', label: 'Link label' },
        { key: 'starts_on', label: 'Start date', type: 'date' },
        { key: 'ends_on', label: 'End date', type: 'date' },
      ]}
      beforeSave={(p) => ({ ...p, active: p.active ?? true, pinned: p.pinned ?? false })}
      kpis={(rows) => {
        const today = new Date().toISOString().slice(0, 10)
        const live = rows.filter((r) => r.active && (!r.ends_on || r.ends_on >= today)).length
        return <>
          <StatCard label="Total posts" value={rows.length} icon={Megaphone} />
          <StatCard label="Live now" value={live} tone="ok" icon={Sparkles} />
          <StatCard label="Campaigns" value={rows.filter((r) => r.category === 'campaign').length} icon={Sparkles} />
          <StatCard label="Pinned" value={rows.filter((r) => r.pinned).length} icon={Pin} />
        </>
      }}
    />
  )
}
