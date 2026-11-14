-- ============================================================================
--  WFS Enterprise — 0041 Domain expansion · Phase E  (5 → 8 permission domains)
--  Splits permission domains to match the sidebar sections:
--    operations   → Assets, Work Orders (maintenance) only
--    supply_chain → Inventory, Procurement, Issuance, Requisitions, Suppliers (NEW)
--    people       → Workforce, Shifts, Leave, Catering, Relations
--    finance      → Financials, Accounts, Payroll
--    compliance   → HSE + Training (renamed from 'safety')  (NEW name)
--    approvals    → Approvals inbox actions                  (NEW, no own tables)
--    insight      → Reports (read-only)                      (NEW, no own tables)
--    admin        → Settings, Team
--  Re-maps 17 tables' RLS to the new domains and teaches base_role_level the new
--  domains. Defaults preserve intent (supply_chain≈operations, compliance≈safety)
--  so existing behavior is essentially unchanged until an owner customizes.
--  Run after 0040.
-- ============================================================================

-- ── 1. Teach base_role_level the new domains ───────────────────────────────
create or replace function public.base_role_level(p_role text, p_domain text)
returns text language sql immutable as $$
  select case
    when p_role in ('owner','admin') then 'manage'

    when p_role = 'manager' then case p_domain
      when 'finance' then 'edit'
      when 'insight' then 'view'
      when 'admin'   then 'view'
      else 'manage' end                       -- operations, supply_chain, people, compliance, approvals

    when p_role = 'supervisor' then case p_domain
      when 'finance'   then 'view'
      when 'insight'   then 'view'
      when 'approvals' then 'view'
      when 'admin'     then 'none'
      else 'edit' end                         -- operations, supply_chain, people, compliance

    when p_role = 'operator' then case p_domain
      when 'operations'   then 'edit'
      when 'supply_chain' then 'edit'
      when 'insight'      then 'none'
      when 'approvals'    then 'none'
      when 'admin'        then 'none'
      else 'view' end                         -- people, finance, compliance

    when p_role = 'viewer' then case p_domain
      when 'insight'   then 'none'
      when 'approvals' then 'none'
      when 'admin'     then 'none'
      else 'view' end

    else 'none'
  end;
$$;

-- ── 2. Update my_permissions + org_role_matrix to the new domain set ───────
create or replace function public.my_permissions(p_org uuid)
returns table (domain text, level text)
language sql stable security definer set search_path = public as $$
  select d.domain, public.permission_level(p_org, auth.uid(), d.domain)
  from (values ('operations'),('supply_chain'),('people'),('finance'),
               ('compliance'),('approvals'),('insight'),('admin')) as d(domain);
$$;

create or replace function public.org_role_matrix(p_org uuid)
returns table (role text, domain text, level text, is_custom boolean)
language sql stable security definer set search_path = public as $$
  select r.role, d.domain,
         coalesce(rdd.level, public.base_role_level(r.role, d.domain)) as level,
         (rdd.level is not null) as is_custom
  from (values ('admin'),('manager'),('supervisor'),('operator'),('viewer')) as r(role)
  cross join (values ('operations'),('supply_chain'),('people'),('finance'),
                     ('compliance'),('approvals'),('insight'),('admin')) as d(domain)
  left join public.role_domain_defaults rdd
    on rdd.org_id = p_org and rdd.role = r.role and rdd.domain = d.domain
  where public.has_org_role(p_org, array['owner','admin'])
  order by
    case r.role when 'admin' then 1 when 'manager' then 2 when 'supervisor' then 3
                when 'operator' then 4 when 'viewer' then 5 else 6 end,
    case d.domain when 'operations' then 1 when 'supply_chain' then 2 when 'people' then 3
                  when 'finance' then 4 when 'compliance' then 5 when 'approvals' then 6
                  when 'insight' then 7 when 'admin' then 8 else 9 end;
$$;

-- Accept the new domain names in set_role_default's validation.
create or replace function public.set_role_default(p_org uuid, p_role text, p_domain text, p_level text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_org_role(p_org, array['owner','admin']) then
    raise exception 'Only owners and admins can change role defaults';
  end if;
  if p_role not in ('admin','manager','supervisor','operator','viewer') then
    raise exception 'Cannot redefine the % tier', p_role;
  end if;
  if p_domain not in ('operations','supply_chain','people','finance','compliance','approvals','insight','admin') then
    raise exception 'Invalid domain';
  end if;
  if p_level is null then
    delete from public.role_domain_defaults
    where org_id = p_org and role = p_role and domain = p_domain;
  else
    if p_level not in ('none','view','edit','manage') then raise exception 'Invalid level'; end if;
    insert into public.role_domain_defaults(org_id, role, domain, level)
    values (p_org, p_role, p_domain, p_level)
    on conflict (org_id, role, domain) do update set level = excluded.level;
  end if;
end $$;

-- ── 3. Migrate existing custom overrides from old domain names ──────────────
-- Any org that customized 'safety' should keep that as 'compliance'. (No orgs
-- have supply_chain rows yet — those were 'operations', which stays valid for
-- Assets/WO; per-table RLS below handles the split.)
update public.role_domain_defaults set domain = 'compliance' where domain = 'safety';

-- ── 4. Re-map the 17 tables' RLS to their new domains ──────────────────────
-- Reuses the Phase C combined gate: read = tenant + can_see_dept; write =
-- can_in_domain(new_domain,'edit') + can_edit_dept. Preserves self-service inserts.
do $$
declare
  entry text; t text; dom text; selfsvc boolean; hasdept boolean;
  pol record;
  -- table:new_domain:selfservice
  specs text[] := array[
    -- operations (unchanged domain, but re-assert clean policies)
    'assets:operations:0','work_orders:operations:0',
    -- supply_chain (moved from operations)
    'inventory_items:supply_chain:0','inventory_txns:supply_chain:0','issuances:supply_chain:0',
    'suppliers:supply_chain:0','purchase_orders:supply_chain:0','purchase_order_lines:supply_chain:0',
    'purchase_requests:supply_chain:0','purchase_request_lines:supply_chain:0',
    'requisitions:supply_chain:0','requisition_lines:supply_chain:0','goods_receipts:supply_chain:0',
    'documents:supply_chain:0',
    -- compliance (moved from safety)
    'hse_incidents:compliance:0','safety_interactions:compliance:0','safety_targets:compliance:0',
    'training_sessions:compliance:0','training_attendees:compliance:0'
  ];
begin
  foreach entry in array specs loop
    t   := split_part(entry,':',1);
    dom := split_part(entry,':',2);
    selfsvc := split_part(entry,':',3) = '1';
    if not exists (select 1 from information_schema.tables
                   where table_schema='public' and table_name=t) then continue; end if;

    -- does this table have a department column? (drives whether dept gate applies)
    select exists (select 1 from information_schema.columns
                   where table_schema='public' and table_name=t and column_name='department')
      into hasdept;

    execute format('alter table public.%I enable row level security;', t);
    for pol in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy if exists %I on public.%I;', pol.policyname, t);
    end loop;

    if hasdept then
      execute format(
        'create policy %I on public.%I for select using ('
        || 'org_id in (select public.user_org_ids()) and public.can_see_dept(org_id, department));',
        t||'_read', t);
      execute format(
        'create policy %I on public.%I for all using ('
        || 'public.can_in_domain(org_id, %L, ''edit'') and public.can_edit_dept(org_id, department)) '
        || 'with check (public.can_in_domain(org_id, %L, ''edit'') and public.can_edit_dept(org_id, department));',
        t||'_write', t, dom, dom);
    else
      -- org-wide table (no department): tenant read + domain-only write
      execute format(
        'create policy %I on public.%I for select using (org_id in (select public.user_org_ids()));',
        t||'_read', t);
      execute format(
        'create policy %I on public.%I for all '
        || 'using (public.can_in_domain(org_id, %L, ''edit'')) '
        || 'with check (public.can_in_domain(org_id, %L, ''edit''));',
        t||'_write', t, dom, dom);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
