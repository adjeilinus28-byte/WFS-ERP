-- ============================================================================
--  WFS Enterprise — 0046 Recurring pay allowances on the employee
--  Adds a flexible list of standing allowances (site, clothing, and free-text
--  "other") to each employee's pay setup, so they flow onto payslips without
--  re-entry. Stored as jsonb: [{ label, amount }]. Mirrors the existing
--  dependants jsonb pattern. Run after 0045.
-- ============================================================================

alter table public.employees
  add column if not exists pay_allowances jsonb default '[]'::jsonb;  -- [{label, amount}]

notify pgrst, 'reload schema';
