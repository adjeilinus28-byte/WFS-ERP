-- ============================================================================
--  WFS Enterprise — 0057 Approval hardening
--  Follow-ups to 0056 from security review. Idempotent. Run after 0056.
--
--  1. Server-stamped creator: for any signed-in user, created_by is set to the
--     caller on insert and can never be changed (purchase_requests,
--     overtime_entries, journal_entries). Closes a bypass where a user stamped
--     someone else as creator and then approved their own request.
--  2. Journals of every source type can only become posted through
--     post_journal_entry(); source_type can't be changed after insert.
--  3. A material change to an approved request (amount, dates, hours) sends it
--     back to pending for a fresh decision.
--  4. Leave auto-approval measures the full date range (not only the days
--     figure typed into the request), so a long leave can't slip through.
--  Service-role jobs (auth.uid() is null) are not affected.
-- ============================================================================

-- 1 ─ creator stamp
create or replace function public.stamp_creator()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  elsif new.created_by is distinct from old.created_by then
    raise exception 'The creator of a record cannot be changed.' using errcode = '42501';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['purchase_requests','overtime_entries','journal_entries'] loop
    execute format('drop trigger if exists trg_stamp_creator on public.%I;', t);
    -- "a_" prefix so it runs before the other BEFORE triggers (alphabetical order)
    execute format('drop trigger if exists a_trg_stamp_creator on public.%I;', t);
    execute format('create trigger a_trg_stamp_creator before insert or update on public.%I for each row execute function public.stamp_creator();', t);
  end loop;
end $$;

-- 2 ─ posting only through post_journal_entry(), for every source type
create or replace function public.guard_journal_posting()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or coalesce(current_setting('wfs.posting', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    new.posted := false; new.posted_at := null;
    return new;
  end if;
  if new.source_type is distinct from old.source_type then
    raise exception 'The source of a journal cannot be changed.' using errcode = '42501';
  end if;
  if new.posted and not coalesce(old.posted, false) then
    raise exception 'Journals are posted through Approvals or the ledger sync.' using errcode = '42501';
  end if;
  return new;
end $$;

-- 3 ─ decision guard + re-approval on material change
create or replace function public.guard_decision()
returns trigger language plpgsql security definer set search_path = public as $$
declare t text; requester boolean := false; changed boolean := false;
begin
  if coalesce(current_setting('wfs.auto_approve', true), '') = 'on' then return new; end if;

  -- An approved request edited in a way that matters goes back for a new decision.
  if auth.uid() is not null and old.status = 'approved' and new.status = 'approved' then
    if tg_table_name = 'purchase_requests' then
      changed := new.est_total is distinct from old.est_total;
    elsif tg_table_name = 'leave_requests' then
      changed := (new.start_date, new.end_date, new.days, new.working_days, new.employee_id)
                 is distinct from (old.start_date, old.end_date, old.days, old.working_days, old.employee_id);
    elsif tg_table_name = 'overtime_entries' then
      changed := (new.hours, new.work_date, new.employee_id) is distinct from (old.hours, old.work_date, old.employee_id);
    end if;
    if changed then
      new.status := 'pending'; new.decided_at := null; new.decided_by := null;
      return new;
    end if;
  end if;

  if new.status is not distinct from old.status or new.status not in ('approved','declined') then return new; end if;
  if tg_table_name = 'leave_requests' then
    t := 'leave';
    requester := old.employee_id is not null and old.employee_id in (select public.my_employee_ids(old.org_id));
  elsif tg_table_name = 'purchase_requests' then
    t := 'purchase_request';
    requester := old.created_by is not null and old.created_by = auth.uid();
  elsif tg_table_name = 'overtime_entries' then
    t := 'overtime';
    requester := (old.created_by is not null and old.created_by = auth.uid())
              or (old.employee_id is not null and old.employee_id in (select public.my_employee_ids(old.org_id)));
  else
    return new;
  end if;
  perform public.check_approval(old.org_id, t, requester, new.status = 'approved');
  return new;
end $$;

-- 4 ─ auto-approve: leave measured by its full date range
create or replace function public.auto_approve_small()
returns trigger language plpgsql security definer set search_path = public as $$
declare t text; amt numeric; unit text; r record;
begin
  if new.status is distinct from 'pending' then return null; end if;
  if tg_table_name = 'leave_requests' then
    t := 'leave'; unit := 'days';
    amt := greatest(coalesce(new.working_days, 0), coalesce(new.days, 0),
                    case when new.start_date is not null and new.end_date is not null
                         then (new.end_date - new.start_date + 1) else 0 end);
  elsif tg_table_name = 'purchase_requests' then t := 'purchase_request'; amt := new.est_total; unit := '';
  elsif tg_table_name = 'overtime_entries' then t := 'overtime'; amt := new.hours; unit := 'hrs';
  else return null; end if;
  select * into r from public.approval_rule(new.org_id, t);
  if r.auto_approve_below > 0 and amt is not null and amt > 0 and amt < r.auto_approve_below then
    perform set_config('wfs.auto_approve', 'on', true);
    if tg_table_name = 'overtime_entries' then
      update public.overtime_entries set status = 'approved', decided_at = now() where id = new.id;
    else
      execute format('update public.%I set status = ''approved'', decided_at = now(), decided_by = $1 where id = $2', tg_table_name)
        using 'Auto-approved (under ' || trim(to_char(r.auto_approve_below, 'FM999999999990.##')) || coalesce(' ' || nullif(unit, ''), '') || ')', new.id;
    end if;
    perform set_config('wfs.auto_approve', 'off', true);
  end if;
  return null;
end $$;

notify pgrst, 'reload schema';
