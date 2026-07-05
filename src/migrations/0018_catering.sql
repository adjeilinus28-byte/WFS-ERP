-- ============================================================================
--  WFS Enterprise — 0018 Catering / Meal Ordering
--  Vendors + 14-day menus, weekly worker ordering with a 2-day per-day lock,
--  "no meal" + on-leave handling, allergies, auto-select fallback, and a
--  per-vendor/menu order dashboard. Run after 0017.
-- ============================================================================

-- ── Food vendors ────────────────────────────────────────────────────────────
create table if not exists public.food_vendors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  contact_name text,
  phone text,
  email text,
  cuisine text,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists fv_org_idx on public.food_vendors(org_id);

-- ── Menu items (per vendor, per service date, per meal type) ─────────────────
create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id uuid not null references public.food_vendors(id) on delete cascade,
  service_date date not null,
  meal_type text not null,              -- breakfast | lunch | dinner
  name text not null,
  description text,
  price numeric not null default 0,
  available boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists mi_lookup_idx on public.menu_items(org_id, service_date, meal_type);
create index if not exists mi_vendor_idx on public.menu_items(vendor_id, service_date);

-- ── Worker food orders (one per employee/date/meal) ─────────────────────────
create table if not exists public.food_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  employee_name text,
  department text,
  service_date date not null,
  meal_type text not null,              -- breakfast | lunch | dinner
  vendor_id uuid references public.food_vendors(id) on delete set null,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  item_name text,                       -- snapshot
  price numeric default 0,
  no_meal boolean not null default false,
  allergies text,
  auto_selected boolean not null default false,
  status text not null default 'placed', -- placed | auto | locked | cancelled
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists fo_uidx on public.food_orders(org_id, employee_id, service_date, meal_type);
create index if not exists fo_date_idx on public.food_orders(org_id, service_date);

-- ── Dashboard view: order counts per vendor / menu item for a date ──────────
create or replace view public.food_order_counts with (security_invoker = true) as
select
  o.org_id, o.service_date, o.meal_type, o.vendor_id, v.name as vendor_name,
  o.menu_item_id, o.item_name, count(*) as orders_placed,
  sum(o.price) as total_value
from public.food_orders o
left join public.food_vendors v on v.id = o.vendor_id
where o.no_meal = false and o.status <> 'cancelled'
group by o.org_id, o.service_date, o.meal_type, o.vendor_id, v.name, o.menu_item_id, o.item_name;

grant select on public.food_order_counts to authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Vendors + menus: managers/admins write; all members read.
do $$
declare t text;
  tbls text[] := array['food_vendors','menu_items'];
begin
  foreach t in array tbls loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I on public.%I;', t||'_read', t);
    execute format('create policy %I on public.%I for select using (org_id in (select public.user_org_ids()));', t||'_read', t);
    execute format('drop policy if exists %I on public.%I;', t||'_write', t);
    execute format('create policy %I on public.%I for all using (public.has_org_role(org_id, array[''owner'',''admin'',''manager'',''supervisor''])) with check (org_id in (select public.user_org_ids()));', t||'_write', t);
  end loop;
end $$;

-- Orders: any member of the org can read + write (workers place their own).
alter table public.food_orders enable row level security;
drop policy if exists fo_read on public.food_orders;
create policy fo_read on public.food_orders for select using (org_id in (select public.user_org_ids()));
drop policy if exists fo_write on public.food_orders;
create policy fo_write on public.food_orders for all
  using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()));

-- ── Seed a sample vendor + a few days of menu for Pamicor ───────────────────
do $$
declare org uuid; vend uuid; dnum int; d date;
begin
  select id into org from public.organizations where slug = 'pamicor';
  if org is not null then
    insert into public.food_vendors (org_id, name, contact_name, phone, cuisine)
    values (org, 'Mama Efua Kitchen', 'Efua Mensah', '024 000 0000', 'Ghanaian')
    on conflict do nothing
    returning id into vend;
    if vend is not null then
      for dnum in 0..13 loop
        d := current_date + dnum;
        insert into public.menu_items (org_id, vendor_id, service_date, meal_type, name, price) values
          (org, vend, d, 'breakfast', 'Tom Brown & Bread', 15),
          (org, vend, d, 'lunch', 'Jollof & Chicken', 35),
          (org, vend, d, 'lunch', 'Banku & Tilapia', 40),
          (org, vend, d, 'dinner', 'Fufu & Light Soup', 38);
      end loop;
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
