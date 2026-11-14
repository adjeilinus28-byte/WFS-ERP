-- ============================================================================
--  WFS Enterprise — 0029 Close the Procure-to-Pay loop
--  PO → Bill → Payment without re-keying:
--   1. create_bill_from_po(po_id): idempotent RPC to raise a payable from a PO
--      that was accepted in person/phone (the email-accept path already does
--      this in po-supplier-response). Copies supplier, amount, currency, links
--      bill_id back on the PO.
--   2. A trigger so an outbound payment linked to a bill updates that bill's
--      status (partial / paid) from the sum of payments — no manual status flip.
--  Ledger posting for bills already exists (Financials → Sync ledger); this
--  migration adds the payment leg's data integrity. Run after 0028.
-- ============================================================================

-- ── 0. Reconcile bills columns the app writes (defensive; no-ops if present) ─
-- The Accounts bills form and the email-accept path write supplier/tax/total.
-- 0003 only defined supplier_name/amount, so add the app's columns if missing.
alter table public.bills add column if not exists supplier text;
alter table public.bills add column if not exists tax     numeric default 0;
alter table public.bills add column if not exists total   numeric default 0;
-- Backfill supplier from supplier_name and total from amount where empty.
update public.bills set supplier = coalesce(supplier, supplier_name) where supplier is null;
update public.bills set total = coalesce(nullif(total,0), amount) where coalesce(total,0) = 0;

-- ── 1. Raise a bill from a purchase order (idempotent) ──────────────────────
create or replace function public.create_bill_from_po(p_po uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  po        public.purchase_orders%rowtype;
  new_bill  uuid;
  sup_name  text;
begin
  select * into po from public.purchase_orders where id = p_po;
  if not found then
    raise exception 'Purchase order not found';
  end if;

  -- permission: caller must be a writer on the PO's org
  if not public.has_org_role(po.org_id, array['owner','admin','manager']) then
    raise exception 'Not authorised';
  end if;

  -- already linked → return the existing bill (idempotent)
  if po.bill_id is not null then
    return po.bill_id;
  end if;

  select name into sup_name from public.suppliers where id = po.supplier_id;

  insert into public.bills (
    org_id, bill_no, supplier_id, supplier_name, supplier, category,
    issue_date, amount, tax, total, status, currency, notes
  ) values (
    po.org_id,
    'BILL-' || regexp_replace(coalesce(po.po_number, 'PO'), '[^0-9A-Za-z]', '', 'g'),
    po.supplier_id, sup_name, sup_name, 'parts',
    current_date, coalesce(po.total, 0), 0, coalesce(po.total, 0),
    'received', coalesce(po.currency, 'GHS'),
    'Raised from PO ' || coalesce(po.po_number, '')
  )
  returning id into new_bill;

  update public.purchase_orders set bill_id = new_bill where id = p_po;
  return new_bill;
end;
$$;

grant execute on function public.create_bill_from_po(uuid) to authenticated;

-- ── 2. Payments settle their linked bill automatically ──────────────────────
-- When an outbound payment references a bill, recompute that bill's paid total
-- and set status: paid (>= amount), partial (>0), else leave as received.
create or replace function public.sync_bill_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b        public.bills%rowtype;
  paid_sum numeric;
  target   uuid;
begin
  target := coalesce(new.bill_id, old.bill_id);
  if target is null then
    return coalesce(new, old);
  end if;

  select * into b from public.bills where id = target;
  if not found then
    return coalesce(new, old);
  end if;

  select coalesce(sum(amount), 0) into paid_sum
  from public.payments
  where bill_id = target and direction = 'out';

  update public.bills
  set status = case
        when paid_sum >= coalesce(nullif(b.total,0), b.amount, 0)
             and coalesce(nullif(b.total,0), b.amount, 0) > 0 then 'paid'
        when paid_sum > 0 then 'partial'
        else b.status
      end
  where id = target;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sync_bill_payment on public.payments;
create trigger trg_sync_bill_payment
  after insert or update or delete on public.payments
  for each row execute function public.sync_bill_payment();

notify pgrst, 'reload schema';
