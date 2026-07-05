-- ============================================================================
--  WFS Enterprise — 0015 Safety Interactions (CCV / PTO / Take 5)
--  Periodic safety observations with per-role monthly targets, KPI tracking,
--  photo uploads, CCV action assignment + close-out email. Run after 0014.
-- ============================================================================

-- ── Safety interaction records (all three form types in one table) ──────────
create table if not exists public.safety_interactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  form_type text not null,              -- ccv | pto | take5
  ref_no text,
  -- who did the observation
  observer_id uuid references public.employees(id) on delete set null,
  observer_name text,
  observer_role text,                   -- role at time (drives KPI target)
  department text,
  location text,
  observed_on date not null default current_date,
  -- shared content
  title text,
  details text,
  -- CCV specifics
  critical_control text,
  control_effective boolean,            -- was the control in place & effective?
  -- Take 5 checklist (Stop, Look, Assess, Manage)
  t5_stop boolean, t5_look boolean, t5_assess boolean, t5_manage boolean,
  -- PTO specifics
  task_observed text,
  safe_behaviours int default 0,
  at_risk_behaviours int default 0,
  -- CCV action assignment
  action_required boolean default false,
  action_description text,
  assigned_to_id uuid references public.employees(id) on delete set null,
  assigned_to_name text,
  assigned_to_email text,
  action_due date,
  action_status text default 'open',    -- open | closed
  action_closed_at timestamptz,
  action_close_note text,
  -- media
  photo_urls jsonb default '[]'::jsonb, -- array of signed URLs
  notified boolean default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists si_org_idx on public.safety_interactions(org_id, observed_on desc);
create index if not exists si_type_idx on public.safety_interactions(org_id, form_type);

-- ── Per-role monthly targets (by form type) ─────────────────────────────────
create table if not exists public.safety_targets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  role text not null,                   -- matches org_members/employee role or job grouping
  form_type text not null,              -- ccv | pto | take5
  monthly_target int not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists st_uidx on public.safety_targets(org_id, role, form_type);

-- ── KPI view: this month's completions per observer per form type ───────────
create or replace view public.safety_kpi with (security_invoker = true) as
select
  s.org_id, s.observer_id, s.observer_name, s.observer_role, s.form_type,
  to_char(now(), 'YYYY-MM') as period,
  count(*) filter (where to_char(s.observed_on,'YYYY-MM') = to_char(now(),'YYYY-MM')) as done_this_month
from public.safety_interactions s
where s.observer_name is not null
group by s.org_id, s.observer_id, s.observer_name, s.observer_role, s.form_type;

-- ── Photo storage bucket (private, tenant-scoped) ───────────────────────────
insert into storage.buckets (id, name, public)
values ('safety-files', 'safety-files', false)
on conflict (id) do nothing;

drop policy if exists safety_files_read on storage.objects;
create policy safety_files_read on storage.objects
  for select using (bucket_id = 'safety-files' and (storage.foldername(name))[1]::uuid in (select public.user_org_ids()));
drop policy if exists safety_files_write on storage.objects;
create policy safety_files_write on storage.objects
  for insert with check (bucket_id = 'safety-files' and (storage.foldername(name))[1]::uuid in (select public.user_org_ids()));
drop policy if exists safety_files_delete on storage.objects;
create policy safety_files_delete on storage.objects
  for delete using (bucket_id = 'safety-files' and (storage.foldername(name))[1]::uuid in (select public.user_org_ids()));

-- ── RLS ─────────────────────────────────────────────────────────────────────
do $$
declare t text;
  tbls text[] := array['safety_interactions','safety_targets'];
begin
  foreach t in array tbls loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I on public.%I;', t||'_read', t);
    execute format('create policy %I on public.%I for select using (org_id in (select public.user_org_ids()));', t||'_read', t);
    execute format('drop policy if exists %I on public.%I;', t||'_write', t);
    execute format('create policy %I on public.%I for all using (public.has_org_role(org_id, array[''owner'',''admin'',''manager'',''supervisor'',''operator''])) with check (org_id in (select public.user_org_ids()));', t||'_write', t);
  end loop;
end $$;

grant select on public.safety_kpi to authenticated;

-- ── Seed sample role targets for Pamicor ────────────────────────────────────
do $$
declare org uuid;
begin
  select id into org from public.organizations where slug = 'pamicor';
  if org is not null then
    insert into public.safety_targets(org_id, role, form_type, monthly_target) values
      (org,'supervisor','ccv',5),(org,'supervisor','pto',4),(org,'supervisor','take5',20),
      (org,'manager','ccv',3),(org,'manager','pto',2),(org,'manager','take5',10),
      (org,'operator','ccv',1),(org,'operator','pto',1),(org,'operator','take5',20)
    on conflict (org_id, role, form_type) do nothing;
  end if;
end $$;

notify pgrst, 'reload schema';
