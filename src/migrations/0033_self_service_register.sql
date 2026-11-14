-- ============================================================================
--  WFS Enterprise — 0033 Commercial layer · Stage 2: self-service registration
--  Adds register_org(): an authenticated user with NO existing membership can
--  stand up their own org and become its owner. Mirrors provision_org's insert
--  pattern (so the new tenant is isolated identically) but drops the platform-
--  owner gate and adds guards that keep it safe:
--    • caller must be signed in
--    • caller must not already belong to any org (one self-serve org per user)
--    • slug is generated + de-duplicated server-side
--  The 30-day trial trigger (0032) fires automatically on the org insert.
--  Isolation is unchanged: the user sees only the org they were just added to,
--  because every data policy keys off org_members via user_org_ids().
--  Run after 0032.
-- ============================================================================

create or replace function public.register_org(
  p_name      text,
  p_industry  text default 'general',
  p_full_name text default null,
  p_currency  text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid      uuid := auth.uid();
  base     text;
  new_slug text;
  n        int := 0;
  new_org  uuid;
  def_ccy  text;
begin
  if uid is null then
    raise exception 'Must be signed in to register an organization';
  end if;

  -- One self-service org per user. (Platform owners use provision_org / the
  -- super-admin console to create additional orgs.)
  if exists (select 1 from public.org_members where user_id = uid) then
    raise exception 'This account already belongs to an organization';
  end if;

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Organization name is required';
  end if;

  -- slugify: lowercase, non-alnum -> '-', trim dashes
  base := regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g');
  base := regexp_replace(base, '(^-+|-+$)', '', 'g');
  if base = '' then base := 'org'; end if;

  -- de-duplicate slug
  new_slug := base;
  while exists (select 1 from public.organizations where slug = new_slug) loop
    n := n + 1;
    new_slug := base || '-' || n::text;
  end loop;

  -- default currency from platform settings unless the caller chose one
  select currency into def_ccy from public.platform_settings where id = 1;

  insert into public.organizations (name, slug, industry, currency)
  values (btrim(p_name), new_slug, coalesce(p_industry, 'general'),
          coalesce(p_currency, def_ccy, 'USD'))
  returning id into new_org;
  -- trg_start_org_trial has now stamped a 30-day trial on this row.

  insert into public.org_members (org_id, user_id, role, full_name, email)
  values (new_org, uid, 'owner', p_full_name,
          (select email from auth.users where id = uid));

  return new_org;
end $$;

grant execute on function public.register_org(text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
