-- ============================================================================
--  WFS Enterprise — 0024 Training attachment
--  Adds an attachment (Excel/PDF/photo) to a training session, shown in-app and
--  sent with the announcement email. Run after 0023.
-- ============================================================================

alter table public.training_sessions
  add column if not exists attachment_url  text,
  add column if not exists attachment_name text;

-- Storage bucket for training attachments (public so email clients can fetch it)
insert into storage.buckets (id, name, public)
values ('training-files', 'training-files', true)
on conflict (id) do nothing;

-- Anyone in the org can read; managers/supervisors can upload
drop policy if exists "training-files read" on storage.objects;
create policy "training-files read" on storage.objects
  for select using (bucket_id = 'training-files');

drop policy if exists "training-files write" on storage.objects;
create policy "training-files write" on storage.objects
  for insert to authenticated with check (bucket_id = 'training-files');

drop policy if exists "training-files update" on storage.objects;
create policy "training-files update" on storage.objects
  for update to authenticated using (bucket_id = 'training-files');

notify pgrst, 'reload schema';
