-- ============================================================================
--  WFS Enterprise — 0045 Overtime request → approval → pay · Phase 2
--  Overtime is logged as a request, routed through Approvals, and only APPROVED
--  hours feed payroll. Org chooses how overtime pay is calculated:
--    multiplier (e.g. 1.5× the employee's normal hourly-equivalent), or
--    fixed rate per hour.
--  Adds overtime policy to payroll_settings, an overtime_entries table (dept
--  scoped + RBAC via people domain for logging, approvals domain to decide),
--  and a helper to total approved overtime pay for a period.
--  Uses named dollar-quotes ($ot$). Run after 0044.
-- ============================================================================

-- ── 1. Overtime policy on the org ───────────────────────────────────────────
alter table public.payroll_settings add column if not exists ot_method text default 'multiplier'
  check (ot_method in ('multiplier','fixed'));
alter table public.payroll_settings add column if not exists ot_multiplier numeric default 1.5;
alter table public.payroll_settings add column if not exists ot_fixed_rate numeric default 0;

-- ── 2. Overtime entries ─────────────────────────────────────────────────────
create table if not exists public.overtime_entries (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  employee_id  uuid references public.employees(id) on delete set null,
  employee_name text,
  department   text,
  work_date    date not null,
  hours        numeric not null check (hours > 0),
  reason       text,
  status       text not null default 'pending' check (status in ('pending','approved','declined')),
  period       text,                         -- business-month key YYYY-MM (for payroll pickup)
  created_by   uuid default auth.uid(),
  decided_by   uuid,
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);
alter table public.overtime_entries enable row level security;

-- READ: tenant + department visibility (same dept model as other tables).
drop policy if exists ot_read on public.overtime_entries;
create policy ot_read on public.overtime_entries for select
  using (org_id in (select public.user_org_ids()) and public.can_see_dept(org_id, department));

-- INSERT: logging overtime needs people:edit (a supervisor logs it for staff),
-- plus department write scope.
drop policy if exists ot_insert on public.overtime_entries;
create policy ot_insert on public.overtime_entries for insert
  with check (public.can_in_domain(org_id, 'people', 'edit') and public.can_edit_dept(org_id, department));

-- UPDATE: approving/declining needs approvals:manage (the decision), OR people:edit
-- to amend a still-pending entry; department write scope applies.
drop policy if exists ot_update on public.overtime_entries;
create policy ot_update on public.overtime_entries for update
  using (
    (public.can_in_domain(org_id, 'approvals', 'manage') or public.can_in_domain(org_id, 'people', 'edit'))
    and public.can_edit_dept(org_id, department)
  )
  with check (
    (public.can_in_domain(org_id, 'approvals', 'manage') or public.can_in_domain(org_id, 'people', 'edit'))
    and public.can_edit_dept(org_id, department)
  );

-- DELETE: people:edit + dept scope (remove a mistaken pending entry).
drop policy if exists ot_delete on public.overtime_entries;
create policy ot_delete on public.overtime_entries for delete
  using (public.can_in_domain(org_id, 'people', 'edit') and public.can_edit_dept(org_id, department));

create index if not exists overtime_entries_lookup
  on public.overtime_entries (org_id, employee_id, period, status);

-- ── 3. Approved overtime pay for an employee in a period ────────────────────
-- Resolves the org's overtime method: multiplier × normal hourly-equivalent, or
-- a fixed per-hour rate. Normal hourly-equivalent derives from the employee's
-- pay setup (monthly → rate / (std_days × hours_per_day); daily → rate /
-- hours_per_day; hourly → rate). Finance-gated (it exposes pay).
create or replace function public.compute_overtime_pay(p_org uuid, p_period text, p_employee uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $ot$
declare
  emp public.employees%rowtype;
  ps  public.payroll_settings%rowtype;
  ot_hours numeric := 0;
  hourly_equiv numeric := 0;
  rate numeric := 0;
  pay numeric := 0;
  hpd numeric;
  std numeric;
begin
  if not public.can_in_domain(p_org, 'finance', 'view') then
    raise exception 'Not authorised to view payroll figures';
  end if;

  select * into emp from public.employees where id = p_employee and org_id = p_org;
  if not found then raise exception 'Employee not found'; end if;

  select coalesce(sum(hours),0) into ot_hours from public.overtime_entries
  where org_id = p_org and employee_id = p_employee and period = p_period and status = 'approved';

  select * into ps from public.payroll_settings where org_id = p_org;

  hpd := coalesce(nullif(emp.hours_per_day,0), 8);
  std := coalesce(nullif(emp.standard_working_days,0), 26);

  -- normal hourly-equivalent
  if emp.pay_type = 'hourly' then
    hourly_equiv := coalesce(emp.pay_rate,0);
  elsif emp.pay_type = 'daily' then
    hourly_equiv := coalesce(emp.pay_rate,0) / hpd;
  else -- monthly
    hourly_equiv := coalesce(emp.pay_rate,0) / (std * hpd);
  end if;

  if coalesce(ps.ot_method,'multiplier') = 'fixed' then
    rate := coalesce(ps.ot_fixed_rate,0);
  else
    rate := hourly_equiv * coalesce(ps.ot_multiplier,1.5);
  end if;

  pay := ot_hours * rate;

  return jsonb_build_object(
    'approved_hours', ot_hours,
    'method', coalesce(ps.ot_method,'multiplier'),
    'rate_per_hour', round(rate, 4),
    'overtime_pay', round(pay, 2)
  );
end
$ot$;
grant execute on function public.compute_overtime_pay(uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';
