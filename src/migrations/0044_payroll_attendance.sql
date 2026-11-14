-- ============================================================================
--  WFS Enterprise — 0044 Attendance-driven payroll · Phase 1
--  Adds pay setup to employees + an org payroll policy, and a compute engine
--  that derives each employee's basic for a business month from attendance
--  (roster working days − unpaid absences − unpaid leave), applied per pay type.
--  Overtime is Phase 2. Uses named dollar-quotes ($pr$) to avoid paste issues.
--  Run after 0043.
-- ============================================================================

-- ── 1. Pay setup on the employee ────────────────────────────────────────────
alter table public.employees add column if not exists pay_type text default 'monthly';   -- monthly|daily|hourly
alter table public.employees add column if not exists pay_rate numeric default 0;          -- salary/day/hour rate
alter table public.employees add column if not exists hours_per_day numeric default 8;     -- for hourly
alter table public.employees add column if not exists leave_allowance numeric default 0;   -- flat, paid if >0
alter table public.employees add column if not exists standard_working_days numeric default 26; -- fallback if no roster

-- ── 2. Org payroll policy (how monthly salary responds to attendance) ───────
create table if not exists public.payroll_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  -- monthly_mode: full = always full; prorate_all = deduct absences+unpaid leave;
  --               prorate_unpaid = deduct only unpaid leave (not ordinary absence)
  monthly_mode text not null default 'full' check (monthly_mode in ('full','prorate_all','prorate_unpaid')),
  updated_at timestamptz not null default now()
);
alter table public.payroll_settings enable row level security;

drop policy if exists ps_read on public.payroll_settings;
create policy ps_read on public.payroll_settings for select
  using (org_id in (select public.user_org_ids()));
drop policy if exists ps_write on public.payroll_settings;
create policy ps_write on public.payroll_settings for all
  using (public.can_in_domain(org_id, 'finance', 'edit'))
  with check (public.can_in_domain(org_id, 'finance', 'edit'));

-- ── 3. The attendance → basic compute engine ────────────────────────────────
-- Returns the derived pay basis for one employee in one business-month period.
-- Paid leave types (annual/sick/compassionate/study) count as present; only
-- 'unpaid' leave and recorded shift_absences reduce days worked. Monthly staff
-- follow the org's monthly_mode policy.
create or replace function public.compute_payroll_basis(p_org uuid, p_period text, p_employee uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $pr$
declare
  emp            public.employees%rowtype;
  d_start        date;
  d_end          date;
  std_days       numeric;
  absent_days    numeric := 0;
  unpaid_leave   numeric := 0;
  paid_leave     numeric := 0;
  days_present   numeric;
  basic          numeric := 0;
  mode           text;
  y int; m int;
begin
  if not public.can_in_domain(p_org, 'finance', 'view') then
    raise exception 'Not authorised to view payroll figures';
  end if;

  select * into emp from public.employees where id = p_employee and org_id = p_org;
  if not found then raise exception 'Employee not found'; end if;

  -- business-month date bounds (21st→20th); derive from the period key YYYY-MM
  y := split_part(p_period, '-', 1)::int;
  m := split_part(p_period, '-', 2)::int;
  d_start := make_date(y, m, 1) - interval '1 month' + interval '20 days'; -- prev 21st
  d_end   := make_date(y, m, 20);                                          -- this 20th

  std_days := coalesce(nullif(emp.standard_working_days, 0), 26);

  -- unpaid absences recorded in the window
  select count(*) into absent_days from public.shift_absences
  where org_id = p_org and employee_id = p_employee
    and absence_date between d_start and d_end;

  -- approved leave overlapping the window, split by paid vs unpaid
  select
    coalesce(sum(case when leave_type = 'unpaid' then
      (least(end_date, d_end) - greatest(start_date, d_start) + 1) else 0 end), 0),
    coalesce(sum(case when leave_type <> 'unpaid' then
      (least(end_date, d_end) - greatest(start_date, d_start) + 1) else 0 end), 0)
  into unpaid_leave, paid_leave
  from public.leave_requests
  where org_id = p_org and employee_id = p_employee and status = 'approved'
    and start_date is not null and end_date is not null
    and start_date <= d_end and end_date >= d_start;

  -- days present = standard − absences − unpaid leave (paid leave counts present)
  days_present := greatest(std_days - absent_days - unpaid_leave, 0);

  -- basic per pay type
  if emp.pay_type = 'daily' then
    basic := coalesce(emp.pay_rate,0) * days_present;
  elsif emp.pay_type = 'hourly' then
    basic := coalesce(emp.pay_rate,0) * coalesce(emp.hours_per_day,8) * days_present;
  else
    -- monthly: apply org policy
    select monthly_mode into mode from public.payroll_settings where org_id = p_org;
    mode := coalesce(mode, 'full');
    if mode = 'full' then
      basic := coalesce(emp.pay_rate,0);
    elsif mode = 'prorate_unpaid' then
      basic := coalesce(emp.pay_rate,0) * (greatest(std_days - unpaid_leave,0) / std_days);
    else  -- prorate_all
      basic := coalesce(emp.pay_rate,0) * (days_present / std_days);
    end if;
  end if;

  return jsonb_build_object(
    'pay_type', emp.pay_type,
    'pay_rate', coalesce(emp.pay_rate,0),
    'standard_days', std_days,
    'absent_days', absent_days,
    'unpaid_leave_days', unpaid_leave,
    'paid_leave_days', paid_leave,
    'days_present', days_present,
    'basic', round(basic, 2),
    'leave_allowance', coalesce(emp.leave_allowance, 0),
    'suggested_gross', round(basic + coalesce(emp.leave_allowance,0), 2)
  );
end
$pr$;
grant execute on function public.compute_payroll_basis(uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';
