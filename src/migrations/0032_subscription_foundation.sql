-- ============================================================================
--  WFS Enterprise — 0032 Commercial layer · Stage 1: subscription foundation
--  Adds trial/subscription dates, a platform_settings row (price/currency/trial
--  length/Paystack key), a payments ledger, and a trigger that starts a 30-day
--  free trial the moment an org is created (no card required). Existing orgs
--  (Pamicor etc.) are backfilled to a long active subscription so nothing they
--  do is disrupted. Run after 0031.
-- ============================================================================

-- ── 1. Subscription dates on organizations ─────────────────────────────────
-- (plan + status columns already exist from 0001.)
alter table public.organizations
  add column if not exists trial_ends_at        timestamptz,
  add column if not exists subscription_ends_at timestamptz,
  add column if not exists subscription_status  text not null default 'trial';
    -- subscription_status: trial | active | expired | comped
    -- (distinct from the older `status` = active|suspended operational flag)

-- ── 2. Platform settings (single row, id = 1) ──────────────────────────────
create table if not exists public.platform_settings (
  id            int primary key default 1,
  monthly_price numeric not null default 0,
  currency      text    not null default 'USD',
  trial_days    int     not null default 30,
  paystack_public_key text,
  updated_at    timestamptz not null default now(),
  constraint platform_settings_singleton check (id = 1)
);
insert into public.platform_settings (id, monthly_price, currency, trial_days)
values (1, 0, 'USD', 30)
on conflict (id) do nothing;

-- ── 3. Subscription payments ledger ────────────────────────────────────────
create table if not exists public.subscription_payments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  amount       numeric not null,
  currency     text not null default 'USD',
  reference    text unique,              -- Paystack reference (idempotency)
  status       text not null default 'success',
  months       int not null default 1,   -- how many months this payment covers
  paid_by      text,
  paid_at      timestamptz not null default now()
);
create index if not exists sub_pay_org_idx on public.subscription_payments(org_id, paid_at desc);

-- ── 4. Auto-start a 30-day trial on org creation ───────────────────────────
create or replace function public.start_org_trial()
returns trigger language plpgsql as $$
declare days int;
begin
  -- Only start a trial for orgs created in the default 'trial' state. Manual
  -- provisioning (super-admin) inserts with an explicit 'active'/'comped' status
  -- and its own end date, so we leave those untouched.
  if new.subscription_status = 'trial' and new.trial_ends_at is null then
    select coalesce(trial_days, 30) into days from public.platform_settings where id = 1;
    new.trial_ends_at := now() + (days || ' days')::interval;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_start_org_trial on public.organizations;
create trigger trg_start_org_trial
  before insert on public.organizations
  for each row execute function public.start_org_trial();

-- ── 5. Is an org currently entitled to use the platform? ───────────────────
create or replace function public.org_is_active(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organizations o
    where o.id = p_org
      and o.status <> 'suspended'
      and (
        o.subscription_status = 'comped'
        or (o.subscription_status = 'trial'  and coalesce(o.trial_ends_at, now())        > now())
        or (o.subscription_status = 'active' and coalesce(o.subscription_ends_at, now())  > now())
      )
  );
$$;
grant execute on function public.org_is_active(uuid) to authenticated;

-- ── 6. Extend a subscription after a successful payment (idempotent) ───────
-- Called by the Paystack webhook (service role). Adds N months from the later
-- of now() or the current end date, and flips status to active.
create or replace function public.apply_subscription_payment(
  p_org uuid, p_amount numeric, p_currency text, p_reference text, p_months int, p_paid_by text
) returns void language plpgsql security definer set search_path = public as $$
declare base timestamptz;
begin
  -- idempotency: skip if this reference is already recorded
  if exists (select 1 from public.subscription_payments where reference = p_reference) then
    return;
  end if;

  insert into public.subscription_payments (org_id, amount, currency, reference, months, paid_by)
  values (p_org, p_amount, p_currency, p_reference, coalesce(p_months,1), p_paid_by);

  select greatest(now(), coalesce(subscription_ends_at, now())) into base
  from public.organizations where id = p_org;

  update public.organizations
  set subscription_status  = 'active',
      subscription_ends_at = base + (coalesce(p_months,1) || ' months')::interval
  where id = p_org;
end;
$$;
-- not granted to authenticated: only the service-role webhook calls it.

-- ── 7. RLS ─────────────────────────────────────────────────────────────────
alter table public.platform_settings     enable row level security;
alter table public.subscription_payments enable row level security;

-- platform_settings: everyone signed in may READ (price/trial shown on Subscribe);
-- only platform owners may write.
drop policy if exists ps_read on public.platform_settings;
create policy ps_read on public.platform_settings for select using (auth.role() = 'authenticated');
drop policy if exists ps_write on public.platform_settings;
create policy ps_write on public.platform_settings for all
  using (public.is_platform_owner()) with check (public.is_platform_owner());

-- subscription_payments: an org's members can read their own; owners read all.
drop policy if exists sp_read on public.subscription_payments;
create policy sp_read on public.subscription_payments for select
  using (org_id in (select public.user_org_ids()) or public.is_platform_owner());

-- ── 8. Backfill existing orgs to a long active subscription ────────────────
-- Existing tenants (Pamicor + any others) must not be disrupted or trial-gated.
-- Target ONLY pre-existing orgs: rows created before this migration have both
-- date columns NULL (the trial trigger only fires on future inserts). This makes
-- the backfill safe to re-run — it can never convert a genuine future trial.
update public.organizations
set subscription_status  = 'active',
    subscription_ends_at = now() + interval '10 years',
    trial_ends_at        = now() + interval '10 years'
where trial_ends_at is null
  and subscription_ends_at is null;

notify pgrst, 'reload schema';
