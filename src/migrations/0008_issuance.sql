-- ============================================================================
--  WFS Enterprise — 0008 Material Issuance / Deployment
--  Tracks stock issued out (to work orders, departments, assets), the cost of
--  each deployment, and auto-draws-down inventory. Correlates issuance with
--  the inventory register. Run after 0007.
-- ============================================================================

create table if not exists public.issuances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  issue_no text,
  item_id uuid references public.inventory_items(id) on delete set null,
  item_name text,                       -- snapshot for history even if item deleted
  sku text,
  qty numeric not null default 0,
  uom text,
  unit_cost numeric not null default 0, -- snapshot of cost at issue time
  total_cost numeric not null default 0,
  -- where it went
  issued_to_type text,                  -- work_order | department | asset | employee | other
  issued_to text,                       -- free label or reference
  department text,
  asset_id uuid references public.assets(id) on delete set null,
  work_order_id uuid references public.work_orders(id) on delete set null,
  issued_by text,
  issue_date date not null default current_date,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists issuances_org_date_idx on public.issuances(org_id, issue_date desc);
create index if not exists issuances_item_idx on public.issuances(item_id);

-- ── Auto stock draw-down + inventory transaction log ────────────────────────
-- On issue: decrement inventory_items.qty_on_hand and log an 'issue' txn.
create or replace function public.issuance_apply()
returns trigger language plpgsql security definer set search_path = public as $$
declare cur numeric;
begin
  if new.item_id is not null then
    select qty_on_hand into cur from public.inventory_items where id = new.item_id;
    update public.inventory_items
      set qty_on_hand = coalesce(cur,0) - new.qty
      where id = new.item_id;
    insert into public.inventory_txns(org_id, item_id, txn_type, qty, reference)
      values (new.org_id, new.item_id, 'issue', new.qty,
              coalesce(new.issue_no, 'ISSUE') || ' → ' || coalesce(new.issued_to, new.issued_to_type, 'n/a'));
  end if;
  return new;
end $$;

drop trigger if exists trg_issuance_apply on public.issuances;
create trigger trg_issuance_apply
  after insert on public.issuances
  for each row execute function public.issuance_apply();

-- On delete: restore the stock (reversal) + log a reversing txn.
create or replace function public.issuance_reverse()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.item_id is not null then
    update public.inventory_items
      set qty_on_hand = qty_on_hand + old.qty
      where id = old.item_id;
    insert into public.inventory_txns(org_id, item_id, txn_type, qty, reference)
      values (old.org_id, old.item_id, 'receipt', old.qty,
              'REVERSAL of ' || coalesce(old.issue_no, 'issue'));
  end if;
  return old;
end $$;

drop trigger if exists trg_issuance_reverse on public.issuances;
create trigger trg_issuance_reverse
  after delete on public.issuances
  for each row execute function public.issuance_reverse();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.issuances enable row level security;
drop policy if exists issuances_read on public.issuances;
create policy issuances_read on public.issuances
  for select using (org_id in (select public.user_org_ids()));
drop policy if exists issuances_write on public.issuances;
create policy issuances_write on public.issuances
  for all using (public.has_org_role(org_id, array['owner','admin','manager','supervisor','operator']))
  with check (org_id in (select public.user_org_ids()));
