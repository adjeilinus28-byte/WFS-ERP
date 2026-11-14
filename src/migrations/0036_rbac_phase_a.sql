-- ============================================================================
--  WFS Enterprise — 0036 Role-based access · Phase A
--  Per-module ("domain") permissions layered over the base org role.
--   • member_permissions: sparse overrides (a row only when a user's access in a
--     domain differs from their base-role default).
--   • permission_level(org,user,domain): resolves override → else base-role
--     default → returns none|view|edit|manage.
--   • can_in_domain(org,domain,min): boolean used by BOTH RLS and the client.
--   • Hardens HIGH-VALUE tables (finance, safety, member mgmt) with role-aware
--     WITH CHECK — fixes an existing hole where the write policy's CHECK only
--     verified tenant, letting a viewer INSERT rows. Remaining tables follow in
--     Phase B. Run after 0035.
-- ============================================================================

-- ── Domain + level model ────────────────────────────────────────────────────
-- Domains: operations | people | finance | safety | admin
-- Levels : none(0) < view(1) < edit(2) < manage(3)

create table if not exists public.member_permissions (
  org_id  uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  domain  text not null,
  level   text not null check (level in ('none','view','edit','manage')),
  primary key (org_id, user_id, domain)
);
alter table public.member_permissions enable row level security;

-- Members can read permission rows in their org; only owners/admins may write them.
drop policy if exists mp_read on public.member_permissions;
create policy mp_read on public.member_permissions for select
  using (org_id in (select public.user_org_ids()));
drop policy if exists mp_write on public.member_permissions;
create policy mp_write on public.member_permissions for all
  using (public.has_org_role(org_id, array['owner','admin']))
  with check (public.has_org_role(org_id, array['owner','admin']));

-- ── Numeric rank for levels ─────────────────────────────────────────────────
create or replace function public.level_rank(p_level text)
returns int language sql immutable as $$
  select case p_level
    when 'manage' then 3 when 'edit' then 2 when 'view' then 1 else 0 end;
$$;

-- ── Base-role → default level for a domain ──────────────────────────────────
-- owner/admin: manage everywhere. manager: manage people/safety/operations,
-- edit finance, view admin. supervisor: edit operations/people/safety, view
-- finance. operator: edit operations, view rest. viewer: view all, edit none.
create or replace function public.base_role_level(p_role text, p_domain text)
returns text language sql immutable as $$
  select case
    when p_role in ('owner','admin') then 'manage'
    when p_role = 'manager' then case p_domain
      when 'finance' then 'edit' when 'admin' then 'view' else 'manage' end
    when p_role = 'supervisor' then case p_domain
      when 'finance' then 'view' when 'admin' then 'none' else 'edit' end
    when p_role = 'operator' then case p_domain
      when 'operations' then 'edit' when 'admin' then 'none' else 'view' end
    when p_role = 'viewer' then case p_domain
      when 'admin' then 'none' else 'view' end
    else 'none'
  end;
$$;

-- ── Effective level: override row if present, else base-role default ────────
create or replace function public.permission_level(p_org uuid, p_user uuid, p_domain text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select level from public.member_permissions
     where org_id = p_org and user_id = p_user and domain = p_domain),
    (select public.base_role_level(role, p_domain) from public.org_members
     where org_id = p_org and user_id = p_user),
    'none'
  );
$$;

-- ── The guard used everywhere: does the caller meet min level in a domain? ──
create or replace function public.can_in_domain(p_org uuid, p_domain text, p_min text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_owner()
      or public.level_rank(public.permission_level(p_org, auth.uid(), p_domain))
         >= public.level_rank(p_min);
$$;
grant execute on function public.can_in_domain(uuid, text, text) to authenticated;
grant execute on function public.permission_level(uuid, uuid, text) to authenticated;

-- ── Convenience RPC: my permission map for the active org (drives the client) ─
create or replace function public.my_permissions(p_org uuid)
returns table (domain text, level text)
language sql stable security definer set search_path = public as $$
  select d.domain, public.permission_level(p_org, auth.uid(), d.domain)
  from (values ('operations'),('people'),('finance'),('safety'),('admin')) as d(domain);
$$;
grant execute on function public.my_permissions(uuid) to authenticated;

-- ── Harden HIGH-VALUE tables with role-aware WITH CHECK ─────────────────────
-- Maps each protected table to its domain + the minimum level to write ('edit').
-- The WITH CHECK now requires BOTH tenant AND domain level, closing the insert
-- hole. USING mirrors it so update/delete are gated too. Read stays tenant-only.
-- Harden each high-value table: DROP EVERY existing policy on it (names unknown /
-- possibly created ad-hoc in the SQL Editor), then create a clean read + role-
-- aware write pair. Dropping all first guarantees no leftover permissive policy
-- combines via OR to re-open the hole.
do $$
declare
  t text;
  d text;
  pol record;
  pairs text[] := array[
    'journal_entries:finance','journal_lines:finance','bills:finance',
    'payments:finance','invoices:finance','hse_incidents:safety'
  ];
  entry text;
begin
  foreach entry in array pairs loop
    t := split_part(entry, ':', 1);
    d := split_part(entry, ':', 2);

    -- table might not exist in every deployment; skip if absent
    if not exists (select 1 from information_schema.tables
                   where table_schema='public' and table_name=t) then
      continue;
    end if;

    execute format('alter table public.%I enable row level security;', t);

    -- drop ALL policies currently on the table
    for pol in select policyname from pg_policies
               where schemaname='public' and tablename=t loop
      execute format('drop policy if exists %I on public.%I;', pol.policyname, t);
    end loop;

    -- read: tenant-scoped
    execute format(
      'create policy %I on public.%I for select using (org_id in (select public.user_org_ids()));',
      t||'_read', t);

    -- write: tenant AND domain level >= edit (closes the insert hole)
    execute format(
      'create policy %I on public.%I for all '
      || 'using (public.can_in_domain(org_id, %L, ''edit'')) '
      || 'with check (public.can_in_domain(org_id, %L, ''edit''));',
      t||'_write', t, d, d);
  end loop;
end $$;

notify pgrst, 'reload schema';
