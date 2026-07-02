-- ============================================================================
--  WFS Enterprise — 0006 Leave Management
--  Upgrades leave into a full sub-system: configurable leave types with annual
--  entitlements, per-employee balances, advance-notice + working-day rules,
--  and an approval workflow. Brevo handles notifications (via Netlify fn).
--  Run after 0005.
-- ============================================================================

-- ── Leave types (per tenant, configurable) ─────────────────────────────────
create table if not exists public.leave_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  code text,
  annual_entitlement integer not null default 0,   -- days granted per year
  color text default '#F59E0B',
  paid boolean not null default true,
  requires_notice_days integer not null default 1,  -- min advance notice
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists lt_org_name_uidx on public.leave_types(org_id, name);

-- ── Extend leave_requests with workflow + balance fields ────────────────────
alter table public.leave_requests
  add column if not exists employee_id   uuid references public.employees(id) on delete set null,
  add column if not exists working_days  numeric,
  add column if not exists decided_by     text,
  add column if not exists decided_at     timestamptz,
  add column if not exists decision_note  text,
  add column if not exists notified       boolean default false;

-- ── Per-employee manual balance adjustments / carryover ─────────────────────
create table if not exists public.leave_adjustments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_type text not null,
  year integer not null default extract(year from now()),
  adjustment_days numeric not null default 0,       -- +carryover / -manual deduction
  reason text,
  created_at timestamptz not null default now()
);

-- ── Balance view: entitlement + adjustments − approved days, per emp/type/yr ─
create or replace view public.leave_balances with (security_invoker = true) as
with taken as (
  select org_id, employee_id, leave_type,
         extract(year from start_date)::int as year,
         sum(coalesce(working_days, days, 0)) as used_days
  from public.leave_requests
  where status = 'approved' and employee_id is not null
  group by org_id, employee_id, leave_type, extract(year from start_date)
),
adj as (
  select org_id, employee_id, leave_type, year, sum(adjustment_days) as adj_days
  from public.leave_adjustments
  group by org_id, employee_id, leave_type, year
)
select
  e.org_id,
  e.id as employee_id,
  e.full_name,
  lt.name as leave_type,
  lt.annual_entitlement,
  extract(year from now())::int as year,
  coalesce(a.adj_days, 0) as adjustments,
  coalesce(t.used_days, 0) as used_days,
  (lt.annual_entitlement + coalesce(a.adj_days,0) - coalesce(t.used_days,0)) as remaining_days
from public.employees e
cross join public.leave_types lt
left join taken t on t.employee_id = e.id and t.leave_type = lt.name and t.year = extract(year from now())::int
left join adj   a on a.employee_id = e.id and a.leave_type = lt.name and a.year = extract(year from now())::int
where e.org_id = lt.org_id and lt.active;

-- ── RLS ─────────────────────────────────────────────────────────────────────
do $$
declare t text;
  tbls text[] := array['leave_types','leave_adjustments'];
begin
  foreach t in array tbls loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I on public.%I;', t||'_read', t);
    execute format('create policy %I on public.%I for select using (org_id in (select public.user_org_ids()));', t||'_read', t);
    execute format('drop policy if exists %I on public.%I;', t||'_write', t);
    execute format('create policy %I on public.%I for all using (public.has_org_role(org_id, array[''owner'',''admin'',''manager'',''supervisor''])) with check (org_id in (select public.user_org_ids()));', t||'_write', t);
  end loop;
end $$;

grant select on public.leave_balances to authenticated;

-- ── Seed default leave types for the Pamicor tenant ─────────────────────────
do $$
declare org uuid;
begin
  select id into org from public.organizations where slug = 'pamicor';
  if org is not null then
    insert into public.leave_types (org_id, name, code, annual_entitlement, requires_notice_days, color) values
      (org,'Annual','ANN',20,3,'#F59E0B'),
      (org,'Sick','SIK',10,0,'#F87171'),
      (org,'Compassionate','COM',5,1,'#A78BFA'),
      (org,'Study','STU',5,7,'#60A5FA'),
      (org,'Maternity','MAT',90,14,'#F472B6'),
      (org,'Paternity','PAT',7,7,'#34D399')
    on conflict (org_id, name) do nothing;
  end if;
end $$;
