-- ============================================================================
--  WFS Enterprise — 0051 Fix: resolve the shift pattern PER DAY
--  BUG: employee_day_counts / roster_working_days picked ONE pattern (the latest
--  assignment effective by the END of the pay window) and applied it to every day
--  of the window. If an employee switched patterns mid-period, the whole period
--  was computed with the new pattern — disagreeing with the roster screen, which
--  correctly resolves per date, and producing wrong working/R&R day counts.
--  FIX: resolve the assignment effective AS OF EACH DAY inside the loop, exactly
--  mirroring the client's buildShiftContext(). Run after 0050.
-- ============================================================================

create or replace function public.employee_day_counts(p_org uuid, p_employee uuid, p_start date, p_end date)
returns jsonb language plpgsql stable security definer set search_path = public as $dc$
declare
  pat public.shift_patterns%rowtype;
  cyc jsonb; cyc_len int; d date; pos int; kind text; ov text;
  working int := 0; rr int := 0; any_roster boolean := false;
begin
  if p_start is null or p_end is null or p_end < p_start then
    return jsonb_build_object('working_days', 0, 'rr_days', 0, 'has_roster', false);
  end if;

  select exists (
    select 1 from public.employee_shift_assignments a
    where a.org_id = p_org and a.employee_id = p_employee and a.effective_from <= p_end
  ) into any_roster;

  if not any_roster then
    return jsonb_build_object('working_days', 0, 'rr_days', 0, 'has_roster', false);
  end if;

  d := p_start;
  while d <= p_end loop
    -- the assignment in force ON THIS DAY (newest effective_from on/before d)
    select p.* into pat
    from public.employee_shift_assignments a
    join public.shift_patterns p on p.id = a.pattern_id
    where a.org_id = p_org and a.employee_id = p_employee and a.effective_from <= d
    order by a.effective_from desc limit 1;

    if found then
      cyc := pat.cycle; cyc_len := jsonb_array_length(cyc);
      if cyc_len is not null and cyc_len > 0 then
        pos := ((d - pat.anchor_date) % cyc_len + cyc_len) % cyc_len;
        kind := trim(both '"' from (cyc -> pos)::text);

        select shift into ov from public.shift_overrides
        where org_id = p_org and employee_id = p_employee and shift_date = d;
        if ov is not null then kind := ov; end if;

        if kind in ('day','night') then
          if not exists (select 1 from public.shift_absences
                         where org_id = p_org and employee_id = p_employee and absence_date = d) then
            working := working + 1;
          end if;
        elsif kind = 'off' then
          rr := rr + 1;
        end if;
      end if;
    end if;
    -- days before the employee's first assignment resolve to neither working nor
    -- R&R (we can't know their roster then) — they simply don't count.
    d := d + 1;
  end loop;

  return jsonb_build_object('working_days', working, 'rr_days', rr, 'has_roster', true);
end
$dc$;
grant execute on function public.employee_day_counts(uuid, uuid, date, date) to authenticated;

create or replace function public.roster_working_days(p_org uuid, p_employee uuid, p_start date, p_end date)
returns int language plpgsql stable security definer set search_path = public as $rw$
declare
  pat public.shift_patterns%rowtype;
  cyc jsonb; cyc_len int; d date; pos int; kind text; ov text;
  wd int := 0; any_roster boolean := false;
begin
  if p_start is null or p_end is null or p_end < p_start then return 0; end if;

  select exists (
    select 1 from public.employee_shift_assignments a
    where a.org_id = p_org and a.employee_id = p_employee and a.effective_from <= p_end
  ) into any_roster;

  -- No roster at all: fall back to calendar days so leave still counts sensibly.
  if not any_roster then return (p_end - p_start) + 1; end if;

  d := p_start;
  while d <= p_end loop
    select p.* into pat
    from public.employee_shift_assignments a
    join public.shift_patterns p on p.id = a.pattern_id
    where a.org_id = p_org and a.employee_id = p_employee and a.effective_from <= d
    order by a.effective_from desc limit 1;

    if found then
      cyc := pat.cycle; cyc_len := jsonb_array_length(cyc);
      if cyc_len is null or cyc_len = 0 then
        wd := wd + 1;                       -- malformed pattern: count the day
      else
        pos := ((d - pat.anchor_date) % cyc_len + cyc_len) % cyc_len;
        kind := trim(both '"' from (cyc -> pos)::text);
        select shift into ov from public.shift_overrides
        where org_id = p_org and employee_id = p_employee and shift_date = d;
        if ov is not null then kind := ov; end if;
        if kind in ('day','night') then wd := wd + 1; end if;
      end if;
    else
      wd := wd + 1;   -- before their first assignment: count the day (best effort)
    end if;
    d := d + 1;
  end loop;
  return wd;
end
$rw$;
grant execute on function public.roster_working_days(uuid, uuid, date, date) to authenticated;

notify pgrst, 'reload schema';
