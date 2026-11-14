-- ============================================================================
--  WFS Enterprise — 0047 Allowance rules: daily/attendance-tied, R&R %, taxable %
--  Each allowance in employees.pay_allowances may now carry:
--    basis            'monthly' (flat) | 'daily' (× working days; R&R at rr_percent)
--    rr_percent       % of the daily allowance paid on R&R (scheduled off) days
--    taxable_percent  % of the allowance that is taxable (feeds chargeable income)
--  R&R days are the OFF days in the employee's shift roster (cycle + overrides),
--  NOT a leave type. Adds a roster day-count helper and an allowance compute fn.
--  Backward compatible: rows without these keys behave as flat, tax-free monthly.
--  Uses named dollar-quotes ($dc$, $al$). Run after 0046.
-- ============================================================================

-- Persist the taxable slice of recurring allowances on each payslip so a saved
-- slip's PAYE stays stable on reload/recompute.
alter table public.payroll add column if not exists taxable_allowances numeric default 0;

-- ── Roster day counts for an employee over a window ─────────────────────────
-- Resolves each calendar day to working ('day'/'night') or R&R ('off') using the
-- employee's active pattern (cycle + anchor), applying shift_overrides, and
-- removing recorded absences from working days.
create or replace function public.employee_day_counts(p_org uuid, p_employee uuid, p_start date, p_end date)
returns jsonb language plpgsql stable security definer set search_path = public as $dc$
declare
  pat        public.shift_patterns%rowtype;
  assign_id  uuid;
  cyc        jsonb;
  cyc_len    int;
  d          date;
  pos        int;
  kind       text;
  ov         text;
  working    int := 0;
  rr         int := 0;
begin
  -- the employee's current pattern (latest assignment effective on/before window end)
  select a.pattern_id into assign_id
  from public.employee_shift_assignments a
  where a.org_id = p_org and a.employee_id = p_employee and a.effective_from <= p_end
  order by a.effective_from desc limit 1;

  if assign_id is null then
    return jsonb_build_object('working_days', 0, 'rr_days', 0, 'has_roster', false);
  end if;

  select * into pat from public.shift_patterns where id = assign_id;
  cyc := pat.cycle;
  cyc_len := jsonb_array_length(cyc);
  if cyc_len is null or cyc_len = 0 then
    return jsonb_build_object('working_days', 0, 'rr_days', 0, 'has_roster', false);
  end if;

  d := p_start;
  while d <= p_end loop
    -- cycle position (handle negative modulo)
    pos := ((d - pat.anchor_date) % cyc_len + cyc_len) % cyc_len;
    kind := trim(both '"' from (cyc -> pos)::text);

    -- override for this specific date, if any
    select shift into ov from public.shift_overrides
    where org_id = p_org and employee_id = p_employee and shift_date = d;
    if ov is not null then kind := ov; end if;

    if kind in ('day','night') then
      -- remove absences from working days
      if not exists (select 1 from public.shift_absences
                     where org_id = p_org and employee_id = p_employee and absence_date = d) then
        working := working + 1;
      end if;
    elsif kind = 'off' then
      rr := rr + 1;
    end if;

    d := d + 1;
  end loop;

  return jsonb_build_object('working_days', working, 'rr_days', rr, 'has_roster', true);
end
$dc$;
grant execute on function public.employee_day_counts(uuid, uuid, date, date) to authenticated;

-- ── Compute allowances for an employee in a period ──────────────────────────
-- Applies each allowance's basis (monthly flat vs daily×days, R&R at rr_percent)
-- and taxable_percent. Finance-gated (exposes pay). Returns totals + breakdown.
create or replace function public.compute_allowances(p_org uuid, p_period text, p_employee uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $al$
declare
  emp        public.employees%rowtype;
  d_start    date;
  d_end      date;
  y int; m int;
  counts     jsonb;
  wd numeric; rr numeric;
  a          jsonb;
  lbl text; amt numeric; basis text; rrp numeric; txp numeric;
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

  for a in select * from jsonb_array_elements(coalesce(emp.pay_allowances, '[]'::jsonb))
  loop
    lbl   := coalesce(a->>'label', 'Allowance');
    amt   := coalesce((a->>'amount')::numeric, 0);
    basis := coalesce(a->>'basis', 'monthly');
    rrp   := coalesce((a->>'rr_percent')::numeric, 0);
    txp   := coalesce((a->>'taxable_percent')::numeric, 0);

    if basis = 'daily' then
      pay := amt * wd + amt * rr * (rrp / 100.0);
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
    'working_days', wd, 'rr_days', rr,
    'total_allowances', round(total, 2),
    'taxable_allowances', round(total_tax, 2),
    'breakdown', items
  );
end
$al$;
grant execute on function public.compute_allowances(uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';
