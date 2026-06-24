-- ============================================================================
--  WFS Enterprise — 0002 ERP Modules
--  Tenant-scoped operational tables. Every table carries org_id and gates on
--  public.user_org_ids() (read) + role (write). Run after 0001.
--
--  Write roles: operator+ may create/edit operational records; viewers are
--  read-only. Tighten per module by editing the WRITE policy role arrays.
-- ============================================================================

-- Convenience: the roles allowed to mutate operational data.
-- (kept inline in each policy so you can tune per module)

-- ── Assets / Equipment register ─────────────────────────────────────────────
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  asset_code text not null,
  name text not null,
  category text,                       -- pump, haul_truck, conveyor, vessel, ...
  status text not null default 'operational', -- operational | down | maintenance | retired
  criticality text default 'medium',   -- low | medium | high | critical
  location text,
  department text,
  manufacturer text,
  model text,
  serial_no text,
  commissioned_on date,
  purchase_cost numeric,
  next_service_date date,
  meter_reading numeric,               -- hours / km
  notes text,
  created_at timestamptz not null default now()
);
create unique index if not exists assets_org_code_uidx on public.assets(org_id, asset_code);

-- ── Inventory / Warehouse ───────────────────────────────────────────────────
create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  sku text not null,
  name text not null,
  category text,
  uom text default 'ea',               -- unit of measure
  qty_on_hand numeric not null default 0,
  reorder_level numeric not null default 0,
  unit_cost numeric default 0,
  location text,
  created_at timestamptz not null default now()
);
create unique index if not exists inv_org_sku_uidx on public.inventory_items(org_id, sku);

create table if not exists public.inventory_txns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  txn_type text not null,              -- receipt | issue | adjust
  qty numeric not null,
  reference text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- ── Procurement ─────────────────────────────────────────────────────────────
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  contact_name text,
  email text,
  phone text,
  category text,
  created_at timestamptz not null default now()
);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  po_number text not null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  status text not null default 'draft', -- draft | sent | received | closed | cancelled
  currency text default 'GHS',
  total numeric default 0,
  expected_date date,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index if not exists po_org_num_uidx on public.purchase_orders(org_id, po_number);

create table if not exists public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  description text not null,
  item_id uuid references public.inventory_items(id) on delete set null,
  qty numeric not null default 1,
  unit_price numeric not null default 0
);

-- ── Maintenance / Work orders (CMMS) ────────────────────────────────────────
create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  wo_number text not null,
  title text not null,
  wo_type text not null default 'corrective', -- preventive | corrective | inspection
  priority text not null default 'medium',     -- low | medium | high | urgent
  status text not null default 'open',         -- open | in_progress | on_hold | done | cancelled
  asset_id uuid references public.assets(id) on delete set null,
  assigned_to text,
  department text,
  due_date date,
  completed_at timestamptz,
  description text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index if not exists wo_org_num_uidx on public.work_orders(org_id, wo_number);

-- ── Workforce / Employees ───────────────────────────────────────────────────
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  employee_no text,
  full_name text not null,
  department text,
  position text,
  status text not null default 'active',  -- active | leave | suspended | exited
  worker_type text,                        -- surface | underground | office | field
  email text,
  phone text,
  hired_on date,
  created_at timestamptz not null default now()
);

-- ── HSE / Incidents ─────────────────────────────────────────────────────────
create table if not exists public.hse_incidents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  incident_no text not null,
  incident_type text not null default 'near_miss', -- near_miss | injury | spill | equipment | environmental
  severity text not null default 'low',            -- low | medium | high | critical
  status text not null default 'open',             -- open | investigating | closed
  location text,
  department text,
  occurred_at timestamptz not null default now(),
  reported_by text,
  description text,
  corrective_action text,
  created_at timestamptz not null default now()
);
create unique index if not exists hse_org_num_uidx on public.hse_incidents(org_id, incident_no);

-- ── Compliance documents (expiry tracking) ──────────────────────────────────
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  doc_type text,                       -- permit | certificate | insurance | license | policy
  entity_type text,                    -- asset | employee | org | supplier
  entity_ref text,
  issued_on date,
  expiry_date date,
  file_url text,
  created_at timestamptz not null default now()
);

-- ── Notification log (Brevo email) ──────────────────────────────────────────
create table if not exists public.notification_log (
  id bigint generated always as identity primary key,
  org_id uuid references public.organizations(id) on delete cascade,
  alert_type text not null,            -- low_stock | service_due | doc_expiry | wo_overdue | hse_critical | monthly_report
  recipients jsonb,
  subject text,
  status text not null default 'sent', -- sent | failed
  detail jsonb,
  created_at timestamptz not null default now()
);

-- ── Document status view (Valid/Expiring/Critical/Expired) ──────────────────
create or replace view public.documents_status with (security_invoker = true) as
select d.*,
  case
    when d.expiry_date is null then 'no_expiry'
    when d.expiry_date < current_date then 'expired'
    when d.expiry_date < current_date + interval '14 days' then 'critical'
    when d.expiry_date < current_date + interval '45 days' then 'expiring'
    else 'valid'
  end as expiry_status,
  (d.expiry_date - current_date) as days_to_expiry
from public.documents d;

-- ============================================================================
--  RLS — read for all members, write for operator+ (viewers read-only)
-- ============================================================================
do $$
declare t text;
  read_tables text[] := array[
    'assets','inventory_items','inventory_txns','suppliers','purchase_orders',
    'purchase_order_lines','work_orders','employees','hse_incidents','documents',
    'notification_log'
  ];
begin
  foreach t in array read_tables loop
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
--  Demo seed — Pamicor Ltd (AGA TSF Operations), mining tenant
--  Idempotent: only seeds if the slug is absent. Re-link a real owner via
--  org_members after creating their auth user.
-- ============================================================================
do $$
declare org uuid;
begin
  select id into org from public.organizations where slug = 'pamicor';
  if org is null then
    insert into public.organizations(name, slug, industry, accent_color, currency, country, contact_email)
    values ('Pamicor Ltd','pamicor','mining','#F59E0B','GHS','GH','admin@workflow-app.net')
    returning id into org;

    insert into public.assets(org_id, asset_code, name, category, status, criticality, location, next_service_date, meter_reading) values
      (org,'PM-EXC-001','CAT 390F Excavator','excavator','operational','high','TSF Cell 2','2026-07-12', 4210),
      (org,'PM-HT-014','Komatsu HD785 Haul Truck','haul_truck','operational','critical','Haul Road','2026-06-29', 18650),
      (org,'PM-PMP-006','Slurry Pump Station A','pump','maintenance','critical','Decant Tower','2026-06-25', 9800),
      (org,'PM-DZR-003','D8 Dozer','dozer','down','medium','Embankment','2026-07-02', 7120);

    insert into public.inventory_items(org_id, sku, name, category, uom, qty_on_hand, reorder_level, unit_cost, location) values
      (org,'FLT-2010','Hydraulic Filter HF6555','filter','ea', 6, 10, 145, 'Store A'),
      (org,'OIL-15W40','Engine Oil 15W-40 (208L)','lubricant','drum', 3, 4, 1850, 'Store B'),
      (org,'LNR-PUMP','Slurry Pump Liner Set','wear_part','set', 1, 2, 9200, 'Store A'),
      (org,'PPE-HV','Hi-Vis Coverall','ppe','ea', 48, 20, 95, 'Store C');

    insert into public.suppliers(org_id, name, contact_name, email, phone, category) values
      (org,'Mantrac Ghana','Sales Desk','sales@mantrac.example','+233300000001','equipment'),
      (org,'Total Energies GH','Lubricants','lube@total.example','+233300000002','lubricants');

    insert into public.work_orders(org_id, wo_number, title, wo_type, priority, status, assigned_to, department, due_date, description) values
      (org,'WO-2601','Replace slurry pump liner','corrective','urgent','in_progress','J. Mensah','Maintenance','2026-06-25','Liner wear beyond limit on Station A'),
      (org,'WO-2602','500h service — HD785','preventive','high','open','K. Owusu','Maintenance','2026-06-29','Scheduled preventive service'),
      (org,'WO-2603','Embankment crack inspection','inspection','high','open','Geotech','Geotech','2026-06-24','Visual + survey on east embankment');

    insert into public.employees(org_id, employee_no, full_name, department, position, status, worker_type) values
      (org,'PM-0001','Linus Adjei Duodu','Operations','Operations Director','active','office'),
      (org,'PM-0042','J. Mensah','Maintenance','Senior Technician','active','field'),
      (org,'PM-0055','A. Boateng','Geotech','Survey Lead','active','field');

    insert into public.hse_incidents(org_id, incident_no, incident_type, severity, status, location, occurred_at, reported_by, description) values
      (org,'HSE-2607','near_miss','medium','investigating','Haul Road', now() - interval '2 days','K. Owusu','Haul truck near-miss at intersection'),
      (org,'HSE-2608','spill','low','closed','Store B', now() - interval '6 days','Store Keeper','Minor oil spill, contained');

    insert into public.documents(org_id, name, doc_type, entity_type, entity_ref, issued_on, expiry_date) values
      (org,'EPA Operating Permit','permit','org','Pamicor','2025-08-01','2026-08-01'),
      (org,'HD785 Insurance','insurance','asset','PM-HT-014','2025-07-10','2026-07-08'),
      (org,'Tailings Dam Safety Cert','certificate','org','TSF','2025-09-15','2026-06-30');
  end if;
end $$;

grant select on public.documents_status to authenticated;
