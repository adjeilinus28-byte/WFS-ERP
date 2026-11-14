-- ============================================================================
--  WFS Enterprise — 0038 Team invitations
--  Owner/admin invites a person by email into THEIR org with a chosen role.
--  Claim flow (works whether the invitee already has an account or not):
--    1. create_invite(email, role) → row + token (owner/admin only).
--    2. Invitee opens /invite/<token>, signs in/up with that email.
--    3. accept_invite(token) verifies auth email == invite email, inserts the
--       org_members row with the invited role, marks the invite accepted.
--  Isolation: a leaked link can't be claimed by a different account (email must
--  match), membership is scoped to the invite's org+role, invites expire in 7
--  days and are single-use. Run after 0037.
-- ============================================================================

create table if not exists public.org_invitations (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  email      text not null,
  role       text not null default 'viewer',
  token      text not null unique default replace(gen_random_uuid()::text, '-', ''),
  status     text not null default 'pending',   -- pending | accepted | revoked
  invited_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days'
);
create index if not exists org_inv_org_idx   on public.org_invitations(org_id, status);
create index if not exists org_inv_email_idx on public.org_invitations(lower(email));

alter table public.org_invitations enable row level security;

-- Owners/admins manage invites for their org; nobody else can read them.
drop policy if exists inv_admin_all on public.org_invitations;
create policy inv_admin_all on public.org_invitations for all
  using (public.has_org_role(org_id, array['owner','admin']))
  with check (public.has_org_role(org_id, array['owner','admin']));

-- ── Create an invite (owner/admin only) → returns token ─────────────────────
create or replace function public.create_invite(p_org uuid, p_email text, p_role text)
returns text language plpgsql security definer set search_path = public as $$
declare tok text;
begin
  if not public.has_org_role(p_org, array['owner','admin']) then
    raise exception 'Only owners and admins can invite members';
  end if;
  if coalesce(btrim(p_email),'') = '' then
    raise exception 'Email is required';
  end if;
  if p_role not in ('admin','manager','supervisor','operator','viewer') then
    raise exception 'Invalid role';
  end if;

  -- If a pending invite already exists for this email+org, refresh it.
  update public.org_invitations
    set role = p_role, status = 'pending',
        token = replace(gen_random_uuid()::text, '-', ''),
        expires_at = now() + interval '7 days', invited_by = auth.uid()
  where org_id = p_org and lower(email) = lower(btrim(p_email)) and status = 'pending'
  returning token into tok;

  if tok is null then
    insert into public.org_invitations(org_id, email, role)
    values (p_org, btrim(p_email), p_role)
    returning token into tok;
  end if;
  return tok;
end $$;
grant execute on function public.create_invite(uuid, text, text) to authenticated;

-- ── Look up an invite by token (for the accept page to show org name) ───────
-- Returns minimal, non-sensitive info; only for a signed-in user whose email
-- matches, or an unauthenticated preview of org name + email target.
create or replace function public.invite_details(p_token text)
returns table (org_name text, email text, role text, status text, expired boolean)
language sql stable security definer set search_path = public as $$
  select o.name, i.email, i.role, i.status, (i.expires_at < now())
  from public.org_invitations i
  join public.organizations o on o.id = i.org_id
  where i.token = p_token;
$$;
grant execute on function public.invite_details(text) to authenticated, anon;

-- ── Accept an invite: the signed-in user (email must match) joins the org ───
create or replace function public.accept_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv public.org_invitations%rowtype; uid uuid := auth.uid(); uemail text;
begin
  if uid is null then raise exception 'Sign in to accept the invitation'; end if;
  select email into uemail from auth.users where id = uid;

  select * into inv from public.org_invitations where token = p_token;
  if not found then raise exception 'Invitation not found'; end if;
  if inv.status <> 'pending' then raise exception 'This invitation is no longer valid'; end if;
  if inv.expires_at < now() then raise exception 'This invitation has expired'; end if;

  -- The email on the invite must match the signed-in account (isolation guard).
  if lower(uemail) <> lower(inv.email) then
    raise exception 'This invitation was sent to a different email address';
  end if;

  -- Add the membership (idempotent — if already a member, just update role).
  insert into public.org_members(org_id, user_id, role, email)
  values (inv.org_id, uid, inv.role, uemail)
  on conflict (org_id, user_id) do update set role = excluded.role;

  update public.org_invitations set status = 'accepted' where id = inv.id;
  return inv.org_id;
end $$;
grant execute on function public.accept_invite(text) to authenticated;

notify pgrst, 'reload schema';
