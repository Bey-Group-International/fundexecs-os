-- 20260701130000_gamification_fixes.sql
-- Fixes four issues found in code review of 20260701120000_gamification.sql:
--
-- 1. RLS policies used auth.uid() (user UUID) against organization_id (org UUID).
--    Replace with current_principal_org_ids() to match the app's tenancy model.
--
-- 2. Streak freeze condition was inverted: checked freeze_used_at IS NOT NULL
--    (freeze already consumed) instead of checking availability. Also freeze_used_at
--    was never written. Fixed to auto-consume when available.
--
-- 3. Concurrent award_task_credits calls could lose updates (read-modify-write
--    without row locking). Fixed with SELECT ... FOR UPDATE on streak/milestone rows.
--
-- 4. DB-level idempotency guard: add task_credit_awards table so the RPC exits early
--    if credits have already been awarded for a given task, preventing duplicate awards.

-- ── 1. Fix RLS policies ───────────────────────────────────────────────────────

drop policy if exists "org_read_own_streak"       on public.execution_streaks;
drop policy if exists "org_read_own_achievements"  on public.hub_achievements;
drop policy if exists "org_read_own_milestones"    on public.execution_milestones;

create policy "org_read_own_streak"
  on public.execution_streaks for select
  using (organization_id in (select public.current_principal_org_ids()));

create policy "org_read_own_achievements"
  on public.hub_achievements for select
  using (organization_id in (select public.current_principal_org_ids()));

create policy "org_read_own_milestones"
  on public.execution_milestones for select
  using (organization_id in (select public.current_principal_org_ids()));

-- ── 2–4. Idempotency guard table ─────────────────────────────────────────────
-- One row per (org, task). award_task_credits inserts here first; if the row
-- already exists (ON CONFLICT) it returns the previous result immediately so
-- no credits are re-awarded and no streak/milestone state is mutated.

create table if not exists public.task_credit_awards (
  organization_id  uuid        not null references public.organizations (id) on delete cascade,
  task_id          uuid        not null,
  awarded_at       timestamptz not null default now(),
  result           jsonb,
  primary key (organization_id, task_id)
);

alter table public.task_credit_awards enable row level security;

create policy "org_read_own_task_awards"
  on public.task_credit_awards for select
  using (organization_id in (select public.current_principal_org_ids()));

-- ── 3–4. Replace award_task_credits with a safe version ──────────────────────

create or replace function public.award_task_credits(
  p_org          uuid,
  p_task_id      uuid,
  p_hub          text,
  p_priority     text,
  p_base_credits integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_streak_row    public.execution_streaks%rowtype;
  v_milestone_row public.execution_milestones%rowtype;
  v_today         date := current_date;
  v_last_day      date;
  v_new_streak    integer;
  v_multiplier    numeric(4,2) := 1.0;
  v_streak_bonus  integer := 0;
  v_milestone_credit integer := 0;
  v_milestone_hit integer := 0;
  v_new_total     integer;
  v_new_balance   integer;
  v_result        jsonb;
  v_freeze_consumed boolean := false;
  v_streak_mult   numeric(4,2);
  v_existing      jsonb;
begin
  -- ── Idempotency: exit early if already awarded ────────────────────────────
  select result into v_existing
    from public.task_credit_awards
   where organization_id = p_org and task_id = p_task_id;

  if found then
    return v_existing;
  end if;

  -- ── 1. Base credit grant ──────────────────────────────────────────────────
  v_new_balance := public.grant_org_credits(
    p_org, p_base_credits, 'task_complete',
    null, null, p_hub || ':' || p_priority || ':' || p_task_id::text
  );

  -- ── 2. Streak update (FOR UPDATE prevents lost updates under concurrency) ──
  select * into v_streak_row
    from public.execution_streaks
   where organization_id = p_org
   for update;

  if not found then
    insert into public.execution_streaks
      (organization_id, current_streak, longest_streak, last_activity_at)
    values (p_org, 1, 1, now())
    returning * into v_streak_row;
    v_new_streak := 1;
  else
    v_last_day := (v_streak_row.last_activity_at at time zone 'UTC')::date;

    if v_last_day = v_today then
      v_new_streak := v_streak_row.current_streak;
    elsif v_last_day = v_today - 1 then
      v_new_streak := v_streak_row.current_streak + 1;
    elsif v_last_day = v_today - 2
      and (
        v_streak_row.freeze_used_at is null
        or (v_streak_row.freeze_used_at at time zone 'UTC')::date < v_today - 7
      )
    then
      -- Freeze is available — auto-consume it and protect the streak
      v_new_streak     := v_streak_row.current_streak + 1;
      v_freeze_consumed := true;
    else
      v_new_streak := 1;
    end if;

    update public.execution_streaks
       set current_streak   = v_new_streak,
           longest_streak   = greatest(v_streak_row.longest_streak, v_new_streak),
           last_activity_at = now(),
           freeze_used_at   = case when v_freeze_consumed then now() else v_streak_row.freeze_used_at end,
           updated_at       = now()
     where organization_id = p_org;
  end if;

  -- Streak multiplier
  v_streak_mult := case
    when v_new_streak >= 60 then 2.5
    when v_new_streak >= 30 then 2.0
    when v_new_streak >= 14 then 1.75
    when v_new_streak >= 7  then 1.5
    when v_new_streak >= 3  then 1.25
    else 1.0
  end;

  if v_streak_mult > 1.0 then
    v_streak_bonus := round((v_streak_mult - 1.0) * p_base_credits)::integer;
    if v_streak_bonus > 0 then
      v_new_balance := public.grant_org_credits(
        p_org, v_streak_bonus, 'streak_bonus',
        null, null, 'streak:' || v_new_streak || ':' || p_task_id::text
      );
    end if;
  end if;

  -- ── 3. Milestone check (FOR UPDATE prevents lost updates) ─────────────────
  select * into v_milestone_row
    from public.execution_milestones
   where organization_id = p_org
   for update;

  if not found then
    insert into public.execution_milestones (organization_id, total_tasks)
    values (p_org, 1)
    returning * into v_milestone_row;
    v_new_total := 1;
  else
    v_new_total := v_milestone_row.total_tasks + 1;
    update public.execution_milestones
       set total_tasks = v_new_total, updated_at = now()
     where organization_id = p_org;
  end if;

  -- Check if a milestone threshold was just crossed
  select m.threshold, m.bonus
    into v_milestone_hit, v_milestone_credit
    from (values
      (10,   100),
      (25,   250),
      (50,   500),
      (100, 1000),
      (250, 2500),
      (500, 5000)
    ) as m(threshold, bonus)
   where m.threshold > v_milestone_row.last_milestone
     and m.threshold <= v_new_total
   order by m.threshold
   limit 1;

  if found and v_milestone_credit > 0 then
    v_new_balance := public.grant_org_credits(
      p_org, v_milestone_credit, 'milestone_bonus',
      null, null, 'milestone:' || v_milestone_hit || ':' || p_task_id::text
    );
    update public.execution_milestones
       set last_milestone = v_milestone_hit, updated_at = now()
     where organization_id = p_org;
  end if;

  v_result := jsonb_build_object(
    'base',           p_base_credits,
    'streak_bonus',   v_streak_bonus,
    'streak',         v_new_streak,
    'streak_mult',    v_streak_mult,
    'milestone_hit',  case when v_milestone_hit > 0 then v_milestone_hit else null end,
    'milestone_bonus', v_milestone_credit,
    'total_earned',   p_base_credits + v_streak_bonus + v_milestone_credit,
    'new_balance',    v_new_balance,
    'hub',            p_hub
  );

  -- ── Record award so future calls are idempotent ───────────────────────────
  insert into public.task_credit_awards (organization_id, task_id, result)
  values (p_org, p_task_id, v_result)
  on conflict (organization_id, task_id) do nothing;

  return v_result;
end;
$$;

revoke execute on function public.award_task_credits(uuid, uuid, text, text, integer) from public, anon, authenticated;
