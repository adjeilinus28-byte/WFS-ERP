-- ============================================================================
--  WFS Enterprise — 0055 Letterhead contact details
--  Adds an office location and a second phone line to the organization profile
--  so printed documents and payslips carry a professional letterhead:
--    office_location  e.g. "Head office · Airport City, Accra"
--    address          (existing) postal / digital address, may be multi-line
--    contact_phone    (existing) main line
--    contact_phone_2  second line
--    contact_email    (existing)
--  update_org_profile() learns the two new fields. Idempotent. Run after 0054.
-- ============================================================================

alter table public.organizations
  add column if not exists office_location text,
  add column if not exists contact_phone_2 text;

create or replace function public.update_org_profile(p_org uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_org_role(p_org, array['owner','admin']) or public.is_platform_owner()) then
    raise exception 'insufficient privileges';
  end if;
  update public.organizations set
    name             = coalesce(p_patch->>'name', name),
    accent_color     = coalesce(p_patch->>'accent_color', accent_color),
    logo_url         = coalesce(p_patch->>'logo_url', logo_url),
    office_location  = coalesce(p_patch->>'office_location', office_location),
    address          = coalesce(p_patch->>'address', address),
    contact_email    = coalesce(p_patch->>'contact_email', contact_email),
    contact_phone    = coalesce(p_patch->>'contact_phone', contact_phone),
    contact_phone_2  = coalesce(p_patch->>'contact_phone_2', contact_phone_2),
    currency         = coalesce(p_patch->>'currency', currency),
    industry         = coalesce(p_patch->>'industry', industry),
    hse_head_email   = coalesce(p_patch->>'hse_head_email', hse_head_email),
    ops_head_email   = coalesce(p_patch->>'ops_head_email', ops_head_email),
    iro_email        = coalesce(p_patch->>'iro_email', iro_email),
    counsellor_email = coalesce(p_patch->>'counsellor_email', counsellor_email),
    wellbeing_note   = coalesce(p_patch->>'wellbeing_note', wellbeing_note),
    enabled_modules  = coalesce(p_patch->'enabled_modules', enabled_modules)
  where id = p_org;
end $$;
grant execute on function public.update_org_profile(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
