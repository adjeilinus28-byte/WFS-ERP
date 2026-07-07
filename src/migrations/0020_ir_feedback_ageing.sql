-- ============================================================================
--  WFS Enterprise — 0020 IR resolution feedback + case ageing
--  Adds anonymous resolution feedback (rating + comment) and exposes an ageing
--  signal so stale cases surface for the IRO. Run after 0019.
-- ============================================================================

alter table public.ir_concerns
  add column if not exists feedback_rating int,        -- 1..5 (worker's rating)
  add column if not exists feedback_comment text,
  add column if not exists feedback_at timestamptz,
  add column if not exists resolved_at timestamptz;    -- stamped when resolved/closed

-- Stamp resolved_at automatically when a case moves to resolved/closed
create or replace function public.ir_stamp_resolved()
returns trigger language plpgsql as $$
begin
  if new.status in ('resolved','closed') and (old.status is distinct from new.status) then
    new.resolved_at := coalesce(new.resolved_at, now());
  end if;
  return new;
end $$;

drop trigger if exists trg_ir_resolved on public.ir_concerns;
create trigger trg_ir_resolved before update on public.ir_concerns
  for each row execute function public.ir_stamp_resolved();

-- Worker submits anonymous resolution feedback via case_id + code
create or replace function public.ir_worker_feedback(p_case_id text, p_code text, p_rating int, p_comment text)
returns boolean language plpgsql security definer set search_path = public as $$
declare c public.ir_concerns;
begin
  select * into c from public.ir_concerns where case_id = p_case_id and access_code = p_code;
  if not found then return false; end if;
  update public.ir_concerns
    set feedback_rating = greatest(1, least(5, coalesce(p_rating, 0))),
        feedback_comment = p_comment,
        feedback_at = now(),
        updated_at = now()
    where id = c.id;
  insert into public.ir_engagements(org_id, concern_id, author_role, kind, body)
    values (c.org_id, c.id, 'system', 'status', 'Worker submitted resolution feedback.');
  return true;
end $$;

grant execute on function public.ir_worker_feedback(text,text,int,text) to authenticated, anon;

-- Expose feedback + resolved status in the anonymous lookup
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
    'is_closed', (c.status in ('resolved','closed')),
    'has_feedback', (c.feedback_rating is not null),
    'created_at', c.created_at, 'thread', thread);
end $$;

grant execute on function public.ir_lookup(text,text) to authenticated, anon;

notify pgrst, 'reload schema';
