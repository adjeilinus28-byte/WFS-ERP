-- ============================================================================
--  WFS Enterprise — 0022 News Flash department targeting + email dispatch
--  Adds optional department targeting and email-send tracking. Run after 0021.
-- ============================================================================

alter table public.news_flash
  add column if not exists department text,        -- null = whole organisation
  add column if not exists notify_target text,     -- 'head' | 'supervisor' | null (no email)
  add column if not exists emailed_at timestamptz;

-- Banner read policy already scopes by org; department filtering is applied
-- client-side so a worker only sees org-wide items + items for their department.

notify pgrst, 'reload schema';

-- Department supervisor email (head_email already exists from 0016)
alter table public.departments add column if not exists supervisor_email text;

notify pgrst, 'reload schema';
