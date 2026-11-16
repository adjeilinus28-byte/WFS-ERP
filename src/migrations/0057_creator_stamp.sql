-- ============================================================================
--  WFS Enterprise — 0057 Server-stamped creator (closes a self-approval bypass)
--  The "can't approve your own request" rule (0056) compares created_by with
--  the approver. created_by was taken from the client, so a user could stamp
--  someone else as creator and then approve their own request. Now, for any
--  signed-in user, created_by is always set to the caller on insert and can
--  never be changed afterwards. Service-role jobs (auth.uid() is null) are not
--  affected. Applies to purchase_requests, overtime_entries and journal_entries.
--  Idempotent. Run after 0056.
-- ============================================================================

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
    -- "a_" prefix: runs before the other BEFORE triggers (alphabetical order)
    execute format('drop trigger if exists a_trg_stamp_creator on public.%I;', t);
    execute format('create trigger a_trg_stamp_creator before insert or update on public.%I for each row execute function public.stamp_creator();', t);
  end loop;
end $$;

-- guard_journal_posting no longer needs to fill created_by itself.
create or replace function public.guard_journal_posting()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or coalesce(current_setting('wfs.posting', true), '') = 'on' then return new; end if;
  if new.source_type = 'manual' then
    if tg_op = 'INSERT' then new.posted := false; new.posted_at := null;
    elsif new.posted and not coalesce(old.posted, false) then
      raise exception 'Manual journals are posted through Approvals.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
