-- ============================================================================
--  WFS Enterprise — 0050 Ad-hoc payslip adjustment (back-pay / one-off)
--  A single general-purpose earning adjustment per payslip (can be negative for a
--  clawback). Its taxability is chosen per slip via adjustment_taxable — taxable
--  back-pay feeds PAYE; a non-taxable reimbursement does not. One-off DEDUCTIONS
--  are already covered by the existing other_deductions field.
--  Run after 0049.
-- ============================================================================

alter table public.payroll add column if not exists adjustment numeric default 0;
alter table public.payroll add column if not exists adjustment_taxable boolean default true;
alter table public.payroll add column if not exists adjustment_note text;

notify pgrst, 'reload schema';
