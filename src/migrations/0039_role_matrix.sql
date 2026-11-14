-- ============================================================================
--  WFS Enterprise — 0039 Org-configurable role permission matrix (Option A)
--  Lets each org redefine what the six FIXED access tiers (owner/admin/manager/
--  supervisor/operator/viewer) get by DEFAULT in each domain — without changing
--  the tier vocabulary the security engine depends on.
--
--  New resolution chain in permission_level():
--    1. member override           (member_permissions — per person)   [0036]
--    2. ORG role default          (role_domain_defaults — per org)    [NEW]
--    3. built-in base_role_level  (hardcoded fallback)                [0036]
--    4. 'none'
--  So an org can say "our supervisors get finance:edit" and it applies to every
--  supervisor in that org, while a per-person override still wins over it.
--  Run after 0038.
-- ============================================================================

-- Sparse per-org overrides of a tier's default level in a domain. A row exists
-- only where the org differs from the built-in default; absent → built-in.
create table if not exists public.role_domain_defaults (
  org_id uuid not null references public.organizations(id) on delete cascade,
  role   text not null,
  domain text not null,
  level  text not null check (level in ('none','view','edit','manage')),
  primary key (org_id, role, domain)
);
alter table public.role_domain_defaults enable row level security;

-- Members read their org's matrix (needed so the client can resolve levels);
-- only owners/admins write it.
drop policy if exists rdd_read on public.role_domain_defaults;
create policy rdd_read on public.role_domain_defaults for select
  using (org_id in (select public.user_org_ids()));
drop policy if exists rdd_write on public.role_domain_defaults;
create policy rdd_write on public.role_domain_defaults for all
  using (public.has_org_role(org_id, array['owner','admin']))
  with check (public.has_org_role(org_id, array['owner','admin']));

-- ── Extend the resolver: insert the org-default layer ───────────────────────
create or replace function public.permission_level(p_org uuid, p_user uuid, p_domain text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    -- 1. per-person override
    (select level from public.member_permissions
     where org_id = p_org and user_id = p_user and domain = p_domain),
    -- 2. org's default for this member's tier + domain
    (select rdd.level from public.role_domain_defaults rdd
     join public.org_members m on m.org_id = rdd.org_id and m.user_id = p_user
     where rdd.org_id = p_org and rdd.role = m.role and rdd.domain = p_domain),
    -- 3. built-in default for the tier
    (select public.base_role_level(role, p_domain) from public.org_members
     where org_id = p_org and user_id = p_user),
    'none'
  );
$$;

-- ── Read the full effective matrix for an org (drives the editor UI) ────────
-- For each tier×domain, returns the effective level and whether it's a custom
-- org override (vs the built-in default), so the UI can show "Default" vs a value.
create or replace function public.org_role_matrix(p_org uuid)
returns table (role text, domain text, level text, is_custom boolean)
language sql stable security definer set search_path = public as $$
  select r.role, d.domain,
         coalesce(rdd.level, public.base_role_level(r.role, d.domain)) as level,
         (rdd.level is not null) as is_custom
  from (values ('admin'),('manager'),('supervisor'),('operator'),('viewer')) as r(role)
  cross join (values ('operations'),('people'),('finance'),('safety'),('admin')) as d(domain)
  left join public.role_domain_defaults rdd
    on rdd.org_id = p_org and rdd.role = r.role and rdd.domain = d.domain
  where public.has_org_role(p_org, array['owner','admin'])   -- editor is admin-only
  order by
    case r.role when 'admin' then 1 when 'manager' then 2 when 'supervisor' then 3
                when 'operator' then 4 when 'viewer' then 5 else 6 end,
    case d.domain when 'operations' then 1 when 'people' then 2 when 'finance' then 3
                  when 'safety' then 4 when 'admin' then 5 else 6 end;
$$;
grant execute on function public.org_role_matrix(uuid) to authenticated;

-- ── Set / clear one cell of the matrix (owner/admin only) ───────────────────
-- p_level = null clears the override (revert to built-in default).
create or replace function public.set_role_default(p_org uuid, p_role text, p_domain text, p_level text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_org_role(p_org, array['owner','admin']) then
    raise exception 'Only owners and admins can change role defaults';
  end if;
  if p_role not in ('admin','manager','supervisor','operator','viewer') then
    raise exception 'Cannot redefine the % tier', p_role;   -- owner is never editable
  end if;
  if p_domain not in ('operations','people','finance','safety','admin') then
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
grant execute on function public.set_role_default(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
