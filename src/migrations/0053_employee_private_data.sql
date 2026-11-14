-- ============================================================================
--  WFS Enterprise — 0053 Employee private data (pay, bank, ID, personal)
--  Until now every member of an org could read every employee's bank account,
--  ID numbers, personal details and pay, plus every payroll row.
--
--  Rule: private HR data is visible to members with finance:edit OR
--  people:manage (default: owner, admin, manager — adjustable per tier in the
--  role matrix), within their department scope, and to the employee themself
--  (matched by email).
--
--   1. can_view_private_hr(org) + my_employee_ids(org) helpers.
--   2. employees: column-level SELECT — clients can only select the directory
--      columns below. NOTE: new employee columns are NOT readable by clients
--      until added to this grant (or exposed via employee_private()).
--   3. employee_private(org) RPC returns the private fields the caller may see.
--   4. Trigger: members without private rights can't change private fields
--      (updates keep the stored values; inserts get defaults) — stops blind
--      overwrites and ghost-employee bank details. They also can't change an
--      employee's email, or create one carrying an app member's email, since
--      email is what links a record to its owner. Employee records can't be
--      moved to another org from the client.
--   5. payroll rows: readable only with private rights, or your own slips.
--   6. compute_payroll_basis / compute_allowances / compute_overtime_pay now
--      require private rights instead of finance:view (which everyone has).
--  Idempotent. Run after 0052.
-- ============================================================================

-- ── 1. Helpers ──────────────────────────────────────────────────────────────
create or replace function public.can_view_private_hr(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_owner()
      or public.can_in_domain(p_org, 'finance', 'edit')
      or public.can_in_domain(p_org, 'people', 'manage');
$$;
grant execute on function public.can_view_private_hr(uuid) to authenticated;

create or replace function public.my_employee_ids(p_org uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select e.id from public.employees e
  where e.org_id = p_org and e.email is not null
    and lower(e.email) = lower(coalesce(auth.jwt()->>'email', ''))
    and coalesce(auth.jwt()->>'email', '') <> '';
$$;
grant execute on function public.my_employee_ids(uuid) to authenticated;

-- ── 2. Column-level read access on employees ────────────────────────────────
revoke select on public.employees from anon, authenticated;
grant select (
  id, org_id, employee_no, full_name, department, position, status, worker_type,
  email, phone, hired_on, created_at, gender, nationality,
  next_of_kin_name, next_of_kin_phone, next_of_kin_relation,   -- emergency use on site
  dress_size, shoe_size, top_size, trouser_waist,               -- PPE planning
  photo_url, notes, hours_per_day, standard_working_days
) on public.employees to authenticated;

-- ── 3. Private fields for authorised callers ────────────────────────────────
create or replace function public.employee_private(p_org uuid)
returns table (id uuid, data jsonb)
language sql stable security definer set search_path = public as $$
  select e.id, jsonb_build_object(
    'home_address', e.home_address, 'postal_address', e.postal_address,
    'date_of_birth', e.date_of_birth, 'marital_status', e.marital_status,
    'spouse_name', e.spouse_name, 'spouse_phone', e.spouse_phone,
    'number_of_kids', e.number_of_kids, 'dependants', e.dependants,
    'id_type', e.id_type, 'id_number', e.id_number,
    'ssnit_number', e.ssnit_number, 'tin_number', e.tin_number,
    'id_document_type', e.id_document_type, 'id_document_url', e.id_document_url,
    'contract_url', e.contract_url,
    'bank_name', e.bank_name, 'bank_branch', e.bank_branch,
    'account_name', e.account_name, 'account_number', e.account_number,
    'account_type', e.account_type, 'mobile_money_no', e.mobile_money_no,
    'pay_type', e.pay_type, 'pay_rate', e.pay_rate,
    'leave_allowance', e.leave_allowance, 'pay_allowances', e.pay_allowances,
    'compliance_note', e.compliance_note, 'compliance_url', e.compliance_url)
  from public.employees e
  where e.org_id = p_org
    and (p_org in (select public.user_org_ids()) or public.is_platform_owner())
    and (
      (public.can_view_private_hr(p_org) and public.can_see_dept(p_org, e.department))
      or e.id in (select public.my_employee_ids(p_org))
    );
$$;
grant execute on function public.employee_private(uuid) to authenticated;

-- ── 4. Guard private fields on write ────────────────────────────────────────
create or replace function public.employees_guard_private()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- service role / SQL editor / scheduled jobs: no end-user identity
  if auth.uid() is null then return new; end if;
  -- Records never move between orgs from the client: otherwise a member with
  -- edit rights here and rights in an org of their own could carry an
  -- employee's private data across. Rights are judged on the original org.
  if tg_op = 'UPDATE' and new.org_id is distinct from old.org_id then
    raise exception 'Employees cannot be moved to another organization';
  end if;
  if public.can_view_private_hr(new.org_id) then return new; end if;

  if tg_op = 'UPDATE' then
    -- email links a record to its owner (my_employee_ids), so only private-
    -- rights holders may change it; otherwise a supervisor could set another
    -- employee's email to their own and read that person's private data.
    new.email := old.email;
    new.home_address := old.home_address;     new.postal_address := old.postal_address;
    new.date_of_birth := old.date_of_birth;   new.marital_status := old.marital_status;
    new.spouse_name := old.spouse_name;       new.spouse_phone := old.spouse_phone;
    new.number_of_kids := old.number_of_kids; new.dependants := old.dependants;
    new.id_type := old.id_type;               new.id_number := old.id_number;
    new.ssnit_number := old.ssnit_number;     new.tin_number := old.tin_number;
    new.id_document_type := old.id_document_type; new.id_document_url := old.id_document_url;
    new.contract_url := old.contract_url;
    new.bank_name := old.bank_name;           new.bank_branch := old.bank_branch;
    new.account_name := old.account_name;     new.account_number := old.account_number;
    new.account_type := old.account_type;     new.mobile_money_no := old.mobile_money_no;
    new.pay_type := old.pay_type;             new.pay_rate := old.pay_rate;
    new.leave_allowance := old.leave_allowance; new.pay_allowances := old.pay_allowances;
    new.compliance_note := old.compliance_note; new.compliance_url := old.compliance_url;
  else
    -- A new record may not carry the email of an existing app member (incl.
    -- the caller): that would hand them its future private data and payslips.
    -- Checked against members' login emails (auth.users), the stored member
    -- copy, the caller's own email and pending invitations.
    if new.email is not null and (
         lower(new.email) = lower(coalesce(auth.jwt()->>'email', ''))
         or exists (
           select 1 from public.org_members m
           left join auth.users u on u.id = m.user_id
           where m.org_id = new.org_id
             and (lower(u.email) = lower(new.email) or lower(m.email) = lower(new.email)))
         or exists (
           select 1 from public.org_invitations i
           where i.org_id = new.org_id and i.status = 'pending'
             and lower(i.email) = lower(new.email))) then
      new.email := null;
    end if;
    new.home_address := null;  new.postal_address := null; new.date_of_birth := null;
    new.marital_status := null; new.spouse_name := null;   new.spouse_phone := null;
    new.number_of_kids := 0;   new.dependants := '[]'::jsonb;
    new.id_type := null; new.id_number := null; new.ssnit_number := null; new.tin_number := null;
    new.id_document_type := null; new.id_document_url := null; new.contract_url := null;
    new.bank_name := null; new.bank_branch := null; new.account_name := null;
    new.account_number := null; new.account_type := null; new.mobile_money_no := null;
    new.pay_type := 'monthly'; new.pay_rate := 0; new.leave_allowance := 0;
    new.pay_allowances := '[]'::jsonb;
    new.compliance_note := null; new.compliance_url := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_employees_guard_private on public.employees;
create trigger trg_employees_guard_private
  before insert or update on public.employees
  for each row execute function public.employees_guard_private();

-- ── 5. Payroll rows ─────────────────────────────────────────────────────────
-- payroll_write (FOR ALL, finance:edit + dept) still also grants read to finance
-- editors; this policy adds people:manage holders and employees' own slips.
drop policy if exists payroll_read on public.payroll;
create policy payroll_read on public.payroll for select using (
  org_id in (select public.user_org_ids())
  and (
    (public.can_view_private_hr(org_id) and public.can_see_dept(org_id, department))
    or employee_id in (select public.my_employee_ids(org_id))
  )
);

-- ── 6. Pay computations need private rights ─────────────────────────────────
do $$
declare f text; def text; newdef text;
begin
  foreach f in array array[
    'public.compute_payroll_basis(uuid,text,uuid)',
    'public.compute_allowances(uuid,text,uuid)',
    'public.compute_overtime_pay(uuid,text,uuid)'] loop
    if to_regprocedure(f) is null then continue; end if;
    def := pg_get_functiondef(to_regprocedure(f));
    newdef := replace(def, 'can_in_domain(p_org, ''finance'', ''view'')', 'can_view_private_hr(p_org)');
    if newdef <> def then execute newdef; end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
