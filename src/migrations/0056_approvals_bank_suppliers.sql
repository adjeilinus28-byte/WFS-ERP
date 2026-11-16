-- ============================================================================
--  WFS Enterprise — 0056 Approval rules · Bank & cash · Supplier compliance
--  Idempotent. Run after 0055.
--
--  A. APPROVAL RULES — per item type (leave, purchase request, overtime, manual
--     journal): the minimum role that may decide, an auto-approve limit, and
--     whether people may approve their own requests (blocked by default).
--     Enforced in the database by triggers, so it holds however the change is
--     made. Service-role jobs (email approval links, cron) are not affected.
--  B. BANK & CASH — bank_accounts register (opening balance, linked ledger
--     account), payments gain a bank account + reconciled flag, and
--     reconcile_bank() records a statement reconciliation only when the
--     statement balance matches the cleared transactions.
--  C. SUPPLIER COMPLIANCE — TIN, tax clearance number/expiry, bank details,
--     address, status and notes on suppliers.
-- ============================================================================

-- ═══ A. Approval rules ═══════════════════════════════════════════════════════
create table if not exists public.approval_rules (
  org_id             uuid not null references public.organizations(id) on delete cascade,
  item_type          text not null check (item_type in ('leave','purchase_request','overtime','journal')),
  approver_role      text not null default 'manager' check (approver_role in ('owner','admin','manager','supervisor')),
  auto_approve_below numeric not null default 0 check (auto_approve_below >= 0),
  block_self         boolean not null default true,
  updated_at         timestamptz not null default now(),
  primary key (org_id, item_type)
);
alter table public.approval_rules enable row level security;
drop policy if exists ar_read on public.approval_rules;
create policy ar_read on public.approval_rules for select using (org_id in (select public.user_org_ids()));
drop policy if exists ar_write on public.approval_rules;
create policy ar_write on public.approval_rules for all
  using (public.has_org_role(org_id, array['owner','admin']) or public.is_platform_owner())
  with check (public.has_org_role(org_id, array['owner','admin']) or public.is_platform_owner());

create or replace function public.role_rank(p_role text)
returns int language sql immutable as $$
  select case p_role when 'owner' then 5 when 'admin' then 4 when 'manager' then 3
                     when 'supervisor' then 2 when 'operator' then 1 else 0 end;
$$;

-- Effective rule (defaults when no row is saved).
create or replace function public.approval_rule(p_org uuid, p_type text)
returns table (approver_role text, auto_approve_below numeric, block_self boolean)
language sql stable security definer set search_path = public as $$
  select coalesce(r.approver_role, 'manager'), coalesce(r.auto_approve_below, 0), coalesce(r.block_self, true)
  from (select 1) d
  left join public.approval_rules r on r.org_id = p_org and r.item_type = p_type;
$$;
grant execute on function public.approval_rule(uuid, text) to authenticated;

-- Raises if the caller may not make this decision.
create or replace function public.check_approval(p_org uuid, p_type text, p_is_requester boolean, p_is_approval boolean)
returns void language plpgsql stable security definer set search_path = public as $$
declare r record; my_role text;
begin
  if auth.uid() is null then return; end if;                    -- service role / jobs / email links
  select * into r from public.approval_rule(p_org, p_type);
  if p_is_approval and r.block_self and p_is_requester then
    raise exception 'You cannot approve your own request. Another approver must decide it.'
      using errcode = '42501';
  end if;
  if public.is_platform_owner() then return; end if;
  select role into my_role from public.org_members where org_id = p_org and user_id = auth.uid();
  if public.role_rank(my_role) < public.role_rank(r.approver_role) then
    raise exception 'Only a % or above can decide this request.', r.approver_role using errcode = '42501';
  end if;
end $$;

-- Decision guard: fires when status moves to approved/declined.
create or replace function public.guard_decision()
returns trigger language plpgsql security definer set search_path = public as $$
declare t text; requester boolean := false;
begin
  if coalesce(current_setting('wfs.auto_approve', true), '') = 'on' then return new; end if;
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

-- Auto-approve small requests right after they are created.
create or replace function public.auto_approve_small()
returns trigger language plpgsql security definer set search_path = public as $$
declare t text; amt numeric; unit text; r record;
begin
  if new.status is distinct from 'pending' then return null; end if;
  if tg_table_name = 'leave_requests' then t := 'leave'; amt := coalesce(new.working_days, new.days); unit := 'days';
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

-- One-person workspaces: nobody else could approve, so start them with "own
-- requests allowed". Owners can tighten this in Settings → Approval rules.
insert into public.approval_rules(org_id, item_type, block_self)
select o.id, t.item_type, false
from public.organizations o
cross join (values ('leave'),('purchase_request'),('overtime'),('journal')) as t(item_type)
where (select count(*) from public.org_members m where m.org_id = o.id) <= 1
on conflict (org_id, item_type) do nothing;

do $$
declare t text;
begin
  foreach t in array array['leave_requests','purchase_requests','overtime_entries'] loop
    execute format('drop trigger if exists trg_guard_decision on public.%I;', t);
    execute format('create trigger trg_guard_decision before update on public.%I for each row execute function public.guard_decision();', t);
    execute format('drop trigger if exists trg_auto_approve on public.%I;', t);
    execute format('create trigger trg_auto_approve after insert on public.%I for each row execute function public.auto_approve_small();', t);
  end loop;
end $$;

-- Manual journals: posting is the approval. Rules apply to manual entries;
-- document-generated entries (ledger sync) keep the existing role check.
create or replace function public.post_journal_entry(p_entry uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d numeric; c numeric; org uuid; src text; maker uuid;
begin
  select org_id, source_type, created_by into org, src, maker from public.journal_entries where id = p_entry;
  if org is null then raise exception 'entry not found'; end if;
  if src = 'manual' then
    perform public.check_approval(org, 'journal', maker is not null and maker = auth.uid(), true);
  elsif not public.has_org_role(org, array['owner','admin','manager']) then
    raise exception 'insufficient privileges';
  end if;
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into d, c from public.journal_lines where entry_id = p_entry;
  if round(d,2) <> round(c,2) then raise exception 'Entry is unbalanced: debits %, credits %', round(d,2), round(c,2); end if;
  if round(d,2) = 0 then raise exception 'Entry has no value'; end if;
  perform set_config('wfs.posting', 'on', true);
  update public.journal_entries set posted = true, posted_at = now() where id = p_entry;
  perform set_config('wfs.posting', 'off', true);
  return jsonb_build_object('posted', true, 'debits', round(d,2), 'credits', round(c,2));
end $$;
grant execute on function public.post_journal_entry(uuid) to authenticated;

-- Manual entries can only become posted through post_journal_entry().
create or replace function public.guard_journal_posting()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or coalesce(current_setting('wfs.posting', true), '') = 'on' then return new; end if;
  if new.source_type = 'manual' then
    if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); new.posted := false; new.posted_at := null;
    elsif new.posted and not coalesce(old.posted, false) then
      raise exception 'Manual journals are posted through Approvals.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_journal_posting on public.journal_entries;
create trigger trg_guard_journal_posting before insert or update on public.journal_entries
  for each row execute function public.guard_journal_posting();

-- ═══ B. Bank & cash ══════════════════════════════════════════════════════════
create table if not exists public.bank_accounts (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.organizations(id) on delete cascade,
  name                    text not null,
  bank_name               text,
  account_number          text,
  currency                text not null default 'GHS',
  gl_account_id           uuid references public.gl_accounts(id) on delete set null,
  opening_balance         numeric not null default 0,
  opening_date            date not null default current_date,
  is_active               boolean not null default true,
  last_reconciled_on      date,
  last_reconciled_balance numeric,
  created_at              timestamptz not null default now()
);
create index if not exists bank_accounts_org_idx on public.bank_accounts(org_id);
alter table public.bank_accounts enable row level security;
drop policy if exists ba_read on public.bank_accounts;
create policy ba_read on public.bank_accounts for select using (
  org_id in (select public.user_org_ids()) and public.can_in_domain(org_id, 'finance', 'view'));
drop policy if exists ba_write on public.bank_accounts;
create policy ba_write on public.bank_accounts for all
  using (public.can_in_domain(org_id, 'finance', 'edit'))
  with check (public.can_in_domain(org_id, 'finance', 'edit'));

alter table public.payments
  add column if not exists bank_account_id uuid references public.bank_accounts(id) on delete set null,
  add column if not exists reconciled_at   timestamptz;
create index if not exists payments_bank_idx on public.payments(org_id, bank_account_id, paid_on);

-- Record a reconciliation. p_cleared: every payment that appears on the
-- statement up to p_date. Refuses unless opening balance + cleared money in −
-- cleared money out equals the statement balance.
create or replace function public.reconcile_bank(p_account uuid, p_date date, p_balance numeric, p_cleared uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare acc public.bank_accounts; cleared numeric;
begin
  select * into acc from public.bank_accounts where id = p_account;
  if acc.id is null then raise exception 'Bank account not found'; end if;
  if not public.can_in_domain(acc.org_id, 'finance', 'edit') then raise exception 'insufficient privileges'; end if;
  select acc.opening_balance + coalesce(sum(case when coalesce(direction,'out') = 'in' then amount else -amount end), 0)
    into cleared
  from public.payments
  where bank_account_id = p_account and paid_on <= p_date and paid_on >= acc.opening_date
    and (reconciled_at is not null or id = any(coalesce(p_cleared, '{}')));
  if abs(round(cleared - p_balance, 2)) >= 0.01 then
    raise exception 'Statement balance % does not match cleared transactions % (difference %)',
      round(p_balance, 2), round(cleared, 2), round(p_balance - cleared, 2);
  end if;
  update public.payments set reconciled_at = now()
  where bank_account_id = p_account and id = any(coalesce(p_cleared, '{}')) and reconciled_at is null and paid_on <= p_date;
  update public.bank_accounts set last_reconciled_on = p_date, last_reconciled_balance = p_balance where id = p_account;
  return jsonb_build_object('reconciled', true, 'balance', round(p_balance, 2));
end $$;
grant execute on function public.reconcile_bank(uuid, date, numeric, uuid[]) to authenticated;

-- ═══ C. Supplier compliance ══════════════════════════════════════════════════
alter table public.suppliers
  add column if not exists tin                  text,
  add column if not exists tax_clearance_no     text,
  add column if not exists tax_clearance_expiry date,
  add column if not exists bank_name            text,
  add column if not exists bank_account         text,
  add column if not exists address              text,
  add column if not exists status               text not null default 'active',
  add column if not exists notes                text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'suppliers_status_check') then
    alter table public.suppliers add constraint suppliers_status_check check (status in ('active','inactive'));
  end if;
end $$;

-- Audit the new tables too (0054 trigger function).
do $$
declare t text;
begin
  foreach t in array array['approval_rules','bank_accounts'] loop
    execute format('drop trigger if exists trg_audit on public.%I;', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.audit_row();', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
