-- ============================================================================
--  WFS Enterprise — 0019 Industrial Relations & Employee Wellbeing
--  Anonymous concern drop-box (case ID + access code), IRO classification &
--  referral to a counsellor, confidential counsellor engagement, and weekly
--  digests. Access is tightly scoped to protect confidentiality. Run after 0018.
-- ============================================================================

-- Designate the IRO and counsellor for the org
alter table public.organizations
  add column if not exists iro_email        text,
  add column if not exists counsellor_email text,
  add column if not exists wellbeing_note   text;   -- org's EAP / support message

-- ── Concerns (the drop box) ─────────────────────────────────────────────────
create table if not exists public.ir_concerns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  case_id text not null,                 -- human-friendly, e.g. IR-8F3K2Q
  access_code text not null,             -- private code the worker keeps
  anonymous boolean not null default true,
  employee_id uuid references public.employees(id) on delete set null, -- null if anonymous
  employee_name text,                    -- only if identified
  contact_email text,                    -- optional, for updates even when anonymous
  department text,
  subject text not null,
  details text,
  -- IRO classification
  category text,                         -- harassment | pay | workload | safety | interpersonal | wellbeing | other
  severity text default 'normal',        -- low | normal | high | urgent
  status text not null default 'new',    -- new | reviewing | classified | referred | in_counselling | resolved | closed
  -- Counsellor referral
  referred_to_counsellor boolean default false,
  referred_at timestamptz,
  consent_reveal boolean default false,  -- worker consents to share identity with counsellor
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists irc_case_uidx on public.ir_concerns(case_id);
create index if not exists irc_org_idx on public.ir_concerns(org_id, created_at desc);

-- ── Engagement thread (IRO / counsellor / worker) ───────────────────────────
create table if not exists public.ir_engagements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  concern_id uuid not null references public.ir_concerns(id) on delete cascade,
  author_role text not null,             -- iro | counsellor | worker | system
  author_name text,
  kind text not null default 'message',  -- message | note | call_request | status
  body text,
  created_at timestamptz not null default now()
);
create index if not exists ire_concern_idx on public.ir_engagements(concern_id, created_at);

-- ── Role helpers (email-based designation) ──────────────────────────────────
create or replace function public.is_ir_officer(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.organizations o
    where o.id = p_org and o.iro_email is not null
      and lower(o.iro_email) = lower(coalesce(auth.jwt()->>'email','')));
$$;
create or replace function public.is_counsellor(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.organizations o
    where o.id = p_org and o.counsellor_email is not null
      and lower(o.counsellor_email) = lower(coalesce(auth.jwt()->>'email','')));
$$;

-- ── RLS: confidentiality-first ──────────────────────────────────────────────
alter table public.ir_concerns enable row level security;
-- Any member may submit a concern
drop policy if exists irc_insert on public.ir_concerns;
create policy irc_insert on public.ir_concerns for insert
  with check (org_id in (select public.user_org_ids()));
-- Only owner/admin, the IRO, or the counsellor (referred cases only) may read
drop policy if exists irc_read on public.ir_concerns;
create policy irc_read on public.ir_concerns for select using (
  public.has_org_role(org_id, array['owner','admin'])
  or public.is_ir_officer(org_id)
  or (public.is_counsellor(org_id) and referred_to_counsellor = true)
);
-- Owner/admin/IRO may update (classify, refer, resolve); counsellor may update referred cases
drop policy if exists irc_update on public.ir_concerns;
create policy irc_update on public.ir_concerns for update using (
  public.has_org_role(org_id, array['owner','admin'])
  or public.is_ir_officer(org_id)
  or (public.is_counsellor(org_id) and referred_to_counsellor = true)
);

alter table public.ir_engagements enable row level security;
drop policy if exists ire_read on public.ir_engagements;
create policy ire_read on public.ir_engagements for select using (
  public.has_org_role(org_id, array['owner','admin'])
  or public.is_ir_officer(org_id)
  or public.is_counsellor(org_id)
);
drop policy if exists ire_write on public.ir_engagements;
create policy ire_write on public.ir_engagements for insert with check (
  public.has_org_role(org_id, array['owner','admin'])
  or public.is_ir_officer(org_id)
  or public.is_counsellor(org_id)
);

-- ── Anonymous worker access via case_id + access_code (bypasses RLS safely) ──
-- Look up own case + thread without revealing identity to anyone.
create or replace function public.ir_lookup(p_case_id text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.ir_concerns; thread jsonb;
begin
  select * into c from public.ir_concerns where case_id = p_case_id and access_code = p_code;
  if not found then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('author_role', e.author_role, 'kind', e.kind, 'body', e.body, 'created_at', e.created_at) order by e.created_at), '[]'::jsonb)
    into thread from public.ir_engagements e where e.concern_id = c.id and e.kind in ('message','call_request','status');
  return jsonb_build_object(
    'case_id', c.case_id, 'subject', c.subject, 'status', c.status, 'category', c.category,
    'referred', c.referred_to_counsellor, 'consent_reveal', c.consent_reveal,
    'created_at', c.created_at, 'thread', thread);
end $$;

-- Worker replies to their own case thread (anonymous-safe)
create or replace function public.ir_worker_reply(p_case_id text, p_code text, p_body text)
returns boolean language plpgsql security definer set search_path = public as $$
declare c public.ir_concerns;
begin
  select * into c from public.ir_concerns where case_id = p_case_id and access_code = p_code;
  if not found then return false; end if;
  insert into public.ir_engagements(org_id, concern_id, author_role, author_name, kind, body)
    values (c.org_id, c.id, 'worker', 'Worker', 'message', p_body);
  update public.ir_concerns set updated_at = now() where id = c.id;
  return true;
end $$;

-- Worker consents to reveal identity to the counsellor
create or replace function public.ir_worker_consent(p_case_id text, p_code text, p_name text, p_email text)
returns boolean language plpgsql security definer set search_path = public as $$
declare c public.ir_concerns;
begin
  select * into c from public.ir_concerns where case_id = p_case_id and access_code = p_code;
  if not found then return false; end if;
  update public.ir_concerns
    set consent_reveal = true,
        employee_name = coalesce(p_name, employee_name),
        contact_email = coalesce(p_email, contact_email),
        updated_at = now()
    where id = c.id;
  insert into public.ir_engagements(org_id, concern_id, author_role, kind, body)
    values (c.org_id, c.id, 'system', 'status', 'Worker consented to share their identity with the counsellor.');
  return true;
end $$;

grant execute on function public.ir_lookup(text,text) to authenticated, anon;
grant execute on function public.ir_worker_reply(text,text,text) to authenticated, anon;
grant execute on function public.ir_worker_consent(text,text,text,text) to authenticated, anon;

-- Category analytics view (no personal data — safe for IRO trends)
create or replace view public.ir_category_stats with (security_invoker = true) as
select org_id, category, severity, status, count(*) as cases,
       date_trunc('month', created_at)::date as month
from public.ir_concerns
group by org_id, category, severity, status, date_trunc('month', created_at);

grant select on public.ir_category_stats to authenticated;

notify pgrst, 'reload schema';

-- Extend org profile RPC to save IR settings
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
    iro_email       = coalesce(p_patch->>'iro_email', iro_email),
    counsellor_email = coalesce(p_patch->>'counsellor_email', counsellor_email),
    wellbeing_note  = coalesce(p_patch->>'wellbeing_note', wellbeing_note),
    enabled_modules = coalesce(p_patch->'enabled_modules', enabled_modules)
  where id = p_org;
end $$;

grant execute on function public.update_org_profile(uuid, jsonb) to authenticated;
