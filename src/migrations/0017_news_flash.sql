-- ============================================================================
--  WFS Enterprise — 0017 News Flash
--  Announcements, campaigns, and notices shown as a rotating banner + a feed
--  on the Command Deck. Run after 0016.
-- ============================================================================

create table if not exists public.news_flash (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  body text,
  category text default 'announcement',   -- announcement | campaign | event | alert | policy
  priority text default 'normal',          -- low | normal | high
  link_url text,
  link_label text,
  starts_on date default current_date,
  ends_on date,
  pinned boolean default false,
  active boolean default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists nf_org_idx on public.news_flash(org_id, created_at desc);

alter table public.news_flash enable row level security;
drop policy if exists nf_read on public.news_flash;
create policy nf_read on public.news_flash
  for select using (org_id in (select public.user_org_ids()));
drop policy if exists nf_write on public.news_flash;
create policy nf_write on public.news_flash
  for all using (public.has_org_role(org_id, array['owner','admin','manager']))
  with check (org_id in (select public.user_org_ids()));

-- Seed a welcome item for Pamicor
do $$
declare org uuid;
begin
  select id into org from public.organizations where slug = 'pamicor';
  if org is not null then
    insert into public.news_flash (org_id, title, body, category, priority, pinned)
    values (org, 'Welcome to WFS Enterprise', 'Your operations platform is live. Post announcements and campaigns here for the whole team.', 'announcement', 'normal', true)
    on conflict do nothing;
  end if;
end $$;

notify pgrst, 'reload schema';
