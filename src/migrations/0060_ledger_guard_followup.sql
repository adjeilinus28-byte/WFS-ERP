-- ============================================================================
--  WFS Enterprise — 0060 Ledger guard follow-up (push security review of 0058)
--  Idempotent. Run after 0058.
--
--  1. Ledger set-up can't be moved between workspaces. guard_ledger_config
--     checked the owner/admin role only in the workspace a row moved *to*, so
--     an admin of workspace B who is only a manager in A could move A's
--     posting rules, accounts or bank accounts into B. Signed-in users can no
--     longer change org_id on these rows, and UPDATE/DELETE check the role in
--     the row's current workspace.
--  2. A posted journal can't be posted again. post_journal_entry() refuses an
--     entry that is already posted (it used to re-stamp posted_at).
--  Service-role jobs (auth.uid() is null) are not affected.
-- ============================================================================

-- 1 ─ ledger set-up stays in its workspace; role checked where the row lives
create or replace function public.guard_ledger_config()
returns trigger language plpgsql security definer set search_path = public as $$
declare org uuid;
begin
  if tg_op = 'UPDATE' and auth.uid() is not null and new.org_id is distinct from old.org_id then
    raise exception 'Ledger set-up cannot be moved to another workspace.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then org := new.org_id; else org := old.org_id; end if;
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
      if (new.code, new.account_type, new.subtype, new.normal_balance, new.is_contra)
         is distinct from (old.code, old.account_type, old.subtype, old.normal_balance, old.is_contra) then
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

-- 2 ─ post_journal_entry: as in 0058, plus "already posted" is refused
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
  if coalesce(je.posted, false) then raise exception 'This journal is already posted.'; end if;
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
  update public.journal_entries set posted = true, posted_at = now() where id = p_entry and not coalesce(posted, false);
  perform set_config('wfs.posting', 'off', true);
  return jsonb_build_object('posted', true, 'debits', round(d,2), 'credits', round(c,2));
end $$;
grant execute on function public.post_journal_entry(uuid) to authenticated;

notify pgrst, 'reload schema';
