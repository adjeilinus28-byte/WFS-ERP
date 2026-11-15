-- ============================================================================
--  WFS Enterprise — 0054 Audit trail
--  audit_log has existed since 0001 but nothing wrote to it. This records every
--  create, edit and delete on the main business tables, automatically, in the
--  database — so it can't be skipped by the app and can't be edited afterwards.
--
--   • audit_row(): AFTER trigger. Stores who (user id + email), what (table,
--     record id, a readable label), and for edits which fields changed plus any
--     status change. It never stores field VALUES other than status, so pay,
--     bank and ID data never land in the log.
--   • Clients can only read the log (owners and admins) — no insert/update/delete.
--   • Confidential tables (industrial relations) are deliberately not audited.
--  Idempotent. Run after 0053.
-- ============================================================================

create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r jsonb; o jsonb; org uuid; changed text[]; meta jsonb; label text;
begin
  begin
    r := to_jsonb(case when tg_op = 'DELETE' then old else new end);
    org := case when tg_table_name = 'organizations' then (r->>'id')::uuid else (r->>'org_id')::uuid end;
    -- Rows removed by an organization delete (cascade): the org is already gone.
    if org is null or not exists (select 1 from public.organizations where id = org) then
      return null;
    end if;

    label := coalesce(
      r->>'wo_number', r->>'invoice_no', r->>'bill_no', r->>'po_number', r->>'pr_number',
      r->>'incident_no', r->>'issue_no', r->>'asset_code', r->>'sku', r->>'entry_no',
      r->>'employee_no', r->>'reference', r->>'period');
    label := nullif(concat_ws(' · ', label,
      coalesce(r->>'name', r->>'full_name', r->>'employee_name', r->>'title', r->>'customer',
               r->>'supplier_name', r->>'item_name', r->>'email', r->>'memo', r->>'role')), '');

    meta := jsonb_build_object('label', left(label, 160),
                               'by', coalesce(auth.jwt()->>'email', 'system'));

    if tg_op = 'UPDATE' then
      o := to_jsonb(old);
      select array_agg(k order by k) into changed
      from jsonb_object_keys(r) k
      where k not in ('updated_at', 'created_at') and (r->k) is distinct from (o->k);
      if changed is null then return null; end if;           -- nothing really changed
      meta := meta || jsonb_build_object('changed', to_jsonb(changed));
      if (r->>'status') is distinct from (o->>'status') then
        meta := meta || jsonb_build_object('status_from', o->>'status', 'status_to', r->>'status');
      end if;
    elsif r ? 'status' then
      meta := meta || jsonb_build_object('status_to', r->>'status');
    end if;

    insert into public.audit_log(org_id, user_id, action, entity, entity_id, meta)
    values (org, auth.uid(),
            case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end,
            tg_table_name, coalesce(r->>'id', r->>'user_id'), meta);
  exception when others then
    null;   -- auditing must never block the business write
  end;
  return null;
end $$;

do $$
declare t text;
  audited text[] := array[
    'assets','work_orders','inventory_items','issuances','purchase_requests','purchase_orders',
    'goods_receipts','suppliers','employees','departments','leave_requests','leave_types',
    'leave_adjustments','payroll','overtime_entries','invoices','bills','payments',
    'journal_entries','gl_accounts','hse_incidents','safety_interactions','documents',
    'training_sessions','shift_patterns','employee_shift_assignments','callout_requests',
    'news_flash','org_members','org_invitations','member_permissions','role_dept_scope',
    'role_domain_defaults','tax_settings','tax_bands','payroll_settings','organizations'];
begin
  foreach t in array audited loop
    if not exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then continue; end if;
    execute format('drop trigger if exists trg_audit on public.%I;', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I
                    for each row execute function public.audit_row();', t);
  end loop;
end $$;

-- Read-only for clients, and only for people with admin access.
revoke insert, update, delete, truncate on public.audit_log from anon, authenticated;
revoke select on public.audit_log from anon;
alter table public.audit_log enable row level security;
drop policy if exists al_read on public.audit_log;
-- Owners and admins only: the log spans every department and names payroll and
-- employee records, so it must not follow the broader admin:view level
-- (managers have that by default) or bypass department scoping.
create policy al_read on public.audit_log for select using (
  public.is_platform_owner() or public.has_org_role(org_id, array['owner','admin'])
);
create index if not exists audit_log_entity_idx on public.audit_log(org_id, entity, created_at desc);

notify pgrst, 'reload schema';
