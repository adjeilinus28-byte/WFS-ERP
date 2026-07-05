-- ============================================================================
--  WFS Enterprise — 0012 Invoice documents + email workflow
--  Adds document upload, customer email, and send-tracking to invoices.
--  Reuses a dedicated private 'invoice-files' storage bucket. Run after 0011.
-- ============================================================================

alter table public.invoices
  add column if not exists customer_email text,
  add column if not exists document_url  text,       -- uploaded invoice file (signed URL)
  add column if not exists sent          boolean default false,
  add column if not exists sent_at       timestamptz,
  add column if not exists approved_at   timestamptz,
  add column if not exists reference     text;        -- PO ref / customer ref

-- Ensure the 'notes' column exists (older tables may lack it)
alter table public.invoices add column if not exists notes text;

-- ── Private storage bucket for invoice documents ────────────────────────────
insert into storage.buckets (id, name, public)
values ('invoice-files', 'invoice-files', false)
on conflict (id) do nothing;

drop policy if exists inv_files_read on storage.objects;
create policy inv_files_read on storage.objects
  for select using (bucket_id = 'invoice-files' and (storage.foldername(name))[1]::uuid in (select public.user_org_ids()));
drop policy if exists inv_files_write on storage.objects;
create policy inv_files_write on storage.objects
  for insert with check (bucket_id = 'invoice-files' and (storage.foldername(name))[1]::uuid in (select public.user_org_ids()));
drop policy if exists inv_files_update on storage.objects;
create policy inv_files_update on storage.objects
  for update using (bucket_id = 'invoice-files' and (storage.foldername(name))[1]::uuid in (select public.user_org_ids()));
drop policy if exists inv_files_delete on storage.objects;
create policy inv_files_delete on storage.objects
  for delete using (bucket_id = 'invoice-files' and (storage.foldername(name))[1]::uuid in (select public.user_org_ids()));

notify pgrst, 'reload schema';
