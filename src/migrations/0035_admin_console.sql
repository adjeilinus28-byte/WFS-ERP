-- ============================================================================
--  WFS Enterprise — 0035 Commercial layer · Stage 4: super-admin console
--  Platform-owner-only RPCs to run the business: list every tenant with its
--  subscription state, manually extend / comp / suspend / reactivate an org,
--  and edit platform pricing. Every function is gated by is_platform_owner()
--  server-side, so the UI gate is defence-in-depth, not the only guard.
--  Run after 0034.
-- ============================================================================

-- ── 1. List all orgs with subscription + member/usage counts ───────────────
create or replace function public.admin_list_orgs()
returns table (
  id uuid, name text, slug text, industry text, currency text,
  status text, subscription_status text,
  trial_ends_at timestamptz, subscription_ends_at timestamptz,
  member_count bigint, created_at timestamptz,
  last_payment_at timestamptz, total_paid numeric
)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.slug, o.industry, o.currency,
         o.status, o.subscription_status,
         o.trial_ends_at, o.subscription_ends_at,
         (select count(*) from public.org_members m where m.org_id = o.id),
         o.created_at,
         (select max(sp.paid_at) from public.subscription_payments sp where sp.org_id = o.id),
         coalesce((select sum(sp.amount) from public.subscription_payments sp
                   where sp.org_id = o.id and sp.status = 'success'), 0)
  from public.organizations o
  where public.is_platform_owner()      -- returns no rows to non-owners
  order by o.created_at desc;
$$;
grant execute on function public.admin_list_orgs() to authenticated;

-- ── 2. Extend a subscription by N months (manual/offline payment) ──────────
create or replace function public.admin_extend_org(p_org uuid, p_months int)
returns void language plpgsql security definer set search_path = public as $$
declare base timestamptz;
begin
  if not public.is_platform_owner() then raise exception 'Not authorised'; end if;
  select greatest(now(), coalesce(subscription_ends_at, now())) into base
  from public.organizations where id = p_org;
  update public.organizations
  set subscription_status  = 'active',
      subscription_ends_at = base + (greatest(coalesce(p_months,1),1) || ' months')::interval
  where id = p_org;
end $$;
grant execute on function public.admin_extend_org(uuid, int) to authenticated;

-- ── 3. Comp an org (free, no expiry) or set a specific end date ────────────
create or replace function public.admin_set_org_plan(
  p_org uuid, p_status text, p_ends timestamptz default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_owner() then raise exception 'Not authorised'; end if;
  if p_status not in ('trial','active','expired','comped') then
    raise exception 'Invalid status';
  end if;
  update public.organizations
  set subscription_status  = p_status,
      subscription_ends_at = case
        when p_status = 'comped' then null
        when p_ends is not null   then p_ends
        else subscription_ends_at end
  where id = p_org;
end $$;
grant execute on function public.admin_set_org_plan(uuid, text, timestamptz) to authenticated;

-- ── 4. Suspend / reactivate (operational flag, separate from billing) ──────
create or replace function public.admin_set_org_status(p_org uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_owner() then raise exception 'Not authorised'; end if;
  if p_status not in ('active','suspended') then raise exception 'Invalid status'; end if;
  update public.organizations set status = p_status where id = p_org;
end $$;
grant execute on function public.admin_set_org_status(uuid, text) to authenticated;

-- ── 5. Update platform settings (price / currency / trial / paystack key) ──
create or replace function public.admin_update_settings(
  p_price numeric, p_currency text, p_trial_days int, p_paystack_public_key text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_owner() then raise exception 'Not authorised'; end if;
  update public.platform_settings
  set monthly_price = coalesce(p_price, monthly_price),
      currency      = coalesce(nullif(p_currency,''), currency),
      trial_days    = coalesce(p_trial_days, trial_days),
      paystack_public_key = coalesce(nullif(p_paystack_public_key,''), paystack_public_key),
      updated_at    = now()
  where id = 1;
end $$;
grant execute on function public.admin_update_settings(numeric, text, int, text) to authenticated;

notify pgrst, 'reload schema';
