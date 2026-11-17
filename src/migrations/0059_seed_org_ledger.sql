-- ============================================================================
--  WFS Enterprise — 0059 Standard ledger set-up for every workspace
--  Idempotent. Run after 0058.
--
--  The standard chart of accounts (26 accounts, 1000–5900), fiscal settings
--  and the 12 posting rules were only seeded once, by 0027, for the
--  workspaces that existed then. A workspace created later had no posting
--  rules, so Financials → Sync ledger failed for it, and since 0058 its
--  document journals can't be posted at all.
--
--  1. seed_org_ledger(org) adds whatever is missing from the standard set-up.
--     It never changes or removes existing accounts or rules. It skips rows
--     that already exist before inserting, because guard_ledger_config (0058)
--     runs before the unique-key check: a repeat call that inserts nothing
--     never reaches the guard.
--  2. A new workspace is set up when its first owner is added (register_org,
--     provision_org, or the service role). The owner row already exists at
--     that point, so the 0058 guard lets the seed through unchanged; the guard
--     itself is not modified. A workspace that already has posting rules is
--     left alone.
--  3. Back-fill: every existing workspace with no posting rules is set up.
-- ============================================================================

-- 1 ─ the standard set-up (same rows as 0027)
create or replace function public.seed_org_ledger(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_org is null then return; end if;

  insert into public.fiscal_settings (org_id) values (p_org)
  on conflict (org_id) do nothing;

  insert into public.gl_accounts (org_id, code, name, account_type, subtype, normal_balance, is_contra)
  select p_org, v.code, v.name, v.account_type, v.subtype, v.normal_balance, v.is_contra
    from (values
      -- Assets
      ('1000', 'Cash on Hand',               'asset',     'current_asset',       'debit',  false),
      ('1010', 'Bank — Current Account',     'asset',     'current_asset',       'debit',  false),
      ('1100', 'Accounts Receivable',        'asset',     'current_asset',       'debit',  false),
      ('1200', 'Inventory',                  'asset',     'current_asset',       'debit',  false),
      ('1250', 'Prepaid Expenses',           'asset',     'current_asset',       'debit',  false),
      ('1500', 'Property, Plant & Equipment','asset',     'fixed_asset',         'debit',  false),
      ('1590', 'Accumulated Depreciation',   'asset',     'fixed_asset',         'credit', true),
      -- Liabilities
      ('2000', 'Accounts Payable',           'liability', 'current_liability',   'credit', false),
      ('2100', 'Accrued Expenses',           'liability', 'current_liability',   'credit', false),
      ('2200', 'Net Wages Payable',          'liability', 'current_liability',   'credit', false),
      ('2210', 'SSNIT Payable',              'liability', 'current_liability',   'credit', false),
      ('2220', 'PAYE Payable',               'liability', 'current_liability',   'credit', false),
      ('2300', 'VAT Payable',                'liability', 'current_liability',   'credit', false),
      ('2500', 'Loans Payable',              'liability', 'long_term_liability', 'credit', false),
      -- Equity
      ('3000', 'Share Capital',              'equity',    'equity',              'credit', false),
      ('3100', 'Retained Earnings',          'equity',    'equity',              'credit', false),
      -- Income
      ('4000', 'Sales Revenue',              'income',    'operating_income',    'credit', false),
      ('4100', 'Other Income',               'income',    'other_income',        'credit', false),
      -- Expenses
      ('5000', 'Cost of Sales',              'expense',   'cost_of_sales',       'debit',  false),
      ('5100', 'Materials & Consumables',    'expense',   'operating_expense',   'debit',  false),
      ('5200', 'Salaries & Wages',           'expense',   'operating_expense',   'debit',  false),
      ('5210', 'Employer SSNIT',             'expense',   'operating_expense',   'debit',  false),
      ('5300', 'Repairs & Maintenance',      'expense',   'operating_expense',   'debit',  false),
      ('5400', 'Utilities',                  'expense',   'operating_expense',   'debit',  false),
      ('5500', 'Depreciation',               'expense',   'operating_expense',   'debit',  false),
      ('5900', 'Other Operating Expenses',   'expense',   'operating_expense',   'debit',  false)
    ) as v(code, name, account_type, subtype, normal_balance, is_contra)
   where not exists (select 1 from public.gl_accounts a where a.org_id = p_org and a.code = v.code)
  on conflict (org_id, code) do nothing;

  insert into public.posting_rules (org_id, role, account_code)
  select p_org, v.role, v.account_code
    from (values
      ('ar',                     '1100'),
      ('revenue',                '4000'),
      ('ap',                     '2000'),
      ('expense',                '5900'),
      ('inventory',              '1200'),
      ('materials_expense',      '5100'),
      ('salaries_expense',       '5200'),
      ('net_wages_payable',      '2200'),
      ('ssnit_payable',          '2210'),
      ('paye_payable',           '2220'),
      ('employer_ssnit_expense', '5210'),
      ('cash',                   '1010')
    ) as v(role, account_code)
   where not exists (select 1 from public.posting_rules r where r.org_id = p_org and r.role = v.role)
  on conflict (org_id, role) do nothing;
end $$;
revoke all on function public.seed_org_ledger(uuid) from public, anon, authenticated;

-- 2 ─ set up a new workspace when its first owner is added
create or replace function public.seed_ledger_for_new_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.posting_rules where org_id = new.org_id) then
    perform public.seed_org_ledger(new.org_id);
  end if;
  return null;
end $$;
revoke all on function public.seed_ledger_for_new_owner() from public, anon, authenticated;

drop trigger if exists trg_seed_org_ledger on public.org_members;
create trigger trg_seed_org_ledger after insert on public.org_members
  for each row when (new.role = 'owner')
  execute function public.seed_ledger_for_new_owner();

-- 3 ─ back-fill workspaces that have no posting rules
do $$
declare o record;
begin
  for o in select org.id from public.organizations org
            where not exists (select 1 from public.posting_rules r where r.org_id = org.id) loop
    perform public.seed_org_ledger(o.id);
  end loop;
end $$;

notify pgrst, 'reload schema';
