-- ============================================================================
--  WFS Enterprise — 0026 Tax & Deductions settings
--  Graduated PAYE bands + statutory rates, per organisation and country.
--  Seeded with Ghana (GRA) values — VERIFY against current GRA guidance, as
--  rates are amended by Finance Acts. All values are editable in the UI.
--  Run after 0025.
-- ============================================================================

-- ── Per-org statutory rates ─────────────────────────────────────────────────
create table if not exists public.tax_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  country text not null default 'GH',
  auto_calculate boolean not null default true,

  -- Social security
  ssnit_employee_rate numeric not null default 5.5,   -- % of basic
  ssnit_employer_rate numeric not null default 13.0,  -- % of basic (informational)
  union_dues_rate     numeric not null default 0,     -- % of basic

  -- Overtime tax (Ghana: qualifying junior staff)
  overtime_tax_enabled       boolean not null default true,
  overtime_threshold_pct     numeric not null default 50,   -- % of monthly basic
  overtime_rate_within       numeric not null default 5,    -- % on portion within threshold
  overtime_rate_excess       numeric not null default 10,   -- % on portion above threshold

  -- Bonus tax (Ghana: final tax on qualifying bonus)
  bonus_tax_enabled     boolean not null default true,
  bonus_threshold_pct   numeric not null default 15,  -- % of ANNUAL basic
  bonus_rate            numeric not null default 5,   -- % final tax within threshold

  notes text,
  updated_at timestamptz not null default now()
);

-- ── Graduated PAYE bands (monthly, ordered) ─────────────────────────────────
create table if not exists public.tax_bands (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  country text not null default 'GH',
  band_order int not null,
  band_amount numeric,          -- width of this band; NULL = "remainder" (top band)
  rate numeric not null,        -- %
  created_at timestamptz not null default now()
);
create unique index if not exists tb_uidx on public.tax_bands(org_id, country, band_order);

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.tax_settings enable row level security;
drop policy if exists tax_read on public.tax_settings;
create policy tax_read on public.tax_settings for select using (org_id in (select public.user_org_ids()));
drop policy if exists tax_write on public.tax_settings;
create policy tax_write on public.tax_settings for all
  using (public.has_org_role(org_id, array['owner','admin']))
  with check (org_id in (select public.user_org_ids()));

alter table public.tax_bands enable row level security;
drop policy if exists tb_read on public.tax_bands;
create policy tb_read on public.tax_bands for select using (org_id in (select public.user_org_ids()));
drop policy if exists tb_write on public.tax_bands;
create policy tb_write on public.tax_bands for all
  using (public.has_org_role(org_id, array['owner','admin']))
  with check (org_id in (select public.user_org_ids()));

-- ── Seed Ghana defaults for every existing org that has none ────────────────
-- NOTE: monthly GRA graduated bands. VERIFY against the current GRA schedule.
do $$
declare o record;
begin
  for o in select id from public.organizations loop
    insert into public.tax_settings (org_id, country)
    values (o.id, 'GH')
    on conflict (org_id) do nothing;

    if not exists (select 1 from public.tax_bands where org_id = o.id and country = 'GH') then
      insert into public.tax_bands (org_id, country, band_order, band_amount, rate) values
        (o.id, 'GH', 1,   490.00,  0),
        (o.id, 'GH', 2,   110.00,  5),
        (o.id, 'GH', 3,   130.00,  10),
        (o.id, 'GH', 4,  3166.67,  17.5),
        (o.id, 'GH', 5, 16000.00,  25),
        (o.id, 'GH', 6, 30520.00,  30),
        (o.id, 'GH', 7,     null,  35);   -- remainder
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

-- Payroll: store the bonus tax alongside PAYE and overtime tax
alter table public.payroll add column if not exists bonus_tax numeric default 0;

notify pgrst, 'reload schema';
