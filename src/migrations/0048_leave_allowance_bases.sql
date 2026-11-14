-- ============================================================================
--  WFS Enterprise — 0048 Leave allowance → allowance system; new bases
--  Folds the standalone leave_allowance into the recurring-allowances model and
--  adds two bases:
--    per_leave_day  amount × approved paid-leave days in the period
--    annual         amount, paid ONLY in the allowance's pay_month (once a year)
--  Also migrates existing employees.leave_allowance (>0) into a pay_allowances
--  row with basis 'monthly' (preserving current behaviour — flat each period),
--  so no one's pay changes silently. The old column is left in place but unused.
--  Uses named dollar-quote ($al$). Run after 0047.
-- ============================================================================

-- ── 1. Migrate existing standalone leave_allowance into pay_allowances ──────
-- Append a {label:'Leave allowance', amount, basis:'monthly', ...} row for each
-- employee whose leave_allowance > 0 and who doesn't already have such a row.
update public.employees e
set pay_allowances = coalesce(e.pay_allowances, '[]'::jsonb) || jsonb_build_object(
      'label', 'Leave allowance',
      'amount', e.leave_allowance,
      'basis', 'monthly',
      'rr_percent', 0,
      'taxable_percent', 0,
      'pay_month', null
    )
where coalesce(e.leave_allowance, 0) > 0
  and not exists (
    select 1 from jsonb_array_elements(coalesce(e.pay_allowances,'[]'::jsonb)) x
    where lower(x->>'label') = 'leave allowance'
  );

-- Zero out the migrated standalone value so it isn't double-counted anywhere.
update public.employees set leave_allowance = 0 where coalesce(leave_allowance,0) > 0;

-- ── 2. Rebuild compute_allowances with the two new bases ────────────────────
create or replace function public.compute_allowances(p_org uuid, p_period text, p_employee uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $al$
declare
  emp        public.employees%rowtype;
  d_start    date;
  d_end      date;
  y int; m int;
  counts     jsonb;
  wd numeric; rr numeric;
  paid_leave numeric := 0;
  a          jsonb;
  lbl text; amt numeric; basis text; rrp numeric; txp numeric; pay_month int;
  pay numeric; taxable numeric;
  total numeric := 0; total_tax numeric := 0;
  items jsonb := '[]'::jsonb;
begin
  if not public.can_in_domain(p_org, 'finance', 'view') then
    raise exception 'Not authorised to view payroll figures';
  end if;

  select * into emp from public.employees where id = p_employee and org_id = p_org;
  if not found then raise exception 'Employee not found'; end if;

  y := split_part(p_period, '-', 1)::int;
  m := split_part(p_period, '-', 2)::int;
  d_start := make_date(y, m, 1) - interval '1 month' + interval '20 days';
  d_end   := make_date(y, m, 20);

  counts := public.employee_day_counts(p_org, p_employee, d_start, d_end);
  wd := coalesce((counts->>'working_days')::numeric, 0);
  rr := coalesce((counts->>'rr_days')::numeric, 0);

  -- approved PAID leave days overlapping the window (annual/sick/etc; not unpaid)
  select coalesce(sum(
           least(end_date, d_end) - greatest(start_date, d_start) + 1), 0)
  into paid_leave
  from public.leave_requests
  where org_id = p_org and employee_id = p_employee and status = 'approved'
    and leave_type <> 'unpaid'
    and start_date is not null and end_date is not null
    and start_date <= d_end and end_date >= d_start;

  for a in select * from jsonb_array_elements(coalesce(emp.pay_allowances, '[]'::jsonb))
  loop
    lbl   := coalesce(a->>'label', 'Allowance');
    amt   := coalesce((a->>'amount')::numeric, 0);
    basis := coalesce(a->>'basis', 'monthly');
    rrp   := coalesce((a->>'rr_percent')::numeric, 0);
    txp   := coalesce((a->>'taxable_percent')::numeric, 0);
    pay_month := nullif(a->>'pay_month','')::int;

    if basis = 'daily' then
      pay := amt * wd + amt * rr * (rrp / 100.0);
    elsif basis = 'per_leave_day' then
      pay := amt * paid_leave;
    elsif basis = 'annual' then
      -- paid only in the nominated month; if no month set, not paid (avoids
      -- accidentally paying a yearly lump every period).
      if pay_month is not null and pay_month = m then pay := amt; else pay := 0; end if;
    else
      pay := amt;                       -- monthly flat
    end if;

    taxable := pay * (txp / 100.0);
    total := total + pay;
    total_tax := total_tax + taxable;

    items := items || jsonb_build_object(
      'label', lbl, 'basis', basis, 'amount', amt,
      'pay', round(pay, 2), 'taxable', round(taxable, 2));
  end loop;

  return jsonb_build_object(
    'working_days', wd, 'rr_days', rr, 'paid_leave_days', paid_leave,
    'total_allowances', round(total, 2),
    'taxable_allowances', round(total_tax, 2),
    'breakdown', items
  );
end
$al$;
grant execute on function public.compute_allowances(uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';
