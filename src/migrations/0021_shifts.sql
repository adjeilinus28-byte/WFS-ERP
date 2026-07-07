-- ============================================================================
--  WFS Enterprise — 0021 Shift System & Callouts
--  Recurring shift patterns (day/night/off cycles) + manual per-date overrides,
--  set by supervisors. Off days feed Leave (working-day calc) and Catering
--  (no meals unless an approved callout). Run after 0020.
-- ============================================================================

-- ── Shift patterns: a repeating cycle, e.g. ["day","day","night","night","off","off"] ──
create table if not exists public.shift_patterns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  cycle jsonb not null default '["day","day","day","day","day","off","off"]'::jsonb,
  anchor_date date not null default current_date,  -- cycle position 0 on this date
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists sp_org_idx on public.shift_patterns(org_id);

-- ── Assignment: which employee follows which pattern, from when ─────────────
create table if not exists public.employee_shift_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  pattern_id uuid not null references public.shift_patterns(id) on delete cascade,
  effective_from date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists esa_emp_idx on public.employee_shift_assignments(employee_id, effective_from desc);

-- ── Manual overrides: specific dates that differ from the pattern ────────────
create table if not exists public.shift_overrides (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  shift_date date not null,
  shift text not null,                   -- day | night | off
  reason text,
  created_at timestamptz not null default now()
);
create unique index if not exists so_uidx on public.shift_overrides(employee_id, shift_date);

-- ── Callout requests: meal on an off day, needs supervisor approval ──────────
create table if not exists public.callout_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  employee_name text,
  department text,
  service_date date not null,
  reason text,
  status text not null default 'pending', -- pending | approved | declined
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists cr_uidx on public.callout_requests(employee_id, service_date);
create index if not exists cr_org_idx on public.callout_requests(org_id, service_date);

-- ── RLS ─────────────────────────────────────────────────────────────────────
do $$
declare t text;
  tbls text[] := array['shift_patterns','employee_shift_assignments','shift_overrides'];
begin
  foreach t in array tbls loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I on public.%I;', t||'_read', t);
    execute format('create policy %I on public.%I for select using (org_id in (select public.user_org_ids()));', t||'_read', t);
    execute format('drop policy if exists %I on public.%I;', t||'_write', t);
    execute format('create policy %I on public.%I for all using (public.has_org_role(org_id, array[''owner'',''admin'',''manager'',''supervisor''])) with check (org_id in (select public.user_org_ids()));', t||'_write', t);
  end loop;
end $$;

alter table public.callout_requests enable row level security;
drop policy if exists cr_read on public.callout_requests;
create policy cr_read on public.callout_requests for select using (org_id in (select public.user_org_ids()));
drop policy if exists cr_insert on public.callout_requests;
create policy cr_insert on public.callout_requests for insert with check (org_id in (select public.user_org_ids()));
drop policy if exists cr_update on public.callout_requests;
create policy cr_update on public.callout_requests for update
  using (public.has_org_role(org_id, array['owner','admin','manager','supervisor']));

-- ── Seed sample patterns for Pamicor ────────────────────────────────────────
do $$
declare org uuid;
begin
  select id into org from public.organizations where slug = 'pamicor';
  if org is not null then
    insert into public.shift_patterns (org_id, name, cycle, anchor_date) values
      (org, '5-2 Days',        '["day","day","day","day","day","off","off"]'::jsonb, date_trunc('week', current_date)::date),
      (org, '4x4 Day/Night',   '["day","day","day","day","off","off","off","off","night","night","night","night","off","off","off","off"]'::jsonb, date_trunc('week', current_date)::date),
      (org, '7-7 Rotation',    '["day","day","day","day","day","day","day","off","off","off","off","off","off","off"]'::jsonb, date_trunc('week', current_date)::date)
    on conflict do nothing;
  end if;
end $$;

notify pgrst, 'reload schema';
