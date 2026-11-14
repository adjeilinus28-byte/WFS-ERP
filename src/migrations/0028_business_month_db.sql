-- ============================================================================
--  WFS Enterprise — 0028 Business month at the database level
--  The app's business calendar month runs 21st→20th, labelled by the ending
--  month (21 Jun–20 Jul = '2026-07'). The frontend already uses this via
--  lib/period.js; this migration brings the DB views into line so KPIs computed
--  in SQL match what users see everywhere else. Run after 0027.
-- ============================================================================

-- business_month(date) -> 'YYYY-MM' key of the business month a date falls in.
create or replace function public.business_month(d date)
returns text language sql immutable as $$
  select to_char(
    case when extract(day from d) >= 21
         then (date_trunc('month', d) + interval '1 month')
         else date_trunc('month', d)
    end, 'YYYY-MM');
$$;

-- Convenience: the current business month key.
create or replace function public.current_business_month()
returns text language sql stable as $$
  select public.business_month(current_date);
$$;

-- ── Rebuild safety_kpi on the business month ────────────────────────────────
create or replace view public.safety_kpi with (security_invoker = true) as
select
  s.org_id, s.observer_id, s.observer_name, s.observer_role, s.form_type,
  public.current_business_month() as period,
  count(*) filter (
    where public.business_month(s.observed_on) = public.current_business_month()
  ) as done_this_month
from public.safety_interactions s
where s.observer_name is not null
group by s.org_id, s.observer_id, s.observer_name, s.observer_role, s.form_type;

grant select on public.safety_kpi to authenticated;

-- ── Rebuild ir_category_stats on the business month ─────────────────────────
-- 0019 grouped by calendar month (date_trunc). Align to the 21st–20th cycle.
-- `month` is returned as the business-month START date (21st) so existing
-- consumers that treat it as a date still work.
create or replace view public.ir_category_stats with (security_invoker = true) as
select
  org_id, category, severity, status,
  count(*) as cases,
  (to_date(public.business_month(created_at::date), 'YYYY-MM') - interval '1 month' + interval '20 days')::date as month
from public.ir_concerns
group by org_id, category, severity, status, public.business_month(created_at::date);

grant select on public.ir_category_stats to authenticated;

notify pgrst, 'reload schema';
