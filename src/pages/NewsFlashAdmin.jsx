import { CAT } from '../components/NewsFlash'
import ModuleScaffold from '../components/ModuleScaffold'
import { Badge, StatCard } from '../components/ui'
import { useDepartments } from '../hooks/useDepartments'
import { date } from '../lib/format'
import { Megaphone, Sparkles, Pin, Mail } from 'lucide-react'
import { at } from '../lib/tr'

const CAT_OPTS = Object.keys(CAT).map((k) => ({ value: k, label: CAT[k].label }))
const PRIORITY = ['low', 'normal', 'high']
const TARGET_OPTS = [
  { value: '', label: "Don't email (banner only)" },
  { value: 'head', label: at('Email department head (CC workers)') },
  { value: 'supervisor', label: at('Email supervisor (CC workers)') },
]

export default function NewsFlashAdmin() {
  const { options: deptOptions } = useDepartments()
  const deptField = [{ value: '', label: at('All staff (organisation-wide)') }, ...deptOptions]

  return (
    <ModuleScaffold
      eyebrow="Overview" title="News Flash" sub="Announcements shown to your workforce." table="news_flash"
      newLabel="Post announcement" emptyTitle="No announcements yet"
      emptyHint="Post announcements, campaigns, and notices — they appear on the Command Deck and can be emailed to a department."
      searchKeys={['title', 'category', 'body']}
      columns={[
        { key: 'title', label: at('Title') },
        { key: 'category', label: at('Category'), render: (v) => <Badge>{CAT[v]?.label || v}</Badge> },
        { key: 'department', label: at('Audience'), render: (v) => v ? <Badge tone="accent">{v}</Badge> : <Badge tone="mute">{at('All staff')}</Badge> },
        { key: 'priority', label: at('Priority'), render: (v) => <Badge tone={v === 'high' ? 'bad' : 'mute'}>{v}</Badge> },
        { key: 'notify_target', label: at('Emailed'), render: (v, row) => row.emailed_at ? <Badge tone="ok"><Mail size={10} className="mr-1 inline" />{at('sent')}</Badge> : v ? <Badge tone="warn">{at('pending')}</Badge> : '—' },
        { key: 'starts_on', label: at('Starts'), render: (v) => date(v) },
        { key: 'active', label: at('Active'), render: (v) => <Badge tone={v ? 'ok' : 'mute'}>{v ? 'live' : 'off'}</Badge> },
      ]}
      fields={[
        { key: 'title', label: at('Title'), required: true, span: true },
        { key: 'body', label: at('Message'), type: 'textarea', span: true },
        { key: 'category', label: at('Category'), type: 'select', options: CAT_OPTS, default: 'announcement' },
        { key: 'priority', label: at('Priority'), type: 'select', options: PRIORITY.map((s) => ({ value: s, label: s })), default: 'normal' },
        { key: 'department', label: at('Audience'), type: 'select', options: deptField },
        { key: 'notify_target', label: at('Email dispatch'), type: 'select', options: TARGET_OPTS },
        { key: 'link_url', label: at('Link URL (optional)') },
        { key: 'link_label', label: at('Link label') },
        { key: 'starts_on', label: at('Start date'), type: 'date' },
        { key: 'ends_on', label: at('End date'), type: 'date' },
      ]}
      beforeSave={(p) => ({ ...p, active: p.active ?? true, pinned: p.pinned ?? false, department: p.department || null, notify_target: p.notify_target || null })}
      afterSave={(rec) => {
        // Fire the email once, only when a dispatch target is chosen and not already sent
        if (rec?.notify_target && !rec.emailed_at && rec.id) {
          fetch('/.netlify/functions/news-notify', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ org_id: rec.org_id, news_id: rec.id }),
          }).catch(() => {})
        }
      }}
      kpis={(rows) => {
        const today = new Date().toISOString().slice(0, 10)
        const live = rows.filter((r) => r.active && (!r.ends_on || r.ends_on >= today)).length
        return <>
          <StatCard label="Total posts" value={rows.length} icon={Megaphone} />
          <StatCard label="Live now" value={live} tone="ok" icon={Sparkles} />
          <StatCard label="Dept-targeted" value={rows.filter((r) => r.department).length} icon={Pin} />
          <StatCard label="Emailed" value={rows.filter((r) => r.emailed_at).length} icon={Mail} />
        </>
      }}
    />
  )
}
