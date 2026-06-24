-- ============================================================================
--  WFS Enterprise — 0001 Core Platform
--  Multi-tenant foundation: organizations, members, RBAC, white-label, RLS.
--  Run in the Supabase SQL Editor (project ref: wucvejrenltzinhamgmx).
--
--  RLS design notes (hard-won across WFS products):
--   * org_members self-policy uses ONLY user_id = auth.uid() — NO helper
--     function calls, or RLS recurses on itself.
--   * All other tenant tables gate on public.user_org_ids(), a SECURITY DEFINER
--     function that reads org_members with RLS bypassed (no recursion).
--   * Membership is loaded client-side via the my_memberships() RPC and the
--     auth callback must NOT await Supabase calls (deadlock) — defer instead.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── Platform owners allowlist (WFS staff who can provision tenants) ─────────
create table if not exists public.platform_owners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
-- Seed Linus (WFS founder). Replace/extend as needed.
insert into public.platform_owners (user_id)
values ('d2d2b04b-af67-4963-a979-f705c0fa06e1')
on conflict do nothing;

-- ── Organizations (tenants) ────────────────────────────────────────────────
create table if not exists public.organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text unique not null,
  industry      text not null default 'general',          -- mining | oil_gas | manufacturing | logistics | general
  -- white-label
  accent_color  text not null default '#F59E0B',          -- per-tenant accent (hex)
  logo_url      text,
  -- profile
  address       text,
  country       text default 'GH',
  currency      text not null default 'GHS',
  timezone      text not null default 'Africa/Accra',
  contact_email text,
  contact_phone text,
  -- which ERP modules this tenant has switched on (drives nav + routing)
  enabled_modules jsonb not null default
    '["dashboard","assets","inventory","procurement","work_orders","workforce","hse","reports","settings"]'::jsonb,
  -- subscription (Paystack, GHS)
  plan          text not null default 'trial',             -- trial | standard | enterprise
  status        text not null default 'active',            -- active | suspended
  created_at    timestamptz not null default now()
);

-- ── Organization membership + roles ────────────────────────────────────────
-- role hierarchy: owner > admin > manager > supervisor > operator > viewer
create table if not exists public.org_members (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'viewer',
  department text,
  full_name  text,
  email      text,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists org_members_user_idx on public.org_members(user_id);

-- ── Audit log ───────────────────────────────────────────────────────────────
create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  org_id     uuid references public.organizations(id) on delete cascade,
  user_id    uuid,
  action     text not null,
  entity     text,
  entity_id  text,
  meta       jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_org_idx on public.audit_log(org_id, created_at desc);

-- ============================================================================
--  RLS helper functions (SECURITY DEFINER — bypass RLS, prevent recursion)
-- ============================================================================
create or replace function public.user_org_ids()
returns setof uuid
language sql stable security definer set search_path = public as $$
  select org_id from public.org_members where user_id = auth.uid();
$$;

create or replace function public.has_org_role(p_org uuid, p_roles text[])
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.org_members
    where org_id = p_org and user_id = auth.uid() and role = any(p_roles)
  );
$$;

create or replace function public.is_platform_owner()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_owners where user_id = auth.uid());
$$;

-- Single client-side entry point. Deadlock-safe usage: never await this
-- inside onAuthStateChange — call it from a deferred setTimeout(...,0).
create or replace function public.my_memberships()
returns table (
  org_id uuid, role text, department text,
  org_name text, slug text, industry text,
  accent_color text, logo_url text, currency text,
  enabled_modules jsonb, plan text, status text,
  is_owner boolean
)
language sql stable security definer set search_path = public as $$
  select m.org_id, m.role, m.department,
         o.name, o.slug, o.industry,
         o.accent_color, o.logo_url, o.currency,
         o.enabled_modules, o.plan, o.status,
         public.is_platform_owner()
  from public.org_members m
  join public.organizations o on o.id = m.org_id
  where m.user_id = auth.uid()
  order by o.name;
$$;

-- ============================================================================
--  RLS policies
-- ============================================================================
alter table public.platform_owners enable row level security;
alter table public.organizations  enable row level security;
alter table public.org_members    enable row level security;
alter table public.audit_log       enable row level security;

-- platform_owners: readable only to owners (via the definer fn, no direct read)
drop policy if exists po_self on public.platform_owners;
create policy po_self on public.platform_owners
  for select using (user_id = auth.uid());

-- organizations: members can read their orgs; owners/admins can update profile
drop policy if exists org_read on public.organizations;
create policy org_read on public.organizations
  for select using (id in (select public.user_org_ids()) or public.is_platform_owner());

drop policy if exists org_update on public.organizations;
create policy org_update on public.organizations
  for update using (public.has_org_role(id, array['owner','admin']) or public.is_platform_owner());

-- org_members: SELF-POLICY MUST BE DIRECT (no helper fn) to avoid recursion
drop policy if exists om_self on public.org_members;
create policy om_self on public.org_members
  for select using (user_id = auth.uid());

-- admins can see the full member roster of their org (definer fn = safe)
drop policy if exists om_admin_read on public.org_members;
create policy om_admin_read on public.org_members
  for select using (public.has_org_role(org_id, array['owner','admin','manager']));

drop policy if exists om_admin_write on public.org_members;
create policy om_admin_write on public.org_members
  for all using (public.has_org_role(org_id, array['owner','admin']))
  with check (public.has_org_role(org_id, array['owner','admin']));

-- audit_log: members read their org's trail; insert via definer fn below
drop policy if exists al_read on public.audit_log;
create policy al_read on public.audit_log
  for select using (org_id in (select public.user_org_ids()));

-- ── Provisioning + profile RPCs ─────────────────────────────────────────────
-- Invite-only: only platform owners may stand up a new tenant.
create or replace function public.provision_org(
  p_name text, p_slug text, p_industry text default 'general',
  p_owner uuid default auth.uid()
) returns uuid
language plpgsql security definer set search_path = public as $$
declare new_org uuid;
begin
  if not public.is_platform_owner() then
    raise exception 'Only WFS platform owners may provision organizations';
  end if;
  insert into public.organizations(name, slug, industry)
  values (p_name, p_slug, p_industry) returning id into new_org;
  insert into public.org_members(org_id, user_id, role)
  values (new_org, p_owner, 'owner');
  return new_org;
end $$;

create or replace function public.update_org_profile(
  p_org uuid, p_patch jsonb
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_org_role(p_org, array['owner','admin']) or public.is_platform_owner()) then
    raise exception 'insufficient privileges';
  end if;
  update public.organizations set
    name            = coalesce(p_patch->>'name', name),
    accent_color    = coalesce(p_patch->>'accent_color', accent_color),
    logo_url        = coalesce(p_patch->>'logo_url', logo_url),
    address         = coalesce(p_patch->>'address', address),
    contact_email   = coalesce(p_patch->>'contact_email', contact_email),
    contact_phone   = coalesce(p_patch->>'contact_phone', contact_phone),
    currency        = coalesce(p_patch->>'currency', currency),
    industry        = coalesce(p_patch->>'industry', industry),
    enabled_modules = coalesce(p_patch->'enabled_modules', enabled_modules)
  where id = p_org;
end $$;

grant execute on function public.my_memberships()                 to authenticated;
grant execute on function public.user_org_ids()                   to authenticated;
grant execute on function public.has_org_role(uuid, text[])       to authenticated;
grant execute on function public.is_platform_owner()              to authenticated;
grant execute on function public.provision_org(text,text,text,uuid) to authenticated;
grant execute on function public.update_org_profile(uuid, jsonb)  to authenticated;
