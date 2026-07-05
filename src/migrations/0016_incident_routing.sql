-- ============================================================================
--  WFS Enterprise — 0016 Incident notification routing
--  Adds head emails so HSE incidents can auto-notify: head of HSE, head of
--  Operations, and the head of the department where it occurred. Run after 0015.
-- ============================================================================

-- Department head email (for department-of-incident routing)
alter table public.departments add column if not exists head_email text;

-- Org-level safety routing addresses
alter table public.organizations
  add column if not exists hse_head_email  text,
  add column if not exists ops_head_email  text;

-- Ensure incidents carry a department + notified flag
alter table public.hse_incidents
  add column if not exists department text,
  add column if not exists notified  boolean default false;

notify pgrst, 'reload schema';

-- Extend the org profile RPC to allow saving the safety routing emails
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
    hse_head_email  = coalesce(p_patch->>'hse_head_email', hse_head_email),
    ops_head_email  = coalesce(p_patch->>'ops_head_email', ops_head_email),
    enabled_modules = coalesce(p_patch->'enabled_modules', enabled_modules)
  where id = p_org;
end $$;

grant execute on function public.update_org_profile(uuid, jsonb) to authenticated;
