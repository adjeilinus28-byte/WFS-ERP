-- ============================================================================
--  WFS Enterprise — 0003 HR, Accounting & Procurement
--  Adds: structured departments, HR (leave + payroll), Accounting (AR/AP/
--  payments), and the front + back of procure-to-pay (requisitions + goods
--  receipts). Run after 0002. Same RLS model: read for members, write for
--  operator+; every table carries org_id.
-- ============================================================================

-- ── Departments (structured, per tenant) ───────────────────────────────────
-- Source of allowed department values; dropdowns across HR / Procurement /
-- Work Orders read from here instead of free text.
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  code text,
  head text,
  cost_center text,
  created_at timestamptz not null default now()
);
-- case-insensitive: one "Maintenance" per tenant regardless of casing
-- plain unique on (org_id, name) — ON CONFLICT (org_id, name) must exactly match the index expression
create unique index if not exists dept_org_name_uidx on public.departments(org_id, name);

-- ── HR · Leave requests ─────────────────────────────────────────────────────
create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  employee_name text,                  -- denormalised for display
  department text,
  leave_type text not null default 'annual', -- annual | sick | unpaid | compassionate | study
  start_date date,
  end_date date,
  days numeric,
  status text not null default 'pending',    -- pending | approved | declined | cancelled
  reason text,
  decided_by text,
  created_at timestamptz not null default now()
);

-- ── HR · Payroll (one payslip row per employee per period) ──────────────────
create table if not exists public.payroll (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  period text not null,                -- e.g. 2026-06
  employee_id uuid references public.employees(id) on delete set null,
  employee_name text,
  department text,
  gross_pay numeric not null default 0,
  allowances numeric not null default 0,
  deductions numeric not null default 0,
  net_pay numeric not null default 0,
  status text not null default 'draft', -- draft | approved | paid
  currency text default 'GHS',
  created_at timestamptz not null default now()
);
create unique index if not exists payroll_uidx on public.payroll(org_id, period, employee_id);

-- ── Accounting · Invoices (Accounts Receivable) ─────────────────────────────
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  invoice_no text not null,
  customer text not null,
  issue_date date default current_date,
  due_date date,
  amount numeric not null default 0,
  tax numeric not null default 0,
  total numeric not null default 0,
  status text not null default 'draft', -- draft | sent | paid | overdue | void
  currency text default 'GHS',
  notes text,
  created_at timestamptz not null default now()
);
create unique index if not exists inv_no_uidx on public.invoices(org_id, invoice_no);

-- ── Accounting · Bills (Accounts Payable / expenses) ────────────────────────
create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  bill_no text not null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  supplier_name text,
  category text,                        -- fuel | parts | services | utilities | payroll | other
  issue_date date default current_date,
  due_date date,
  amount numeric not null default 0,
  status text not null default 'unpaid', -- unpaid | paid | overdue | void
  currency text default 'GHS',
  notes text,
  created_at timestamptz not null default now()
);
create unique index if not exists bill_no_uidx on public.bills(org_id, bill_no);

-- ── Accounting · Payments (cash in / out, optionally linked) ────────────────
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  reference text,
  direction text not null default 'in', -- in (receipt) | out (disbursement)
  method text default 'bank',           -- bank | cash | momo | paystack | cheque
  amount numeric not null default 0,
  paid_on date default current_date,
  invoice_id uuid references public.invoices(id) on delete set null,
  bill_id uuid references public.bills(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

-- ── Procurement · Requisitions (front of procure-to-pay) ────────────────────
create table if not exists public.requisitions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  req_no text not null,
  department text,
  requester text,
  status text not null default 'submitted', -- submitted | approved | rejected | ordered
  needed_by date,
  est_total numeric default 0,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index if not exists req_no_uidx on public.requisitions(org_id, req_no);

create table if not exists public.requisition_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  req_id uuid not null references public.requisitions(id) on delete cascade,
  description text not null,
  qty numeric not null default 1,
  est_unit_cost numeric not null default 0
);

-- ── Procurement · Goods receipts (back of procure-to-pay) ───────────────────
create table if not exists public.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  po_id uuid references public.purchase_orders(id) on delete set null,
  po_number text,
  item text,
  qty_received numeric not null default 0,
  received_on date default current_date,
  received_by text,
  notes text,
  created_at timestamptz not null default now()
);

-- ============================================================================
--  RLS — read for members, write for operator+
-- ============================================================================
do $$
declare t text;
  tables text[] := array[
    'departments','leave_requests','payroll','invoices','bills','payments',
    'requisitions','requisition_lines','goods_receipts'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I on public.%I;', t||'_read', t);
    execute format(
      'create policy %I on public.%I for select using (org_id in (select public.user_org_ids()));',
      t||'_read', t);
    execute format('drop policy if exists %I on public.%I;', t||'_write', t);
    execute format(
      'create policy %I on public.%I for all '
      || 'using (public.has_org_role(org_id, array[''owner'',''admin'',''manager'',''supervisor'',''operator''])) '
      || 'with check (org_id in (select public.user_org_ids()));',
      t||'_write', t);
  end loop;
end $$;

-- ============================================================================
--  Enable the new modules for every existing tenant + change the default for
--  new tenants ('workforce' is superseded by the richer 'hr' module).
-- ============================================================================
alter table public.organizations
  alter column enabled_modules set default
  '["dashboard","assets","work_orders","inventory","procurement","hr","accounting","hse","reports","settings"]'::jsonb;

update public.organizations
set enabled_modules = (
  select jsonb_agg(distinct e)
  from jsonb_array_elements(
    (enabled_modules - 'workforce')
    || '["hr","accounting"]'::jsonb
  ) e
);

-- ============================================================================
--  Demo seed for Pamicor Ltd (idempotent)
-- ============================================================================
do $$
declare org uuid; emp_dir uuid; emp_tech uuid; emp_surv uuid;
begin
  select id into org from public.organizations where slug = 'pamicor';
  if org is null then return; end if;

  -- Departments
  insert into public.departments(org_id, name, code, head, cost_center) values
    (org,'Operations','OPS','Linus Adjei Duodu','CC-100'),
    (org,'Maintenance','MNT','J. Mensah','CC-200'),
    (org,'Geotech','GEO','A. Boateng','CC-300'),
    (org,'Human Resources','HR','Mabel','CC-400'),
    (org,'Finance','FIN',null,'CC-500'),
    (org,'Procurement','PRC',null,'CC-600'),
    (org,'HSE','HSE',null,'CC-700'),
    (org,'Processing','PRO',null,'CC-650')
  on conflict (org_id, name) do nothing;

  select id into emp_dir  from public.employees where org_id = org and employee_no = 'PM-0001';
  select id into emp_tech from public.employees where org_id = org and employee_no = 'PM-0042';
  select id into emp_surv from public.employees where org_id = org and employee_no = 'PM-0055';

  -- Leave
  insert into public.leave_requests(org_id, employee_id, employee_name, department, leave_type, start_date, end_date, days, status, reason)
  values
    (org, emp_tech, 'J. Mensah', 'Maintenance', 'annual', '2026-07-01','2026-07-05', 5, 'pending', 'Family time'),
    (org, emp_surv, 'A. Boateng', 'Geotech', 'sick', '2026-06-18','2026-06-19', 2, 'approved', 'Medical')
  on conflict do nothing;

  -- Payroll (June 2026)
  insert into public.payroll(org_id, period, employee_id, employee_name, department, gross_pay, allowances, deductions, net_pay, status)
  values
    (org,'2026-06', emp_dir,  'Linus Adjei Duodu','Operations', 12000, 2000, 1800, 12200, 'approved'),
    (org,'2026-06', emp_tech, 'J. Mensah','Maintenance',         5500,  800,  900,  5400, 'approved'),
    (org,'2026-06', emp_surv, 'A. Boateng','Geotech',            6200,  900, 1050,  6050, 'draft')
  on conflict (org_id, period, employee_id) do nothing;

  -- Accounting
  insert into public.invoices(org_id, invoice_no, customer, issue_date, due_date, amount, tax, total, status) values
    (org,'INV-2601','AngloGold Ashanti','2026-06-01','2026-06-30', 180000, 27000, 207000, 'sent'),
    (org,'INV-2602','Gold Fields Ghana','2026-05-15','2026-06-14', 95000, 14250, 109250, 'overdue')
  on conflict (org_id, invoice_no) do nothing;

  insert into public.bills(org_id, bill_no, supplier_name, category, issue_date, due_date, amount, status) values
    (org,'BILL-2601','Total Energies GH','fuel','2026-06-05','2026-06-25', 32000, 'unpaid'),
    (org,'BILL-2602','Mantrac Ghana','parts','2026-06-10','2026-07-10', 48500, 'unpaid')
  on conflict (org_id, bill_no) do nothing;

  insert into public.payments(org_id, reference, direction, method, amount, paid_on, notes) values
    (org,'PAY-IN-001','in','bank', 109250, '2026-06-20','Part settlement INV-2602'),
    (org,'PAY-OUT-001','out','momo', 32000, '2026-06-22','Fuel bill BILL-2601')
  on conflict do nothing;

  -- Procurement
  insert into public.requisitions(org_id, req_no, department, requester, status, needed_by, est_total, notes) values
    (org,'REQ-2601','Maintenance','J. Mensah','approved','2026-07-01', 9200,'Pump liner replacement set'),
    (org,'REQ-2602','Geotech','A. Boateng','submitted','2026-07-10', 4500,'Survey prism consumables')
  on conflict (org_id, req_no) do nothing;

  insert into public.goods_receipts(org_id, po_number, item, qty_received, received_on, received_by, notes) values
    (org,'—','Hydraulic Filter HF6555', 12, '2026-06-19','Store Keeper','Partial receipt')
  on conflict do nothing;
end $$;
