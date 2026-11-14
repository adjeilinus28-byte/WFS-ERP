-- ============================================================================
--  WFS Enterprise — 0031 Point approval notifications at the Approvals inbox
--  Item 6 adds a unified approvals page. Re-target the feed's approval rows
--  (leave + purchase requests) to /approvals so the bell deep-links there.
--  Rebuilds notifications_feed identically to 0030 except the two link values.
--  Run after 0030.
-- ============================================================================

create or replace view public.notifications_feed with (security_invoker = true) as

select
  i.org_id, 'incident'::text as kind,
  'incident:' || i.id::text as ref_id,
  coalesce(i.incident_no, 'Incident') || ' — ' || coalesce(i.incident_type, '') as title,
  coalesce(i.location, i.department, '') as detail,
  case when i.severity in ('high','critical') then 'bad'
       when i.severity = 'medium' then 'warn' else 'info' end as severity,
  i.occurred_at as created_at,
  '/hse'::text as link
from public.hse_incidents i
where i.status in ('open','investigating')

union all
select
  l.org_id, 'approval',
  'leave:' || l.id::text,
  'Leave request — ' || coalesce(l.employee_name, 'employee'),
  coalesce(l.leave_type, '') || ' · ' || coalesce(l.days::text, '?') || ' days',
  'warn', l.created_at,
  '/approvals'
from public.leave_requests l
where l.status = 'pending'

union all
select
  p.org_id, 'approval',
  'preq:' || p.id::text,
  'Purchase request — ' || coalesce(p.title, 'request'),
  coalesce(p.est_total::text, ''),
  'warn', p.created_at,
  '/approvals'
from public.purchase_requests p
where p.status = 'pending'

union all
select
  m.org_id, 'cert',
  'cert:' || m.employee_id::text || ':' || m.training_type,
  coalesce(m.employee_name, 'Employee') || ' — ' || replace(m.training_type, '_', ' '),
  case when m.cert_status = 'expired' then 'Expired ' || coalesce(m.expires_at::text, '')
       else 'Expires ' || coalesce(m.expires_at::text, '') end,
  case when m.cert_status = 'expired' then 'bad' else 'warn' end,
  coalesce(m.expires_at::timestamptz, now()),
  '/training'
from public.training_matrix m
where m.cert_status in ('expired','expiring')

union all
select
  it.org_id, 'stock',
  'stock:' || it.id::text,
  coalesce(it.name, it.sku) || ' — low stock',
  coalesce(it.sku, '') || ' · ' || coalesce(it.qty_on_hand::text, '0') || ' ' || coalesce(it.uom, ''),
  case when coalesce(it.qty_on_hand,0) <= 0 then 'bad' else 'warn' end,
  now(),
  '/inventory'
from public.inventory_items it
where coalesce(it.qty_on_hand, 0) <= coalesce(it.reorder_level, 0)
  and coalesce(it.reorder_level, 0) > 0;

grant select on public.notifications_feed to authenticated;

notify pgrst, 'reload schema';
