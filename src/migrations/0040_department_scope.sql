-- ============================================================================
--  WFS Enterprise — 0040 Department scoping · Phase C  (role × department)
--  Adds the department axis to the access model. Each role in an org gets a
--  department scope:
--    'all'      → sees & edits every department            (default; = today)
--    'own_edit' → sees ALL departments, edits only its own (coordination)
--    'own_only' → sees & edits ONLY its own department      (strict segregation)
--  A member's "own" department is org_members.department. Rows with a NULL/blank
--  department are org-wide (visible & editable to all) — so company-wide records
--  (e.g. org-wide training, unassigned assets) are never hidden.
--
--  Enforcement helpers layer on top of the existing tenant + can_in_domain gates.
--  Applied to 15 departmental tables via drop-all-then-recreate (same discipline
--  as Phase A/B). Defaults to 'all', so existing orgs are unchanged until an
--  owner opts a role into scoping. Owners / platform owners are never scoped.
--  Run after 0039.
-- ============================================================================

-- ── Per-org, per-role department scope ──────────────────────────────────────
create table if not exists public.role_dept_scope (
  org_id uuid not null references public.organizations(id) on delete cascade,
  role   text not null,
  scope  text not null default 'all' check (scope in ('all','own_edit','own_only')),
  primary key (org_id, role)
);
alter table public.role_dept_scope enable row level security;

drop policy if exists rds_read on public.role_dept_scope;
create policy rds_read on public.role_dept_scope for select
  using (org_id in (select public.user_org_ids()));
drop policy if exists rds_write on public.role_dept_scope;
create policy rds_write on public.role_dept_scope for all
  using (public.has_org_role(org_id, array['owner','admin']))
  with check (public.has_org_role(org_id, array['owner','admin']));

-- ── The caller's scope + home department in an org ──────────────────────────
create or replace function public.my_dept_scope(p_org uuid)
returns table (scope text, home_dept text)
language sql stable security definer set search_path = public as $$
  select
    coalesce(
      (select rds.scope from public.role_dept_scope rds
       join public.org_members m on m.org_id = rds.org_id and m.user_id = auth.uid()
       where rds.org_id = p_org and rds.role = m.role),
      'all'
    ),
    (select department from public.org_members
     where org_id = p_org and user_id = auth.uid());
$$;

-- ── Can the caller SEE a row in this department? ────────────────────────────
-- all / own_edit → see everything. own_only → only own dept (+ null dept rows).
-- Owners & platform owners always see all. A member with no home dept is treated
-- as 'all' (can't scope someone who has no department — avoids lockout).
create or replace function public.can_see_dept(p_org uuid, p_row_dept text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare s text; home text;
begin
  if public.is_platform_owner() then return true; end if;
  if public.has_org_role(p_org, array['owner']) then return true; end if;
  select scope, home_dept into s, home from public.my_dept_scope(p_org);
  if s is null or s <> 'own_only' then return true; end if;      -- all / own_edit see all
  if home is null then return true; end if;                       -- unscopable → see all
  if p_row_dept is null or btrim(p_row_dept) = '' then return true; end if; -- org-wide row
  return lower(p_row_dept) = lower(home);
end $$;
grant execute on function public.can_see_dept(uuid, text) to authenticated;

-- ── Can the caller WRITE a row in this department? ──────────────────────────
-- own_edit & own_only → only own dept (+ null dept rows). all → any dept.
create or replace function public.can_edit_dept(p_org uuid, p_row_dept text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare s text; home text;
begin
  if public.is_platform_owner() then return true; end if;
  if public.has_org_role(p_org, array['owner']) then return true; end if;
  select scope, home_dept into s, home from public.my_dept_scope(p_org);
  if s is null or s = 'all' then return true; end if;            -- global role
  if home is null then return true; end if;                       -- unscopable → allow
  if p_row_dept is null or btrim(p_row_dept) = '' then return true; end if; -- org-wide row
  return lower(p_row_dept) = lower(home);
end $$;
grant execute on function public.can_edit_dept(uuid, text) to authenticated;

-- ── Matrix editor support: read/set a role's department scope ───────────────
create or replace function public.org_dept_scopes(p_org uuid)
returns table (role text, scope text)
language sql stable security definer set search_path = public as $$
  select r.role, coalesce(rds.scope, 'all')
  from (values ('admin'),('manager'),('supervisor'),('operator'),('viewer')) as r(role)
  left join public.role_dept_scope rds on rds.org_id = p_org and rds.role = r.role
  where public.has_org_role(p_org, array['owner','admin'])
  order by case r.role when 'admin' then 1 when 'manager' then 2 when 'supervisor' then 3
                       when 'operator' then 4 else 5 end;
$$;
grant execute on function public.org_dept_scopes(uuid) to authenticated;

create or replace function public.set_dept_scope(p_org uuid, p_role text, p_scope text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_org_role(p_org, array['owner','admin']) then
    raise exception 'Only owners and admins can change department scope';
  end if;
  if p_role not in ('admin','manager','supervisor','operator','viewer') then
    raise exception 'Cannot scope the % tier', p_role;
  end if;
  if p_scope not in ('all','own_edit','own_only') then raise exception 'Invalid scope'; end if;

  if p_scope = 'all' then
    delete from public.role_dept_scope where org_id = p_org and role = p_role;  -- 'all' = no row
  else
    insert into public.role_dept_scope(org_id, role, scope)
    values (p_org, p_role, p_scope)
    on conflict (org_id, role) do update set scope = excluded.scope;
  end if;
end $$;
grant execute on function public.set_dept_scope(uuid, text, text) to authenticated;

-- ── Apply department gates to the 15 departmental tables ────────────────────
-- Combines with the existing domain gate: read requires can_see_dept; write
-- requires the domain's edit right AND can_edit_dept. Self-service tables keep
-- their open INSERT (workers submit their own record in any dept).
do $$
declare
  entry text; t text; dom text; selfsvc boolean;
  pol record;
  -- table:domain:selfservice
  specs text[] := array[
    'assets:operations:0','work_orders:operations:0','issuances:operations:0',
    'purchase_requests:operations:0','requisitions:operations:0',
    'hse_incidents:safety:0','safety_interactions:safety:0',
    'training_sessions:safety:0','training_attendees:safety:0',
    'ir_concerns:people:0','employees:people:0','payroll:finance:0',
    'leave_requests:people:1','callout_requests:people:1','food_orders:people:1'
  ];
begin
  foreach entry in array specs loop
    t   := split_part(entry,':',1);
    dom := split_part(entry,':',2);
    selfsvc := split_part(entry,':',3) = '1';
    if not exists (select 1 from information_schema.tables
                   where table_schema='public' and table_name=t) then continue; end if;

    execute format('alter table public.%I enable row level security;', t);
    for pol in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy if exists %I on public.%I;', pol.policyname, t);
    end loop;

    -- READ: tenant + department visibility
    execute format(
      'create policy %I on public.%I for select using ('
      || 'org_id in (select public.user_org_ids()) and public.can_see_dept(org_id, department));',
      t||'_read', t);

    if selfsvc then
      -- INSERT open to any tenant member (self-service submit, any dept)
      execute format(
        'create policy %I on public.%I for insert with check (org_id in (select public.user_org_ids()));',
        t||'_insert', t);
      -- UPDATE/DELETE: domain edit right + own-dept write rule
      execute format(
        'create policy %I on public.%I for update using ('
        || 'public.can_in_domain(org_id, %L, ''edit'') and public.can_edit_dept(org_id, department)) '
        || 'with check (public.can_in_domain(org_id, %L, ''edit'') and public.can_edit_dept(org_id, department));',
        t||'_update', t, dom, dom);
      execute format(
        'create policy %I on public.%I for delete using ('
        || 'public.can_in_domain(org_id, %L, ''edit'') and public.can_edit_dept(org_id, department));',
        t||'_delete', t, dom);
    else
      -- managed table: all writes need domain edit + dept write rule
      execute format(
        'create policy %I on public.%I for all using ('
        || 'public.can_in_domain(org_id, %L, ''edit'') and public.can_edit_dept(org_id, department)) '
        || 'with check (public.can_in_domain(org_id, %L, ''edit'') and public.can_edit_dept(org_id, department));',
        t||'_write', t, dom, dom);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
