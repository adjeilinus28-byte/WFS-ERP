-- ============================================================================
--  WFS Enterprise — 0058 Approval hardening, part 2 (security review follow-up)
--  Idempotent. Run after 0057.
--
--  1. Document journals must match their document. post_journal_entry() only
--     posts a non-manual journal (invoice, bill, payment, issuance, payroll)
--     when its document exists in the same workspace and is postable, and the
--     journal's lines equal — account by account, debit and credit — what the
--     ledger sync posts for that document under the posting rules. A user can
--     no longer label a free-form journal "bill" or "invoice", or move amounts
--     between accounts, to skip the manual-journal approval.
--  2. Posted journals are final: they can't be unposted, deleted or re-dated,
--     and their lines can't be moved out. Lines must belong to the same
--     workspace as their entry and their account. The entry is locked while
--     it is checked and posted, so lines can't change mid-post.
--     Ledger set-up that decides where documents post (posting rules, account
--     codes and types, a bank account's ledger account) is owner/admin only.
--  3. New requests always start pending. For signed-in users, purchase
--     requests, leave and overtime are inserted as 'pending' with no decision,
--     whatever the client sends (auto-approve still runs after insert).
--  4. Purchase requests: an approved request goes back to pending when its
--     title, supplier, currency or line items change, and can't be changed in
--     the same step as converting it; only an approved request can be
--     converted; a converted request is closed (no edits, no status change,
--     no line changes). Line items must belong to the request's workspace.
--  Service-role jobs (auth.uid() is null) are not affected.
-- ============================================================================

-- helper: the ledger account a posting rule points at (internal)
create or replace function public._rule_account(p_org uuid, p_role text)
returns uuid language sql stable security definer set search_path = public as $$
  select a.id from public.posting_rules r
    join public.gl_accounts a on a.org_id = r.org_id and a.code = r.account_code
   where r.org_id = p_org and r.role = p_role
   limit 1
$$;
revoke all on function public._rule_account(uuid, text) from public, anon, authenticated;

-- 1 ─ post_journal_entry: manual → approval rules; document → must equal what the sync posts
create or replace function public.post_journal_entry(p_entry uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d numeric; c numeric; je public.journal_entries; pay public.payments; pr public.payroll;
  ok boolean; bank uuid; bad int; expected numeric;
  ea uuid[]; ed numeric[]; ec numeric[];            -- expected lines: account, debit, credit
  amt numeric; net numeric; emp_ss numeric; er_ss numeric; taxes numeric; rest numeric; accrued uuid;
begin
  -- Lock the entry first: line writes wait on this lock (guard_posted_lines), so
  -- the lines checked below are the lines that get posted.
  select * into je from public.journal_entries where id = p_entry for update;
  if je.id is null then raise exception 'entry not found'; end if;
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into d, c from public.journal_lines where entry_id = p_entry;
  if round(d,2) <> round(c,2) then raise exception 'Entry is unbalanced: debits %, credits %', round(d,2), round(c,2); end if;
  if round(d,2) = 0 then raise exception 'Entry has no value'; end if;
  if exists (select 1 from public.journal_lines where entry_id = p_entry and org_id is distinct from je.org_id) then
    raise exception 'Entry has lines from another workspace.';
  end if;

  if je.source_type = 'manual' then
    perform public.check_approval(je.org_id, 'journal', je.created_by is not null and je.created_by = auth.uid(), true);
  else
    if not public.has_org_role(je.org_id, array['owner','admin','manager']) and not public.is_platform_owner() then
      raise exception 'insufficient privileges';
    end if;
    if je.source_id is null then raise exception 'Document journals must reference their document.'; end if;

    -- The document and the exact lines the ledger sync (Financials → Sync ledger) posts for it.
    if je.source_type = 'invoice' then
      select true, coalesce(total, 0) into ok, amt from public.invoices
       where id = je.source_id and org_id = je.org_id and status in ('sent','approved','partial','paid','overdue') for share;
      ea := array[public._rule_account(je.org_id, 'ar'), public._rule_account(je.org_id, 'revenue')];
      ed := array[amt, 0]; ec := array[0, amt];
    elsif je.source_type = 'bill' then
      select true, coalesce(nullif(total, 0), amount, 0) into ok, amt from public.bills
       where id = je.source_id and org_id = je.org_id and status <> 'draft' for share;
      ea := array[public._rule_account(je.org_id, 'expense'), public._rule_account(je.org_id, 'ap')];
      ed := array[amt, 0]; ec := array[0, amt];
    elsif je.source_type = 'payment' then
      select * into pay from public.payments where id = je.source_id and org_id = je.org_id for share;
      ok := pay.id is not null; amt := coalesce(pay.amount, 0);
      bank := coalesce((select gl_account_id from public.bank_accounts where id = pay.bank_account_id and org_id = je.org_id),
                       public._rule_account(je.org_id, 'cash'));
      if pay.direction = 'in' then
        ea := array[bank,
                    case when pay.invoice_id is not null then public._rule_account(je.org_id, 'ar')
                         else coalesce((select id from public.gl_accounts where org_id = je.org_id and code = '4100'),
                                       public._rule_account(je.org_id, 'revenue')) end];
      else
        ea := array[case when pay.bill_id is not null then public._rule_account(je.org_id, 'ap')
                         else public._rule_account(je.org_id, 'expense') end,
                    bank];
      end if;
      ed := array[amt, 0]; ec := array[0, amt];
    elsif je.source_type = 'issuance' then
      select true, coalesce(total_cost, 0) into ok, amt from public.issuances where id = je.source_id and org_id = je.org_id for share;
      ea := array[public._rule_account(je.org_id, 'materials_expense'), public._rule_account(je.org_id, 'inventory')];
      ed := array[amt, 0]; ec := array[0, amt];
    elsif je.source_type = 'payroll' then
      select * into pr from public.payroll where id = je.source_id and org_id = je.org_id and status in ('approved','paid') for share;
      ok := pr.id is not null;
      amt := coalesce(pr.gross_pay, 0); net := coalesce(pr.net_pay, 0);
      emp_ss := coalesce(pr.ssnit, 0); er_ss := coalesce(pr.ssnit_employer, 0);
      taxes := coalesce(pr.paye_amount, 0) + coalesce(pr.overtime_tax, 0) + coalesce(pr.bonus_tax, 0);
      rest := round(amt - net - emp_ss - taxes, 2);              -- union dues, rent, loans, other
      accrued := (select id from public.gl_accounts where org_id = je.org_id and code = '2100');
      ea := array[public._rule_account(je.org_id, 'salaries_expense'), public._rule_account(je.org_id, 'employer_ssnit_expense'),
                  public._rule_account(je.org_id, 'net_wages_payable'), public._rule_account(je.org_id, 'ssnit_payable'),
                  public._rule_account(je.org_id, 'paye_payable')];
      ed := array[amt, er_ss, 0, 0, 0];
      ec := array[0, 0, net, round(emp_ss + er_ss, 2), taxes];
      if rest > 0.01 and accrued is not null then
        ea := ea || accrued; ed := ed || 0::numeric; ec := ec || rest;
      end if;
    else
      raise exception 'Unknown journal source "%".', je.source_type;
    end if;

    if not coalesce(ok, false) then
      raise exception 'The % this journal refers to was not found or cannot be posted yet.', je.source_type;
    end if;
    select coalesce(sum(x), 0) into expected from unnest(ed) as x;
    if abs(expected - d) > 0.01 then
      raise exception 'Journal total % does not match the % amount %.', round(d,2), je.source_type, round(expected,2);
    end if;
    -- Account by account, debits and credits must equal the expected lines.
    with want as (
      select u.a, sum(u.dv) dv, sum(u.cv) cv from unnest(ea, ed, ec) as u(a, dv, cv) group by u.a
    ), got as (
      select account_id a, sum(debit) dv, sum(credit) cv from public.journal_lines where entry_id = p_entry group by account_id
    )
    select count(*) into bad from want full join got on got.a = want.a
     where abs(coalesce(want.dv, 0) - coalesce(got.dv, 0)) > 0.01
        or abs(coalesce(want.cv, 0) - coalesce(got.cv, 0)) > 0.01;
    if bad > 0 then
      raise exception 'This % journal does not match what the ledger posts for it. Use Sync ledger, or a manual journal.', je.source_type;
    end if;
  end if;

  perform set_config('wfs.posting', 'on', true);
  update public.journal_entries set posted = true, posted_at = now() where id = p_entry;
  perform set_config('wfs.posting', 'off', true);
  return jsonb_build_object('posted', true, 'debits', round(d,2), 'credits', round(c,2));
end $$;
grant execute on function public.post_journal_entry(uuid) to authenticated;

-- 2 ─ posted journals are final
create or replace function public.guard_journal_posting()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or coalesce(current_setting('wfs.posting', true), '') = 'on' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if coalesce(old.posted, false) then
      raise exception 'Posted journals cannot be deleted. Record a reversing journal instead.' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    new.posted := false; new.posted_at := null;
    return new;
  end if;
  if new.source_type is distinct from old.source_type then
    raise exception 'The source of a journal cannot be changed.' using errcode = '42501';
  end if;
  if coalesce(old.posted, false) and (
       new.posted is distinct from old.posted or new.posted_at is distinct from old.posted_at
    or (new.org_id, new.entry_date, new.period, new.source_id) is distinct from (old.org_id, old.entry_date, old.period, old.source_id)) then
    raise exception 'Posted journals cannot be changed. Record a reversing journal instead.' using errcode = '42501';
  end if;
  if new.posted and not coalesce(old.posted, false) then
    raise exception 'Journals are posted through Approvals or the ledger sync.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_journal_posting on public.journal_entries;
create trigger trg_guard_journal_posting before insert or update or delete on public.journal_entries
  for each row execute function public.guard_journal_posting();

-- Lines: locked on posted entries (both the entry they leave and the one they
-- join), and always in the same workspace as their entry and their account.
-- FOR SHARE makes a line write wait for a posting in progress, then see it.
create or replace function public.guard_posted_lines()
returns trigger language plpgsql security definer set search_path = public as $$
declare is_posted boolean; entry_org uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select posted into is_posted from public.journal_entries where id = old.entry_id for share;
    if coalesce(is_posted, false) then raise exception 'Cannot modify lines of a posted entry'; end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select posted, org_id into is_posted, entry_org from public.journal_entries where id = new.entry_id for share;
    if coalesce(is_posted, false) then raise exception 'Cannot modify lines of a posted entry'; end if;
    if entry_org is distinct from new.org_id
       or not exists (select 1 from public.gl_accounts where id = new.account_id and org_id = new.org_id) then
      raise exception 'A journal line must belong to the same workspace as its entry and its account.' using errcode = '42501';
    end if;
    return new;
  end if;
  return old;
end $$;

-- Ledger set-up decides where document journals post, so only owners and
-- admins may change it: posting rules, an account's code or type, accounts a
-- rule points at, and which ledger account a bank account posts to.
create or replace function public.guard_ledger_config()
returns trigger language plpgsql security definer set search_path = public as $$
declare org uuid;
begin
  if tg_op = 'DELETE' then org := old.org_id; else org := new.org_id; end if;
  -- A bank account always posts to an asset account in its own workspace.
  if tg_table_name = 'bank_accounts' and tg_op <> 'DELETE' then
    if new.gl_account_id is not null
       and not exists (select 1 from public.gl_accounts where id = new.gl_account_id and org_id = new.org_id and account_type = 'asset') then
      raise exception 'A bank account must post to an asset account in this workspace.';
    end if;
  end if;
  if auth.uid() is null or public.has_org_role(org, array['owner','admin']) or public.is_platform_owner() then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'posting_rules' then
    raise exception 'Only owners and admins can change posting rules.' using errcode = '42501';
  elsif tg_table_name = 'gl_accounts' then
    if tg_op = 'INSERT' then
      -- 2100 (other payroll deductions) and 4100 (other income) are posted to by code.
      if new.code in ('2100', '4100')
         or exists (select 1 from public.posting_rules where org_id = new.org_id and account_code = new.code) then
        raise exception 'Account % is used by the ledger sync; only owners and admins can create it.', new.code using errcode = '42501';
      end if;
    elsif tg_op = 'UPDATE' then
      if (new.org_id, new.code, new.account_type, new.subtype, new.normal_balance, new.is_contra)
         is distinct from (old.org_id, old.code, old.account_type, old.subtype, old.normal_balance, old.is_contra) then
        raise exception 'Only owners and admins can change an account''s code or type.' using errcode = '42501';
      end if;
    else
      raise exception 'Only owners and admins can delete ledger accounts.' using errcode = '42501';
    end if;
  elsif tg_table_name = 'bank_accounts' then
    if (tg_op = 'INSERT' and new.gl_account_id is not null)
       or (tg_op = 'UPDATE' and new.gl_account_id is distinct from old.gl_account_id) then
      raise exception 'Only owners and admins can change the ledger account a bank account posts to.' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['posting_rules','gl_accounts','bank_accounts'] loop
    execute format('drop trigger if exists trg_guard_ledger_config on public.%I;', t);
    execute format('create trigger trg_guard_ledger_config before insert or update or delete on public.%I for each row execute function public.guard_ledger_config();', t);
  end loop;
end $$;

-- 3 ─ new requests always start pending
create or replace function public.force_pending_on_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or coalesce(current_setting('wfs.auto_approve', true), '') = 'on' then return new; end if;
  new.status := 'pending';
  new.decided_by := null;
  new.decided_at := null;
  if tg_table_name = 'purchase_requests' then new.po_id := null; end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['purchase_requests','leave_requests','overtime_entries'] loop
    execute format('drop trigger if exists b_trg_force_pending on public.%I;', t);
    -- "b_" so it runs right after a_trg_stamp_creator
    execute format('create trigger b_trg_force_pending before insert on public.%I for each row execute function public.force_pending_on_insert();', t);
  end loop;
end $$;

-- 4 ─ decisions, re-approval on material change, conversion rules
create or replace function public.guard_decision()
returns trigger language plpgsql security definer set search_path = public as $$
declare t text; requester boolean := false; changed boolean := false;
begin
  if coalesce(current_setting('wfs.auto_approve', true), '') = 'on' then return new; end if;

  if auth.uid() is not null and tg_table_name = 'purchase_requests' then
    changed := (new.org_id, new.est_total, new.currency, new.supplier_id, new.title)
               is distinct from (old.org_id, old.est_total, old.currency, old.supplier_id, old.title);
    if old.status = 'converted' and (changed or new.status is distinct from 'converted') then
      raise exception 'This request has been converted to a purchase order and is closed.' using errcode = '42501';
    end if;
    if old.status = 'approved' and changed then
      if new.status = 'converted' then
        raise exception 'Save changes to an approved request before converting it; it will need approval again.' using errcode = '42501';
      elsif new.status = 'approved' then
        new.status := 'pending'; new.decided_at := null; new.decided_by := null;
        return new;
      end if;
    end if;
    if new.status = 'converted' and old.status is distinct from 'converted' and old.status is distinct from 'approved' then
      raise exception 'Only an approved request can be converted to a purchase order.' using errcode = '42501';
    end if;
  end if;

  -- An approved leave or overtime entry edited in a way that matters goes back for a new decision.
  if auth.uid() is not null and old.status = 'approved' and new.status = 'approved' then
    if tg_table_name = 'leave_requests' then
      changed := (new.org_id, new.start_date, new.end_date, new.days, new.working_days, new.employee_id, new.leave_type)
                 is distinct from (old.org_id, old.start_date, old.end_date, old.days, old.working_days, old.employee_id, old.leave_type);
    elsif tg_table_name = 'overtime_entries' then
      -- period is what payroll (compute_overtime_pay) reads approved hours by.
      changed := (new.org_id, new.hours, new.work_date, new.period, new.employee_id)
                 is distinct from (old.org_id, old.hours, old.work_date, old.period, old.employee_id);
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

-- Purchase request lines: same workspace as their request; none on a closed
-- (converted) request; a change on an approved request sends it back to pending.
create or replace function public.guard_request_lines()
returns trigger language plpgsql security definer set search_path = public as $$
declare req_org uuid; req_status text;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  -- FOR SHARE: a line write waits for a status change in progress and sees its result.
  if tg_op in ('UPDATE', 'DELETE') then
    select org_id, status into req_org, req_status from public.purchase_requests where id = old.request_id for share;
    if req_status = 'converted' then raise exception 'This request has been converted to a purchase order and is closed.' using errcode = '42501'; end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select org_id, status into req_org, req_status from public.purchase_requests where id = new.request_id for share;
    if req_org is distinct from new.org_id then
      raise exception 'A request line must belong to the same workspace as its request.' using errcode = '42501';
    end if;
    if req_status = 'converted' then raise exception 'This request has been converted to a purchase order and is closed.' using errcode = '42501'; end if;
    return new;
  end if;
  return old;
end $$;
drop trigger if exists trg_guard_request_lines on public.purchase_request_lines;
create trigger trg_guard_request_lines before insert or update or delete on public.purchase_request_lines
  for each row execute function public.guard_request_lines();

create or replace function public.reopen_request_on_line_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return null; end if;
  update public.purchase_requests
     set status = 'pending', decided_at = null, decided_by = null
   where status = 'approved'
     and ((new.request_id is not null and id = new.request_id and org_id = new.org_id)
       or (old.request_id is not null and id = old.request_id and org_id = old.org_id));
  return null;
end $$;
drop trigger if exists trg_reopen_on_lines on public.purchase_request_lines;
create trigger trg_reopen_on_lines after insert or update or delete on public.purchase_request_lines
  for each row execute function public.reopen_request_on_line_change();

notify pgrst, 'reload schema';
