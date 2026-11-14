-- ============================================================================
--  WFS Enterprise — 0052 Security hardening
--  Fixes access-control gaps found in a security review of 0001–0051.
--  Idempotent and safe to re-run. Run after 0051.
--
--   1. Industrial Relations confidentiality restored (0037/0040 had opened
--      ir_concerns / ir_engagements — incl. access codes — to every member).
--   2. apply_subscription_payment() callable only by the service role.
--   3. No direct UPDATE on organizations (billing columns were admin-editable);
--      profile edits keep working through update_org_profile().
--   4. Admins can no longer create, promote to, edit or demote owners.
--   5. accept_invite() never downgrades an existing owner.
--   6. Self-service inserts can't arrive pre-approved (leave, callouts, meals).
--   7. Overtime: only approvals:manage may approve/decline; inserts start pending.
--   8. Internal helper functions no longer callable directly by clients
--      (employee_day_counts, roster_working_days, permission_level).
-- ============================================================================

-- ── 1. Industrial Relations: confidentiality-first policies (as in 0019) ─────
do $$
declare pol record; t text;
begin
  foreach t in array array['ir_concerns','ir_engagements'] loop
    for pol in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy if exists %I on public.%I;', pol.policyname, t);
    end loop;
  end loop;
end $$;

alter table public.ir_concerns    enable row level security;
alter table public.ir_engagements enable row level security;

-- Any member may submit a concern (it always starts as 'new', unclassified).
create policy irc_insert on public.ir_concerns for insert with check (
  org_id in (select public.user_org_ids())
  and status = 'new'
  and coalesce(referred_to_counsellor, false) = false
);
-- Only owner/admin, the IRO, or the counsellor (referred cases only) may read.
create policy irc_read on public.ir_concerns for select using (
  public.has_org_role(org_id, array['owner','admin'])
  or public.is_ir_officer(org_id)
  or (public.is_counsellor(org_id) and referred_to_counsellor = true)
);
create policy irc_update on public.ir_concerns for update using (
  public.has_org_role(org_id, array['owner','admin'])
  or public.is_ir_officer(org_id)
  or (public.is_counsellor(org_id) and referred_to_counsellor = true)
);
create policy ire_read on public.ir_engagements for select using (
  public.has_org_role(org_id, array['owner','admin'])
  or public.is_ir_officer(org_id)
  or public.is_counsellor(org_id)
);
create policy ire_write on public.ir_engagements for insert with check (
  public.has_org_role(org_id, array['owner','admin'])
  or public.is_ir_officer(org_id)
  or public.is_counsellor(org_id)
);

-- ── 2. Subscription payments: service role only ─────────────────────────────
revoke execute on function public.apply_subscription_payment(uuid, numeric, text, text, int, text)
  from public, anon, authenticated;
grant execute on function public.apply_subscription_payment(uuid, numeric, text, text, int, text)
  to service_role;

-- ── 3. Organizations: no direct client UPDATE ───────────────────────────────
-- update_org_profile() (SECURITY DEFINER, owner/admin-checked) covers profile
-- edits and never touches plan / status / subscription columns. The platform
-- admin console uses its own platform-owner-checked RPCs.
drop policy if exists org_update on public.organizations;

-- ── 4. Org members: admins manage everyone except owners ────────────────────
drop policy if exists om_admin_write on public.org_members;
drop policy if exists om_owner_write on public.org_members;
create policy om_owner_write on public.org_members for all
  using (public.has_org_role(org_id, array['owner']) or public.is_platform_owner())
  with check (public.has_org_role(org_id, array['owner']) or public.is_platform_owner());
create policy om_admin_write on public.org_members for all
  using (public.has_org_role(org_id, array['admin']) and role <> 'owner')
  with check (public.has_org_role(org_id, array['admin']) and role <> 'owner');

-- ── 5. accept_invite: never downgrade an owner ──────────────────────────────
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

  if lower(uemail) <> lower(inv.email) then
    raise exception 'This invitation was sent to a different email address';
  end if;

  insert into public.org_members(org_id, user_id, role, email)
  values (inv.org_id, uid, inv.role, uemail)
  on conflict (org_id, user_id) do update set role = excluded.role
    where public.org_members.role <> 'owner';

  update public.org_invitations set status = 'accepted' where id = inv.id;
  return inv.org_id;
end $$;
grant execute on function public.accept_invite(text) to authenticated;

-- ── 6. Self-service inserts must start undecided ────────────────────────────
drop policy if exists leave_requests_insert on public.leave_requests;
create policy leave_requests_insert on public.leave_requests for insert with check (
  org_id in (select public.user_org_ids())
  and status = 'pending' and decided_by is null
);

drop policy if exists callout_requests_insert on public.callout_requests;
create policy callout_requests_insert on public.callout_requests for insert with check (
  org_id in (select public.user_org_ids())
  and status = 'pending' and decided_by is null and decided_at is null
);

-- 'auto' / 'locked' are set by the scheduled catering jobs (service role).
drop policy if exists food_orders_insert on public.food_orders;
create policy food_orders_insert on public.food_orders for insert with check (
  org_id in (select public.user_org_ids())
  and status in ('placed','cancelled')
);

-- ── 7. Overtime: decisions need approvals:manage ────────────────────────────
drop policy if exists ot_insert on public.overtime_entries;
create policy ot_insert on public.overtime_entries for insert with check (
  public.can_in_domain(org_id, 'people', 'edit') and public.can_edit_dept(org_id, department)
  and status = 'pending' and decided_by is null and decided_at is null
);

drop policy if exists ot_update on public.overtime_entries;
drop policy if exists ot_decide on public.overtime_entries;
drop policy if exists ot_amend  on public.overtime_entries;
-- Approvers may approve / decline / re-open.
create policy ot_decide on public.overtime_entries for update
  using (public.can_in_domain(org_id, 'approvals', 'manage') and public.can_edit_dept(org_id, department))
  with check (public.can_in_domain(org_id, 'approvals', 'manage') and public.can_edit_dept(org_id, department));
-- People editors may only amend entries that are, and stay, pending.
create policy ot_amend on public.overtime_entries for update
  using (public.can_in_domain(org_id, 'people', 'edit') and public.can_edit_dept(org_id, department)
         and status = 'pending')
  with check (public.can_in_domain(org_id, 'people', 'edit') and public.can_edit_dept(org_id, department)
         and status = 'pending' and decided_by is null and decided_at is null);

-- ── 8. Internal helpers: not directly callable by clients ───────────────────
-- They are only used inside other SECURITY DEFINER functions (compute_* and
-- can_in_domain / my_permissions), which run as the function owner and keep
-- working after these revokes.
revoke execute on function public.employee_day_counts(uuid, uuid, date, date)  from public, anon, authenticated;
revoke execute on function public.roster_working_days(uuid, uuid, date, date)  from public, anon, authenticated;
revoke execute on function public.permission_level(uuid, uuid, text)          from public, anon, authenticated;

notify pgrst, 'reload schema';
