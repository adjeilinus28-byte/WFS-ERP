-- ============================================================================
--  WFS Enterprise — 0027 General Ledger & Financial Statements
--  Double-entry bookkeeping: chart of accounts, journal entries/lines, posting
--  rules for auto-posting source documents, trial balance, and fiscal settings
--  on the 21st–20th business month. Run after 0026.
-- ============================================================================

-- ── Chart of accounts ───────────────────────────────────────────────────────
create table if not exists public.gl_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  account_type text not null,        -- asset | liability | equity | income | expense
  subtype text,                      -- current_asset | fixed_asset | current_liability | ...
  normal_balance text not null,      -- debit | credit
  is_contra boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists gla_uidx on public.gl_accounts(org_id, code);
create index if not exists gla_type_idx on public.gl_accounts(org_id, account_type);

-- ── Journal entries ─────────────────────────────────────────────────────────
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  entry_no text,
  entry_date date not null default current_date,
  period text,                       -- business-month key 'YYYY-MM'
  memo text,
  source_type text default 'manual', -- manual | invoice | bill | payroll | issuance
  source_id uuid,
  posted boolean not null default false,
  posted_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists je_org_idx on public.journal_entries(org_id, entry_date desc);
-- Idempotency: one entry per source document
create unique index if not exists je_source_uidx on public.journal_entries(org_id, source_type, source_id)
  where source_id is not null;

-- ── Journal lines ───────────────────────────────────────────────────────────
create table if not exists public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  entry_id uuid not null references public.journal_entries(id) on delete cascade,
  account_id uuid not null references public.gl_accounts(id) on delete restrict,
  debit numeric not null default 0,
  credit numeric not null default 0,
  description text,
  constraint jl_one_sided check (debit >= 0 and credit >= 0 and not (debit > 0 and credit > 0))
);
create index if not exists jl_entry_idx on public.journal_lines(entry_id);
create index if not exists jl_acct_idx on public.journal_lines(org_id, account_id);

-- ── Posting rules: map a document role → account code ───────────────────────
create table if not exists public.posting_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  role text not null,                -- ar | revenue | ap | expense | inventory | ...
  account_code text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists pr_uidx on public.posting_rules(org_id, role);

-- ── Fiscal settings ─────────────────────────────────────────────────────────
create table if not exists public.fiscal_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  fiscal_year_start_month int not null default 1,   -- 1 = January
  use_business_month boolean not null default true, -- 21st–20th cycle
  updated_at timestamptz not null default now()
);

-- ── Enforce balanced entries when posting ───────────────────────────────────
create or replace function public.post_journal_entry(p_entry uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d numeric; c numeric; org uuid;
begin
  select org_id into org from public.journal_entries where id = p_entry;
  if org is null then raise exception 'entry not found'; end if;
  if not public.has_org_role(org, array['owner','admin','manager']) then
    raise exception 'insufficient privileges';
  end if;
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into d, c
    from public.journal_lines where entry_id = p_entry;
  if round(d,2) <> round(c,2) then
    raise exception 'Entry is unbalanced: debits %, credits %', round(d,2), round(c,2);
  end if;
  if round(d,2) = 0 then raise exception 'Entry has no value'; end if;
  update public.journal_entries set posted = true, posted_at = now() where id = p_entry;
  return jsonb_build_object('posted', true, 'debits', round(d,2), 'credits', round(c,2));
end $$;
grant execute on function public.post_journal_entry(uuid) to authenticated;

-- Block edits to posted entries (immutable once posted)
create or replace function public.guard_posted_lines()
returns trigger language plpgsql as $$
declare is_posted boolean;
begin
  select posted into is_posted from public.journal_entries
    where id = coalesce(new.entry_id, old.entry_id);
  if is_posted then raise exception 'Cannot modify lines of a posted entry'; end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_guard_lines on public.journal_lines;
create trigger trg_guard_lines before insert or update or delete on public.journal_lines
  for each row execute function public.guard_posted_lines();

-- ── Trial balance view (posted entries only) ────────────────────────────────
create or replace view public.trial_balance with (security_invoker = true) as
select
  a.org_id, a.id as account_id, a.code, a.name, a.account_type, a.subtype,
  a.normal_balance, a.is_contra, e.period,
  coalesce(sum(l.debit), 0)  as total_debit,
  coalesce(sum(l.credit), 0) as total_credit,
  case when a.normal_balance = 'debit'
       then coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0)
       else coalesce(sum(l.credit), 0) - coalesce(sum(l.debit), 0)
  end as balance
from public.gl_accounts a
left join public.journal_lines l on l.account_id = a.id
left join public.journal_entries e on e.id = l.entry_id and e.posted = true
group by a.org_id, a.id, a.code, a.name, a.account_type, a.subtype, a.normal_balance, a.is_contra, e.period;

grant select on public.trial_balance to authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────
do $$
declare t text;
  tbls text[] := array['gl_accounts','journal_entries','journal_lines','posting_rules','fiscal_settings'];
begin
  foreach t in array tbls loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I on public.%I;', t||'_read', t);
    execute format('create policy %I on public.%I for select using (org_id in (select public.user_org_ids()));', t||'_read', t);
    execute format('drop policy if exists %I on public.%I;', t||'_write', t);
    execute format('create policy %I on public.%I for all using (public.has_org_role(org_id, array[''owner'',''admin'',''manager''])) with check (org_id in (select public.user_org_ids()));', t||'_write', t);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- ── Seed a standard chart of accounts + posting rules for every org ─────────
do $$
declare o record;
begin
  for o in select id from public.organizations loop
    insert into public.fiscal_settings (org_id) values (o.id) on conflict (org_id) do nothing;

    insert into public.gl_accounts (org_id, code, name, account_type, subtype, normal_balance, is_contra) values
      -- Assets
      (o.id, '1000', 'Cash on Hand',              'asset',     'current_asset',     'debit',  false),
      (o.id, '1010', 'Bank — Current Account',    'asset',     'current_asset',     'debit',  false),
      (o.id, '1100', 'Accounts Receivable',       'asset',     'current_asset',     'debit',  false),
      (o.id, '1200', 'Inventory',                 'asset',     'current_asset',     'debit',  false),
      (o.id, '1250', 'Prepaid Expenses',          'asset',     'current_asset',     'debit',  false),
      (o.id, '1500', 'Property, Plant & Equipment','asset',    'fixed_asset',       'debit',  false),
      (o.id, '1590', 'Accumulated Depreciation',  'asset',     'fixed_asset',       'credit', true),
      -- Liabilities
      (o.id, '2000', 'Accounts Payable',          'liability', 'current_liability', 'credit', false),
      (o.id, '2100', 'Accrued Expenses',          'liability', 'current_liability', 'credit', false),
      (o.id, '2200', 'Net Wages Payable',         'liability', 'current_liability', 'credit', false),
      (o.id, '2210', 'SSNIT Payable',             'liability', 'current_liability', 'credit', false),
      (o.id, '2220', 'PAYE Payable',              'liability', 'current_liability', 'credit', false),
      (o.id, '2300', 'VAT Payable',               'liability', 'current_liability', 'credit', false),
      (o.id, '2500', 'Loans Payable',             'liability', 'long_term_liability','credit', false),
      -- Equity
      (o.id, '3000', 'Share Capital',             'equity',    'equity',            'credit', false),
      (o.id, '3100', 'Retained Earnings',         'equity',    'equity',            'credit', false),
      -- Income
      (o.id, '4000', 'Sales Revenue',             'income',    'operating_income',  'credit', false),
      (o.id, '4100', 'Other Income',              'income',    'other_income',      'credit', false),
      -- Expenses
      (o.id, '5000', 'Cost of Sales',             'expense',   'cost_of_sales',     'debit',  false),
      (o.id, '5100', 'Materials & Consumables',   'expense',   'operating_expense', 'debit',  false),
      (o.id, '5200', 'Salaries & Wages',          'expense',   'operating_expense', 'debit',  false),
      (o.id, '5210', 'Employer SSNIT',            'expense',   'operating_expense', 'debit',  false),
      (o.id, '5300', 'Repairs & Maintenance',     'expense',   'operating_expense', 'debit',  false),
      (o.id, '5400', 'Utilities',                 'expense',   'operating_expense', 'debit',  false),
      (o.id, '5500', 'Depreciation',              'expense',   'operating_expense', 'debit',  false),
      (o.id, '5900', 'Other Operating Expenses',  'expense',   'operating_expense', 'debit',  false)
    on conflict (org_id, code) do nothing;

    insert into public.posting_rules (org_id, role, account_code) values
      (o.id, 'ar',                     '1100'),
      (o.id, 'revenue',                '4000'),
      (o.id, 'ap',                     '2000'),
      (o.id, 'expense',                '5900'),
      (o.id, 'inventory',              '1200'),
      (o.id, 'materials_expense',      '5100'),
      (o.id, 'salaries_expense',       '5200'),
      (o.id, 'net_wages_payable',      '2200'),
      (o.id, 'ssnit_payable',          '2210'),
      (o.id, 'paye_payable',           '2220'),
      (o.id, 'employer_ssnit_expense', '5210'),
      (o.id, 'cash',                   '1010')
    on conflict (org_id, role) do nothing;
  end loop;
end $$;

notify pgrst, 'reload schema';
