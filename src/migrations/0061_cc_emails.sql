-- ============================================================================
--  WFS Enterprise — 0061 CC emails on requests, purchase orders and invoices
--  Idempotent.
--
--  The app has always sent a "CC others" field (cc_emails) when saving a
--  purchase request, a purchase order or an invoice, and the email functions
--  (procurement-notify, invoice-send) read it — but the column was never
--  created, so those saves failed with "Could not find the 'cc_emails'
--  column ... in the schema cache". Comma-separated addresses, as typed.
-- ============================================================================

alter table public.purchase_requests add column if not exists cc_emails text;
alter table public.purchase_orders  add column if not exists cc_emails text;
alter table public.invoices         add column if not exists cc_emails text;

notify pgrst, 'reload schema';
