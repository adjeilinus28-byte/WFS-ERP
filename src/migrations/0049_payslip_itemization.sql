-- ============================================================================
--  WFS Enterprise — 0049 Payslip itemization (Phase 3)
--  Persists the per-allowance breakdown and overtime hours on each payslip so
--  the generated payslip can show each allowance and overtime as its own line
--  item, instead of one combined "Other allowances" figure.
--  Run after 0048.
-- ============================================================================

-- Per-allowance breakdown at time of payslip: [{label, basis, pay, taxable}]
alter table public.payroll add column if not exists pay_allowances_detail jsonb default '[]'::jsonb;
-- Overtime hours + rate captured for the payslip line (pay already in weekday_overtime)
alter table public.payroll add column if not exists overtime_hours numeric default 0;
alter table public.payroll add column if not exists overtime_rate  numeric default 0;

notify pgrst, 'reload schema';

-- ============================================================================
--  Working-day leave alignment (Phase 3, item 2)
--  Leave days now count only WORKING (on-shift) days within each approved leave
--  span, per the employee's shift roster — not calendar days and not a fixed
--  Mon–Fri. A leave that falls on scheduled off-days doesn't over-count.
-- ============================================================================

-- Count on-shift days ('day'/'night' in the cycle, honouring overrides) in a span.
-- Unlike employee_day_counts, this does NOT subtract absences (a person on leave
-- is not "absent"), so it's the correct basis for counting leave working-days.
create or replace function public.roster_working_days(p_org uuid, p_employee uuid, p_start date, p_end date)
returns int language plpgsql stable security definer set search_path = public as $rw$
declare
  assign_id uuid; pat public.shift_patterns%rowtype;
  cyc jsonb; cyc_len int; d date; pos int; kind text; ov text; wd int := 0;
begin
  if p_start is null or p_end is null or p_end < p_start then return 0; end if;

  select a.pattern_id into assign_id
  from public.employee_shift_assignments a
  where a.org_id = p_org and a.employee_id = p_employee and a.effective_from <= p_end
  order by a.effective_from desc limit 1;
  if assign_id is null then
    -- no roster: fall back to counting all calendar days (best effort)
    return (p_end - p_start) + 1;
  end if;

  select * into pat from public.shift_patterns where id = assign_id;
  cyc := pat.cycle; cyc_len := jsonb_array_length(cyc);
  if cyc_len is null or cyc_len = 0 then return (p_end - p_start) + 1; end if;

  d := p_start;
  while d <= p_end loop
    pos := ((d - pat.anchor_date) % cyc_len + cyc_len) % cyc_len;
    kind := trim(both '"' from (cyc -> pos)::text);
    select shift into ov from public.shift_overrides
    where org_id = p_org and employee_id = p_employee and shift_date = d;
    if ov is not null then kind := ov; end if;
    if kind in ('day','night') then wd := wd + 1; end if;
    d := d + 1;
  end loop;
  return wd;
end
$rw$;
grant execute on function public.roster_working_days(uuid, uuid, date, date) to authenticated;

-- Rebuild compute_payroll_basis: leave counts = working days within each leave span.
create or replace function public.compute_payroll_basis(p_org uuid, p_period text, p_employee uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $pr$
declare
  emp public.employees%rowtype;
  d_start date; d_end date; std_days numeric;
  absent_days numeric := 0; unpaid_leave numeric := 0; paid_leave numeric := 0;
  days_present numeric; basic numeric := 0; mode text; y int; m int;
  lr record;
begin
  if not public.can_in_domain(p_org, 'finance', 'view') then
    raise exception 'Not authorised to view payroll figures';
  end if;
  select * into emp from public.employees where id = p_employee and org_id = p_org;
  if not found then raise exception 'Employee not found'; end if;

  y := split_part(p_period, '-', 1)::int; m := split_part(p_period, '-', 2)::int;
  d_start := make_date(y, m, 1) - interval '1 month' + interval '20 days';
  d_end   := make_date(y, m, 20);
  std_days := coalesce(nullif(emp.standard_working_days, 0), 26);

  select count(*) into absent_days from public.shift_absences
  where org_id = p_org and employee_id = p_employee and absence_date between d_start and d_end;

  -- leave: sum WORKING days within each approved leave span (clamped to window)
  for lr in
    select leave_type, greatest(start_date, d_start) as s, least(end_date, d_end) as e
    from public.leave_requests
    where org_id = p_org and employee_id = p_employee and status = 'approved'
      and start_date is not null and end_date is not null
      and start_date <= d_end and end_date >= d_start
  loop
    if lr.leave_type = 'unpaid' then
      unpaid_leave := unpaid_leave + public.roster_working_days(p_org, p_employee, lr.s, lr.e);
    else
      paid_leave := paid_leave + public.roster_working_days(p_org, p_employee, lr.s, lr.e);
    end if;
  end loop;

  days_present := greatest(std_days - absent_days - unpaid_leave, 0);

  if emp.pay_type = 'daily' then
    basic := coalesce(emp.pay_rate,0) * days_present;
  elsif emp.pay_type = 'hourly' then
    basic := coalesce(emp.pay_rate,0) * coalesce(emp.hours_per_day,8) * days_present;
  else
    select monthly_mode into mode from public.payroll_settings where org_id = p_org;
    mode := coalesce(mode, 'full');
    if mode = 'full' then basic := coalesce(emp.pay_rate,0);
    elsif mode = 'prorate_unpaid' then basic := coalesce(emp.pay_rate,0) * (greatest(std_days - unpaid_leave,0) / std_days);
    else basic := coalesce(emp.pay_rate,0) * (days_present / std_days); end if;
  end if;

  return jsonb_build_object(
    'pay_type', emp.pay_type, 'pay_rate', coalesce(emp.pay_rate,0), 'standard_days', std_days,
    'absent_days', absent_days, 'unpaid_leave_days', unpaid_leave, 'paid_leave_days', paid_leave,
    'days_present', days_present, 'basic', round(basic, 2),
    'leave_allowance', 0,
    'suggested_gross', round(basic, 2));
end
$pr$;
grant execute on function public.compute_payroll_basis(uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';

-- Rebuild compute_allowances so per_leave_day uses WORKING-day leave counts too.
create or replace function public.compute_allowances(p_org uuid, p_period text, p_employee uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $al$
declare
  emp public.employees%rowtype;
  d_start date; d_end date; y int; m int;
  counts jsonb; wd numeric; rr numeric; paid_leave numeric := 0;
  a jsonb; lbl text; amt numeric; basis text; rrp numeric; txp numeric; pay_month int;
  pay numeric; taxable numeric; total numeric := 0; total_tax numeric := 0;
  items jsonb := '[]'::jsonb; lr record;
begin
  if not public.can_in_domain(p_org, 'finance', 'view') then
    raise exception 'Not authorised to view payroll figures';
  end if;
  select * into emp from public.employees where id = p_employee and org_id = p_org;
  if not found then raise exception 'Employee not found'; end if;

  y := split_part(p_period, '-', 1)::int; m := split_part(p_period, '-', 2)::int;
  d_start := make_date(y, m, 1) - interval '1 month' + interval '20 days';
  d_end   := make_date(y, m, 20);

  counts := public.employee_day_counts(p_org, p_employee, d_start, d_end);
  wd := coalesce((counts->>'working_days')::numeric, 0);
  rr := coalesce((counts->>'rr_days')::numeric, 0);

  -- paid leave = working days within each approved (non-unpaid) leave span
  for lr in
    select greatest(start_date, d_start) as s, least(end_date, d_end) as e
    from public.leave_requests
    where org_id = p_org and employee_id = p_employee and status = 'approved'
      and leave_type <> 'unpaid' and start_date is not null and end_date is not null
      and start_date <= d_end and end_date >= d_start
  loop
    paid_leave := paid_leave + public.roster_working_days(p_org, p_employee, lr.s, lr.e);
  end loop;

  for a in select * from jsonb_array_elements(coalesce(emp.pay_allowances, '[]'::jsonb))
  loop
    lbl := coalesce(a->>'label','Allowance'); amt := coalesce((a->>'amount')::numeric,0);
    basis := coalesce(a->>'basis','monthly'); rrp := coalesce((a->>'rr_percent')::numeric,0);
    txp := coalesce((a->>'taxable_percent')::numeric,0); pay_month := nullif(a->>'pay_month','')::int;

    if basis = 'daily' then pay := amt * wd + amt * rr * (rrp / 100.0);
    elsif basis = 'per_leave_day' then pay := amt * paid_leave;
    elsif basis = 'annual' then
      if pay_month is not null and pay_month = m then pay := amt; else pay := 0; end if;
    else pay := amt; end if;

    taxable := pay * (txp / 100.0);
    total := total + pay; total_tax := total_tax + taxable;
    items := items || jsonb_build_object('label', lbl, 'basis', basis, 'amount', amt,
      'pay', round(pay, 2), 'taxable', round(taxable, 2));
  end loop;

  return jsonb_build_object('working_days', wd, 'rr_days', rr, 'paid_leave_days', paid_leave,
    'total_allowances', round(total, 2), 'taxable_allowances', round(total_tax, 2), 'breakdown', items);
end
$al$;
grant execute on function public.compute_allowances(uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';
