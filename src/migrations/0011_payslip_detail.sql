-- ============================================================================
--  WFS Enterprise — 0011 Detailed Payslip (Pamicor template parity)
--  Adds shift/attendance header fields, itemised allowances, overtime lines,
--  and percentage-driven statutory deductions. Run after 0010.
-- ============================================================================

alter table public.payroll
  -- Header / shift info
  add column if not exists job_title        text,
  add column if not exists badge_no         text,
  add column if not exists no_of_shifts     numeric default 0,
  add column if not exists off_days         numeric default 0,
  add column if not exists leave_days        numeric default 0,
  add column if not exists attendance_pct   numeric default 100,
  add column if not exists monthly_basic    numeric default 0,
  add column if not exists daily_basic       numeric default 0,
  add column if not exists social_security_no text,
  add column if not exists social_security_status text,
  add column if not exists bank_name        text,
  -- Itemised earnings (beyond basic)
  add column if not exists salary_difference numeric default 0,
  add column if not exists mobile_credit    numeric default 0,
  add column if not exists transport_allowance numeric default 0,
  add column if not exists canteen_allowance numeric default 0,
  add column if not exists extra_duty_allowance numeric default 0,
  add column if not exists medical_allowance numeric default 0,
  add column if not exists fuel_allowance   numeric default 0,
  add column if not exists shift_overtime   numeric default 0,   -- 12-hr shift OT
  add column if not exists weekday_overtime numeric default 0,
  add column if not exists holiday_overtime numeric default 0,
  add column if not exists arrears_overtime numeric default 0,
  -- Percentage-driven deductions (rate stored so it recalcs if basis changes)
  add column if not exists ssnit_rate       numeric default 5.5,  -- % of basic (employee SSF)
  add column if not exists paye_amount      numeric default 0,    -- income tax
  add column if not exists overtime_tax     numeric default 0,
  add column if not exists union_dues_rate  numeric default 0,    -- % of basic
  add column if not exists union_dues       numeric default 0,
  add column if not exists rent_deduction   numeric default 0,
  add column if not exists ssnit_loan       numeric default 0,
  -- Employer side (informational)
  add column if not exists ssnit_employer_rate numeric default 13, -- %
  add column if not exists ssnit_employer   numeric default 0,
  add column if not exists taxable_income   numeric default 0;
