-- ============================================================================
--  WFS Enterprise — 0034 Commercial layer · Stage 3a: expose subscription on
--  my_memberships() so the app can compute the gate + status chip without an
--  extra query. Adds three columns to the existing RPC's return set. Run after
--  0033. (Backward compatible: existing callers ignore the new columns.)
-- ============================================================================

create or replace function public.my_memberships()
returns table (
  org_id uuid, role text, department text,
  org_name text, slug text, industry text,
  accent_color text, logo_url text, currency text,
  enabled_modules jsonb, plan text, status text,
  is_owner boolean,
  -- new subscription fields
  subscription_status text, trial_ends_at timestamptz, subscription_ends_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select m.org_id, m.role, m.department,
         o.name, o.slug, o.industry,
         o.accent_color, o.logo_url, o.currency,
         o.enabled_modules, o.plan, o.status,
         public.is_platform_owner(),
         o.subscription_status, o.trial_ends_at, o.subscription_ends_at
  from public.org_members m
  join public.organizations o on o.id = m.org_id
  where m.user_id = auth.uid()
  order by o.name;
$$;

grant execute on function public.my_memberships() to authenticated;

notify pgrst, 'reload schema';
