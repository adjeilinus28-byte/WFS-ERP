-- ============================================================================
--  WFS Enterprise — 0014 Document Kiosk
--  Adds a downloadable file + kiosk visibility to compliance documents, and a
--  shared storage bucket. The kiosk reads the same documents table, so status
--  (valid/expiring/expired) stays in sync with Compliance Documents. Run after 0013.
-- ============================================================================

alter table public.documents
  add column if not exists file_url    text,     -- downloadable document (signed URL)
  add column if not exists in_kiosk    boolean default true,   -- show in the field kiosk
  add column if not exists category    text,     -- SOP | permit | form | policy | safety | training
  add column if not exists description text;

-- Shared storage bucket for compliance / kiosk documents
insert into storage.buckets (id, name, public)
values ('compliance-files', 'compliance-files', false)
on conflict (id) do nothing;

drop policy if exists comp_files_read on storage.objects;
create policy comp_files_read on storage.objects
  for select using (bucket_id = 'compliance-files' and (storage.foldername(name))[1]::uuid in (select public.user_org_ids()));
drop policy if exists comp_files_write on storage.objects;
create policy comp_files_write on storage.objects
  for insert with check (bucket_id = 'compliance-files' and (storage.foldername(name))[1]::uuid in (select public.user_org_ids()));
drop policy if exists comp_files_update on storage.objects;
create policy comp_files_update on storage.objects
  for update using (bucket_id = 'compliance-files' and (storage.foldername(name))[1]::uuid in (select public.user_org_ids()));
drop policy if exists comp_files_delete on storage.objects;
create policy comp_files_delete on storage.objects
  for delete using (bucket_id = 'compliance-files' and (storage.foldername(name))[1]::uuid in (select public.user_org_ids()));

notify pgrst, 'reload schema';
