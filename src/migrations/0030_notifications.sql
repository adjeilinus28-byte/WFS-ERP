-- ============================================================================
--  WFS Enterprise — 0030 Notifications hub
--  A derived feed (no event ingestion needed): one view unions the live alert
--  sources into a common shape. A dismissals table records per-user "seen" so
--  the bell's unread count is personal. Deterministic ref_id keys let a user
--  dismiss a specific alert. Run after 0029.
--
--  Sources:
--    incident   — open/investigating HSE incidents (high/critical first)
--    approval   — pending leave requests & purchase requests
--    cert       — training certs expired or expiring within 30 days
--    stock      — inventory items at/below reorder level
-- ============================================================================

-- Per-user dismissals. ref_id is the stable key from the feed (kind:uuid).
create table if not exists public.notification_dismissals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  ref_id text not null,
  dismissed_at timestamptz not null default now()
);
create unique index if not exists notif_dismiss_uidx
  on public.notification_dismissals(org_id, user_id, ref_id);

alter table public.notification_dismissals enable row level security;

drop policy if exists notif_dismiss_rw on public.notification_dismissals;
create policy notif_dismiss_rw on public.notification_dismissals
  for all using (user_id = auth.uid() and org_id in (select public.user_org_ids()))
  with check (user_id = auth.uid() and org_id in (select public.user_org_ids()));

-- ── The feed view ───────────────────────────────────────────────────────────
-- security_invoker so each source's own RLS still applies to the caller.
create or replace view public.notifications_feed with (security_invoker = true) as

-- 1) Open HSE incidents
select
  i.org_id,
  'incident'::text                              as kind,
  'incident:' || i.id::text                     as ref_id,
  coalesce(i.incident_no, 'Incident') || ' — ' || coalesce(i.incident_type, '') as title,
  coalesce(i.location, i.department, '')         as detail,
  case when i.severity in ('high','critical') then 'bad'
       when i.severity = 'medium' then 'warn' else 'info' end as severity,
  i.occurred_at                                  as created_at,
  '/hse'::text                                   as link
from public.hse_incidents i
where i.status in ('open','investigating')

union all
-- 2a) Pending leave requests
select
  l.org_id, 'approval',
  'leave:' || l.id::text,
  'Leave request — ' || coalesce(l.employee_name, 'employee'),
  coalesce(l.leave_type, '') || ' · ' || coalesce(l.days::text, '?') || ' days',
  'warn',
  l.created_at,
  '/hr'
from public.leave_requests l
where l.status = 'pending'

union all
-- 2b) Pending purchase requests
select
  p.org_id, 'approval',
  'preq:' || p.id::text,
  'Purchase request — ' || coalesce(p.title, 'request'),
  coalesce(p.est_total::text, ''),
  'warn',
  p.created_at,
  '/procurement'
from public.purchase_requests p
where p.status = 'pending'

union all
-- 3) Expiring / expired training certs
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
-- 4) Low / out of stock
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
