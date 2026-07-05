-- ============================================================================
--  WFS Enterprise — 0009 Procure-to-Pay
--  Purchase requests → approval (by chosen dept/ops head) → convert to PO →
--  supplier accept/decline via email link → auto-create a bill in Accounts.
--  Run after 0008.
-- ============================================================================

-- ── Purchase requests ───────────────────────────────────────────────────────
create table if not exists public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  request_no text,
  title text not null,
  requested_by text,
  department text,
  -- approval routing
  approver_email text,                  -- chosen dept/ops head who must approve
  approver_name text,
  priority text default 'normal',       -- low | normal | high | urgent
  status text not null default 'pending', -- pending | approved | declined | converted | cancelled
  supplier_id uuid references public.suppliers(id) on delete set null,
  currency text default 'GHS',
  est_total numeric default 0,
  needed_by date,
  justification text,
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  po_id uuid,                            -- link once converted
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists pr_org_idx on public.purchase_requests(org_id, created_at desc);

-- Line items for a request
create table if not exists public.purchase_request_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.purchase_requests(id) on delete cascade,
  description text not null,
  item_id uuid references public.inventory_items(id) on delete set null,
  qty numeric not null default 1,
  unit_price numeric not null default 0
);

-- ── Extend purchase_orders for the supplier approval loop + request link ─────
alter table public.purchase_orders
  add column if not exists request_id       uuid references public.purchase_requests(id) on delete set null,
  add column if not exists supplier_status  text default 'pending',  -- pending | accepted | declined
  add column if not exists supplier_token    text,                    -- opaque token for email links
  add column if not exists supplier_decided_at timestamptz,
  add column if not exists bill_id           uuid;

-- ── RLS ─────────────────────────────────────────────────────────────────────
do $$
declare t text;
  tbls text[] := array['purchase_requests','purchase_request_lines'];
begin
  foreach t in array tbls loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I on public.%I;', t||'_read', t);
    execute format('create policy %I on public.%I for select using (org_id in (select public.user_org_ids()));', t||'_read', t);
    execute format('drop policy if exists %I on public.%I;', t||'_write', t);
    execute format('create policy %I on public.%I for all using (public.has_org_role(org_id, array[''owner'',''admin'',''manager'',''supervisor'',''operator''])) with check (org_id in (select public.user_org_ids()));', t||'_write', t);
  end loop;
end $$;
