-- ============================================================================
--  WFS Enterprise — 0037 Role-based access · Phase B
--  Extends can_in_domain() enforcement to the remaining org-scoped data tables,
--  grouped by domain. Two write patterns:
--    • MANAGED tables → all writes require <domain>:edit.
--    • SELF-SERVICE tables → INSERT stays open to any tenant member (workers
--      request meals / callouts / mark their own absence); UPDATE/DELETE require
--      <domain>:edit. This preserves worker self-service while gating management.
--  Each table: drop ALL existing policies (names vary / ad-hoc), recreate a
--  tenant-scoped read + the appropriate write pattern. Skips system/bespoke
--  tables (org_members, audit_log, subscription_payments, etc.). Idempotent and
--  safe to re-run. Run after 0036.
-- ============================================================================

-- ── Helper: apply the MANAGED pattern to a table in a domain ────────────────
create or replace function public._rbac_managed(p_table text, p_domain text)
returns void language plpgsql as $$
declare pol record;
begin
  if not exists (select 1 from information_schema.tables
                 where table_schema='public' and table_name=p_table) then return; end if;
  execute format('alter table public.%I enable row level security;', p_table);
  for pol in select policyname from pg_policies where schemaname='public' and tablename=p_table loop
    execute format('drop policy if exists %I on public.%I;', pol.policyname, p_table);
  end loop;
  execute format('create policy %I on public.%I for select using (org_id in (select public.user_org_ids()));',
                 p_table||'_read', p_table);
  execute format(
    'create policy %I on public.%I for all '
    || 'using (public.can_in_domain(org_id, %L, ''edit'')) '
    || 'with check (public.can_in_domain(org_id, %L, ''edit''));',
    p_table||'_write', p_table, p_domain, p_domain);
end $$;

-- ── Helper: apply the SELF-SERVICE pattern (open insert, gated update/delete) ─
create or replace function public._rbac_selfservice(p_table text, p_domain text)
returns void language plpgsql as $$
declare pol record;
begin
  if not exists (select 1 from information_schema.tables
                 where table_schema='public' and table_name=p_table) then return; end if;
  execute format('alter table public.%I enable row level security;', p_table);
  for pol in select policyname from pg_policies where schemaname='public' and tablename=p_table loop
    execute format('drop policy if exists %I on public.%I;', pol.policyname, p_table);
  end loop;
  execute format('create policy %I on public.%I for select using (org_id in (select public.user_org_ids()));',
                 p_table||'_read', p_table);
  -- any tenant member may create their own record
  execute format('create policy %I on public.%I for insert with check (org_id in (select public.user_org_ids()));',
                 p_table||'_insert', p_table);
  -- editing / removing requires domain edit rights
  execute format('create policy %I on public.%I for update using (public.can_in_domain(org_id, %L, ''edit'')) with check (public.can_in_domain(org_id, %L, ''edit''));',
                 p_table||'_update', p_table, p_domain, p_domain);
  execute format('create policy %I on public.%I for delete using (public.can_in_domain(org_id, %L, ''edit''));',
                 p_table||'_delete', p_table, p_domain);
end $$;

-- ── Apply per domain ────────────────────────────────────────────────────────
do $$
declare t text;
  operations text[] := array[
    'assets','work_orders','inventory_items','inventory_txns','issuances',
    'suppliers','purchase_orders','purchase_order_lines','purchase_requests',
    'purchase_request_lines','requisitions','requisition_lines','goods_receipts','documents'];
  people_managed text[] := array[
    'employees','employee_shift_assignments','shift_patterns','shift_overrides',
    'leave_types','leave_adjustments','holidays',
    'food_vendors','menu_items','ir_concerns','ir_engagements'];
  people_selfservice text[] := array['food_orders','callout_requests','shift_absences','leave_requests'];
  finance text[] := array['gl_accounts','posting_rules','fiscal_settings','tax_settings','tax_bands','payroll'];
  safety text[] := array['safety_interactions','safety_targets','training_sessions','training_attendees'];
begin
  foreach t in array operations loop perform public._rbac_managed(t, 'operations'); end loop;
  foreach t in array people_managed loop perform public._rbac_managed(t, 'people'); end loop;
  foreach t in array people_selfservice loop perform public._rbac_selfservice(t, 'people'); end loop;
  foreach t in array finance loop perform public._rbac_managed(t, 'finance'); end loop;
  foreach t in array safety loop perform public._rbac_managed(t, 'safety'); end loop;
end $$;

-- clean up the helper functions (one-shot)
drop function if exists public._rbac_managed(text, text);
drop function if exists public._rbac_selfservice(text, text);

notify pgrst, 'reload schema';
