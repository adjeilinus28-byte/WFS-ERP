-- ============================================================================
--  WFS Enterprise — 0004 Work Order progress tracking
--  Adds a 0–100 completion percentage to work orders. Run after 0003.
-- ============================================================================

alter table public.work_orders
  add column if not exists progress integer not null default 0
    check (progress >= 0 and progress <= 100);

-- Backfill sensible values from existing status so the bars aren't all zero.
update public.work_orders set progress = case
  when status = 'done'        then 100
  when status = 'in_progress' then 50
  when status = 'on_hold'     then 25
  else 0
end
where progress = 0;
