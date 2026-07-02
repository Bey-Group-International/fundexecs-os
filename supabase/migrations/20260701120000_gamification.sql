-- 20260701120000_gamification.sql
-- Execution-driven gamification: task completion credits, streaks, hub
-- achievements, and milestone ranks. All reward writes go through the existing
-- grant_org_credits function so the credit_ledger stays the single source of
-- truth for every credit movement.

-- 1. execution_streaks -------------------------------------------------------
-- One row per org. Records the current active streak and longest-ever streak
-- so the wallet page and sidebar can display both without an aggregate query.
create table if not exists public.execution_streaks (
  organization_id   uuid        not null primary key
                                references public.organizations (id) on delete cascade,
  current_streak    integer     not null default 0,
  longest_streak    integer     not null default 0,
  last_activity_at  timestamptz,               -- UTC date the last task was completed
  freeze_used_at    timestamptz,               -- non-null = freeze consumed this week
  updated_at        timestamptz not null default now()
);

alter table public.execution_streaks enable row level security;

-- Orgs can read their own streak; only the service role writes it.
create policy "org_read_own_streak"
  on public.execution_streaks for select
  using (organization_id = (select auth.uid()));

-- 2. hub_achievements --------------------------------------------------------
-- Tracks whether an org has unlocked a specific achievement.
-- key is a stable snake_case string (e.g. "build_foundation_set").
create table if not exists public.hub_achievements (
  id               uuid        not null default gen_random_uuid() primary key,
  organization_id  uuid        not null references public.organizations (id) on delete cascade,
  key              text        not null,
  hub              text        not null,           -- build | source | run | execute
  label            text        not null,
  bonus_credits    integer     not null default 0,
  earned_at        timestamptz not null default now(),
  unique (organization_id, key)
);

alter table public.hub_achievements enable row level security;

create policy "org_read_own_achievements"
  on public.hub_achievements for select
  using (organization_id = (select auth.uid()));

-- 3. execution_milestones ----------------------------------------------------
-- Tracks lifetime task counts per org so milestone bonuses fire exactly once.
create table if not exists public.execution_milestones (
  organization_id   uuid     not null primary key
                             references public.organizations (id) on delete cascade,
  total_tasks       integer  not null default 0,
  last_milestone    integer  not null default 0,  -- task count at last milestone award
  updated_at        timestamptz not null default now()
);

alter table public.execution_milestones enable row level security;

create policy "org_read_own_milestones"
  on public.execution_milestones for select
  using (organization_id = (select auth.uid()));

-- 4. Indexes -----------------------------------------------------------------
create index if not exists execution_streaks_org_idx
  on public.execution_streaks (organization_id);

create index if not exists hub_achievements_org_idx
  on public.hub_achievements (organization_id, hub);

-- 5. award_task_credits — atomic gamification reward -------------------------
-- Called by the service role after a team task transitions to "completed".
-- Handles: base credit award, streak update + bonus, milestone check + bonus,
-- hub achievement check. All credit movements go through grant_org_credits so
-- the ledger is always consistent.
--
-- Returns a JSON summary of every reward issued so the API can relay it to
-- the client for the CreditPopup micro-animation.
create or replace function public.award_task_credits(
  p_org          uuid,
  p_task_id      uuid,
  p_hub          text,
  p_priority     text,         -- low | normal | high | urgent
  p_base_credits integer       -- pre-computed base from app logic
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

  -- Streak multiplier thresholds
  v_streak_mult   numeric(4,2);
begin
  -- ── 1. Base credit grant ──────────────────────────────────────────────────
  v_new_balance := public.grant_org_credits(
    p_org, p_base_credits, 'task_complete',
    null, null, p_hub || ':' || p_priority || ':' || p_task_id::text
  );

  -- ── 2. Streak update ─────────────────────────────────────────────────────
  select * into v_streak_row
    from public.execution_streaks
   where organization_id = p_org;

  if not found then
    -- First ever task completion for this org
    insert into public.execution_streaks
      (organization_id, current_streak, longest_streak, last_activity_at)
    values (p_org, 1, 1, now())
    returning * into v_streak_row;
    v_new_streak := 1;
  else
    v_last_day := (v_streak_row.last_activity_at at time zone 'UTC')::date;

    if v_last_day = v_today then
      -- Already logged activity today — keep streak, no increment
      v_new_streak := v_streak_row.current_streak;
    elsif v_last_day = v_today - 1
       or (
         -- Streak freeze absorbs a single missed day within the same week
         v_last_day = v_today - 2
         and v_streak_row.freeze_used_at is not null
         and (v_streak_row.freeze_used_at at time zone 'UTC')::date >= v_today - 7
       )
    then
      -- Consecutive day (or freeze-protected gap) — extend streak
      v_new_streak := v_streak_row.current_streak + 1;
    else
      -- Gap > 1 day (or freeze already used) — reset to 1
      v_new_streak := 1;
    end if;

    update public.execution_streaks
       set current_streak   = v_new_streak,
           longest_streak   = greatest(v_streak_row.longest_streak, v_new_streak),
           last_activity_at = now(),
           updated_at       = now()
     where organization_id = p_org;
  end if;

  -- Streak multiplier: compounds every checkpoint
  v_streak_mult := case
    when v_new_streak >= 60 then 2.5
    when v_new_streak >= 30 then 2.0
    when v_new_streak >= 14 then 1.75
    when v_new_streak >= 7  then 1.5
    when v_new_streak >= 3  then 1.25
    else 1.0
  end;

  if v_streak_mult > 1.0 then
    -- Streak bonus = (multiplier - 1) * base, rounded to nearest integer
    v_streak_bonus := round((v_streak_mult - 1.0) * p_base_credits)::integer;
    if v_streak_bonus > 0 then
      v_new_balance := public.grant_org_credits(
        p_org, v_streak_bonus, 'streak_bonus',
        null, null, 'streak:' || v_new_streak || ':' || p_task_id::text
      );
    end if;
  end if;

  -- ── 3. Milestone check ────────────────────────────────────────────────────
  select * into v_milestone_row
    from public.execution_milestones
   where organization_id = p_org;

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

  -- Check if a milestone threshold was just crossed (one bonus per crossing)
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
   where m.threshold >  coalesce(v_milestone_row.last_milestone, 0)
     and m.threshold <= v_new_total
   order by m.threshold asc
   limit 1;

  if v_milestone_hit is not null and v_milestone_credit > 0 then
    update public.execution_milestones
       set last_milestone = v_milestone_hit
     where organization_id = p_org;

    v_new_balance := public.grant_org_credits(
      p_org, v_milestone_credit, 'milestone_bonus',
      null, null, 'milestone:' || v_milestone_hit
    );
  end if;

  -- ── 4. Build result payload ───────────────────────────────────────────────
  v_result := jsonb_build_object(
    'base',           p_base_credits,
    'streak_bonus',   v_streak_bonus,
    'streak',         v_new_streak,
    'streak_mult',    v_streak_mult,
    'milestone_hit',  v_milestone_hit,
    'milestone_bonus',v_milestone_credit,
    'total_earned',   p_base_credits + v_streak_bonus + v_milestone_credit,
    'new_balance',    v_new_balance,
    'hub',            p_hub
  );

  return v_result;
end;
$$;

revoke execute on function public.award_task_credits(uuid, uuid, text, text, integer)
  from public, anon, authenticated;

-- 6. record_hub_achievement ──────────────────────────────────────────────────
create or replace function public.record_hub_achievement(
  p_org           uuid,
  p_key           text,
  p_hub           text,
  p_label         text,
  p_bonus_credits integer default 0
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Idempotent: no-op if already earned
  insert into public.hub_achievements
    (organization_id, key, hub, label, bonus_credits)
  values (p_org, p_key, p_hub, p_label, p_bonus_credits)
  on conflict (organization_id, key) do nothing;

  -- Only award credits if the row was newly inserted
  if found and p_bonus_credits > 0 then
    perform public.grant_org_credits(
      p_org, p_bonus_credits, 'hub_achievement',
      null, null, p_key
    );
    return true;
  end if;

  return false;
end;
$$;

revoke execute on function public.record_hub_achievement(uuid, text, text, text, integer)
  from public, anon, authenticated;
