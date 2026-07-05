-- ============================================================================
--  WFS Enterprise — 0007 Employee bank details + refined sizing
--  Adds bank account fields, splits clothing sizing (top + trouser/waist),
--  and records the type of the uploaded ID document. Run after 0006.
-- ============================================================================

alter table public.employees
  -- Bank / payroll account
  add column if not exists bank_name        text,
  add column if not exists bank_branch      text,
  add column if not exists account_name     text,
  add column if not exists account_number   text,
  add column if not exists account_type     text,          -- savings | current | mobile_money
  add column if not exists mobile_money_no  text,
  -- Refined sizing
  add column if not exists top_size         text,          -- shirt / top
  add column if not exists trouser_waist    text,          -- waist size
  -- Type of the uploaded ID document
  add column if not exists id_document_type text;          -- ghana_card | passport | voter | drivers | ssnit

-- Migrate any legacy single dress_size into top_size so nothing is lost.
update public.employees
  set top_size = dress_size
  where top_size is null and dress_size is not null;
