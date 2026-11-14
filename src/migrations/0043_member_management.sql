-- ============================================================================
--  WFS Enterprise — 0043 Member management: remove / purge
--  remove_member(org, user, purge):
--    • MODE remove (purge=false): revoke access only — delete the org_members row
--      plus their access-config rows (permissions, page overrides). Their login
--      and all authored records are untouched. Reversible via re-invite.
--    • MODE purge (purge=true): the above PLUS delete their personal rows and
--      NULL their authorship on operational/financial records (records are kept
--      so the ledger and stock history stay intact — never deleted).
--  Guards: owner/admin only; cannot remove an owner; cannot remove yourself;
--  cannot remove the last owner. Run after 0042.
--  Uses named dollar-quote ($mm$) to avoid editor paste issues.
-- ============================================================================

create or replace function public.remove_member(p_org uuid, p_user uuid, p_purge boolean default false)
returns void language plpgsql security definer set search_path = public as $mm$
declare target_role text;
begin
  if not public.has_org_role(p_org, array['owner','admin']) then
    raise exception 'Only owners and admins can remove members';
  end if;
  if p_user = auth.uid() then
    raise exception 'You cannot remove yourself';
  end if;

  select role into target_role from public.org_members
  where org_id = p_org and user_id = p_user;
  if target_role is null then
    raise exception 'That member is not part of this organization';
  end if;
  if target_role = 'owner' then
    raise exception 'Owners cannot be removed';
  end if;

  -- Always: drop access rows for this member in this org.
  delete from public.member_permissions   where org_id = p_org and user_id = p_user;
  delete from public.member_page_overrides where org_id = p_org and user_id = p_user;
  delete from public.org_members           where org_id = p_org and user_id = p_user;

  if p_purge then
    -- Personal, safe-to-delete rows:
    delete from public.notification_dismissals where org_id = p_org and user_id = p_user;

    -- Operational / financial records: PRESERVE the record, remove attribution.
    -- (Deleting these would corrupt the ledger, stock balances, and history.)
    update public.journal_entries     set created_by = null where org_id = p_org and created_by = p_user;
    update public.inventory_txns      set created_by = null where org_id = p_org and created_by = p_user;
    update public.purchase_orders     set created_by = null where org_id = p_org and created_by = p_user;
    update public.purchase_requests   set created_by = null where org_id = p_org and created_by = p_user;
    update public.requisitions        set created_by = null where org_id = p_org and created_by = p_user;
    update public.work_orders         set created_by = null where org_id = p_org and created_by = p_user;
    update public.safety_interactions set created_by = null where org_id = p_org and created_by = p_user;
    update public.training_sessions   set created_by = null where org_id = p_org and created_by = p_user;
    update public.news_flash          set created_by = null where org_id = p_org and created_by = p_user;
    -- also clear requested_by on PRs (secondary attribution)
    update public.purchase_requests   set requested_by = null where org_id = p_org and requested_by = p_user;
  end if;
end
$mm$;
grant execute on function public.remove_member(uuid, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
