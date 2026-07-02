-- ============================================================================
--  WFS Enterprise — 0005 Full Employee Profile
--  Expands employees with HR profile fields, next-of-kin, dependants,
--  sizing, and file attachment URLs (stored in the 'employee-files' bucket).
--  Run after 0004.
-- ============================================================================

alter table public.employees
  -- Contact & addresses
  add column if not exists home_address     text,
  add column if not exists postal_address   text,
  add column if not exists date_of_birth    date,
  add column if not exists gender            text,          -- male | female | other
  add column if not exists nationality       text,
  -- Family / personal
  add column if not exists marital_status    text,          -- single | married | divorced | widowed
  add column if not exists spouse_name       text,
  add column if not exists spouse_phone      text,
  add column if not exists number_of_kids    integer default 0,
  add column if not exists dependants        jsonb default '[]'::jsonb,  -- [{name, relation, dob}]
  -- Emergency contact / next of kin
  add column if not exists next_of_kin_name  text,
  add column if not exists next_of_kin_phone text,
  add column if not exists next_of_kin_relation text,
  -- Sizing (PPE / uniforms)
  add column if not exists dress_size        text,
  add column if not exists shoe_size         text,
  -- Government / identity
  add column if not exists id_type           text,          -- ghana_card | passport | voter | drivers
  add column if not exists id_number         text,
  add column if not exists ssnit_number      text,
  add column if not exists tin_number        text,
  -- File attachment URLs (Supabase Storage, tenant-scoped paths)
  add column if not exists photo_url         text,          -- passport picture
  add column if not exists contract_url      text,          -- contract letter
  add column if not exists id_document_url   text,          -- ID scan
  add column if not exists compliance_note   text,          -- non-compliance description
  add column if not exists compliance_url    text,          -- non-compliance letter
  add column if not exists notes             text;

-- ── Storage bucket for employee files (private; RLS-gated access) ────────────
insert into storage.buckets (id, name, public)
values ('employee-files', 'employee-files', false)
on conflict (id) do nothing;

-- Members of an org can read/write files under their own org's folder.
-- Path convention enforced by the app: {org_id}/{employee_id}/{filename}
drop policy if exists emp_files_read on storage.objects;
create policy emp_files_read on storage.objects
  for select using (
    bucket_id = 'employee-files'
    and (storage.foldername(name))[1]::uuid in (select public.user_org_ids())
  );

drop policy if exists emp_files_write on storage.objects;
create policy emp_files_write on storage.objects
  for insert with check (
    bucket_id = 'employee-files'
    and (storage.foldername(name))[1]::uuid in (select public.user_org_ids())
  );

drop policy if exists emp_files_update on storage.objects;
create policy emp_files_update on storage.objects
  for update using (
    bucket_id = 'employee-files'
    and (storage.foldername(name))[1]::uuid in (select public.user_org_ids())
  );

drop policy if exists emp_files_delete on storage.objects;
create policy emp_files_delete on storage.objects
  for delete using (
    bucket_id = 'employee-files'
    and (storage.foldername(name))[1]::uuid in (select public.user_org_ids())
  );
