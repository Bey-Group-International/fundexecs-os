-- 20260921120000_network_automations.sql
--
-- Phase 3: automations for Network OS.
--
-- Phases 1 and 2 gave the workspace a pipeline, a task queue, a calendar and
-- rollups. Everything in them still happens because a person remembered to do
-- it: the deal moves to diligence and somebody has to think to raise the
-- follow-up, somebody has to notice a relationship going quiet. That is the
-- work a CRM is supposed to take off the desk.
--
--   1. network_automations — the rules. A trigger, a set of conditions, and an
--      ordered list of actions, all stored as data so a firm can change how it
--      works without a deploy.
--   2. network_automation_runs — what each rule actually DID, append-only. This
--      is not decoration: an automation nobody can audit is an automation
--      nobody trusts, and the first question after a surprise task appears is
--      "which rule made this, and why". The table answers it.
--
-- The runs table also carries the idempotency key. A time-based rule ("no
-- contact for 30 days") is evaluated by a sweep that runs every hour; without
-- a key it would raise the same follow-up task twenty-four times a day. The
-- unique index below makes a repeat fire a no-op decided by the database
-- rather than by a read-then-check in the application, which two overlapping
-- sweeps would lose.

-- ── 1. network_automations — the rules ───────────────────────────────────────

create table if not exists public.network_automations (
  id               uuid primary key default extensions.gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,

  name             text not null,
  description      text,
  -- Defaults OFF. A rule acts on other people's work unattended, and the run
  -- log only shows what it did after it has already done it, so the author
  -- reads it back and switches it on. The API always sends this explicitly;
  -- the default is what protects a direct PostgREST insert that omits it.
  enabled          boolean not null default false,

  -- What makes the rule consider firing. Event triggers are evaluated inside
  -- the request that changed the row; the three time-based ones are evaluated
  -- by the hourly sweep. Both paths share one evaluator.
  trigger_type     text not null
                     check (trigger_type in (
                       -- events, evaluated on write
                       'opportunity_created',
                       'opportunity_stage_changed',
                       'opportunity_won',
                       'opportunity_lost',
                       'contact_stage_changed',
                       'task_completed',
                       -- time, evaluated by the sweep
                       'opportunity_idle',
                       'contact_going_cold',
                       'close_date_approaching'
                     )),

  -- Trigger-specific settings: {fromStage, toStage} for a stage move,
  -- {days} for the time-based three. Validated in the API layer against the
  -- trigger type, because the shape depends on it.
  trigger_config   jsonb not null default '{}'::jsonb,

  -- Every condition must hold for the rule to fire. Shape is
  -- [{field, op, value}] over a flattened snapshot of the row.
  conditions       jsonb not null default '[]'::jsonb,

  -- What to do, in order: [{type, ...}]. An empty list is a rule that does
  -- nothing, which is a configuration error rather than a valid state.
  actions          jsonb not null default '[]'::jsonb,

  -- Operational history, so the list can show whether a rule is actually
  -- working without opening the run log.
  run_count        integer not null default 0,
  last_run_at      timestamptz,
  last_error       text,

  created_by       uuid references public.principals (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint network_automations_actions_present
    check (jsonb_typeof(actions) = 'array' and jsonb_array_length(actions) > 0),
  constraint network_automations_conditions_array
    check (jsonb_typeof(conditions) = 'array'),
  constraint network_automations_config_object
    check (jsonb_typeof(trigger_config) = 'object'),
  unique (organization_id, name)
);

comment on table public.network_automations is
  'Org-defined rules: when <trigger> and <conditions>, do <actions>.';
comment on column public.network_automations.trigger_config is
  'Trigger-specific settings. Shape depends on trigger_type; validated in the API layer.';

-- The sweep and the write path both ask "which enabled rules watch this
-- trigger, in this org?" — that lookup is on the hot path of every deal edit.
create index if not exists network_automations_org_trigger_idx
  on public.network_automations (organization_id, trigger_type)
  where enabled;

drop trigger if exists network_automations_set_updated_at on public.network_automations;
create trigger network_automations_set_updated_at
  before update on public.network_automations
  for each row execute function public.set_updated_at();

alter table public.network_automations enable row level security;

-- Everyone reads the rules: a member who finds a task they did not create is
-- owed an explanation, and hiding the rule book makes the workspace feel
-- haunted. Only admins write them, because a rule acts on the whole org.
drop policy if exists network_automations_select on public.network_automations;
create policy network_automations_select on public.network_automations
  for select to authenticated
  using (organization_id in (select public.current_principal_org_ids()));

drop policy if exists network_automations_insert on public.network_automations;
create policy network_automations_insert on public.network_automations
  for insert to authenticated
  with check (public.is_org_admin(organization_id));

drop policy if exists network_automations_update on public.network_automations;
create policy network_automations_update on public.network_automations
  for update to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

drop policy if exists network_automations_delete on public.network_automations;
create policy network_automations_delete on public.network_automations
  for delete to authenticated
  using (public.is_org_admin(organization_id));

-- ── 2. network_automation_runs — what fired, and what it did ─────────────────

create table if not exists public.network_automation_runs (
  id               uuid primary key default extensions.gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  automation_id    uuid not null references public.network_automations (id) on delete cascade,

  -- The row the rule acted on. Not a foreign key: the run log has to survive
  -- the deal being deleted, which is exactly when somebody goes looking for it.
  entity_type      text not null
                     check (entity_type in ('opportunity','contact','task')),
  entity_id        uuid not null,
  entity_label     text,

  -- 'processing' — CLAIMED, nothing applied yet. Every run starts here.
  -- 'applied'    — the actions ran.
  -- 'skipped'    — the trigger matched but the conditions did not. Recorded so
  --                a rule that never fires can be told apart from one that is
  --                not being evaluated at all.
  -- 'failed'     — an action errored. The rule stays enabled; the error is
  --                here.
  --
  -- The claim is written BEFORE any action runs, so its initial value has to be
  -- a state that does not assert anything happened. Defaulting to 'applied'
  -- meant a process that died between the claim and the first action left a row
  -- reading "applied" with an empty results list — the log asserting success for
  -- work that never started, and the unique index below refusing every retry.
  -- A stuck 'processing' row is still stuck, but it says so.
  --
  -- Deliberately NOT auto-reclaimed after a lease expires. Actions are not
  -- individually idempotent — a create_task that succeeded before the crash
  -- would run again — so reclaiming trades a visible stuck row for a silent
  -- double-application. This engine's contract is "at most once"; an operator
  -- deleting the stuck row is the recovery path, and it is a deliberate act.
  status           text not null default 'processing'
                     check (status in ('processing','applied','skipped','failed')),

  -- One entry per action, in order, each with its own outcome. A rule with
  -- three actions where the second fails is a partial run, and the log says so
  -- rather than reporting a single verdict for all three.
  results          jsonb not null default '[]'::jsonb,
  error            text,

  -- The idempotency key. For an event trigger it identifies the mutation
  -- (the row version), so a client retry cannot double-fire. For a time-based
  -- trigger it identifies the day, so an hourly sweep raises a follow-up once.
  -- Derived in one place: automationDedupeKey() in lib/network-automations.ts.
  dedupe_key       text not null,

  -- Who claimed this run. Null for the scheduled sweep, which runs as the
  -- service role on the organization's behalf rather than for any member.
  -- This is what stops one member closing out another's run, or a member
  -- writing a result onto a run they never claimed.
  claimed_by       uuid references public.principals (id) on delete set null,

  created_at       timestamptz not null default now()
);

alter table public.network_automation_runs
  add column if not exists claimed_by uuid references public.principals (id) on delete set null;

-- This index is the idempotency guarantee. Inserting the run row is the CLAIM:
-- the engine writes it before it applies anything, and a duplicate fire loses
-- the insert instead of doing the work twice. Two overlapping sweeps cannot
-- both win it, which a select-then-insert check could not promise.
create unique index if not exists network_automation_runs_claim_idx
  on public.network_automation_runs (automation_id, entity_id, dedupe_key);

create index if not exists network_automation_runs_automation_idx
  on public.network_automation_runs (automation_id, created_at desc);
create index if not exists network_automation_runs_org_idx
  on public.network_automation_runs (organization_id, created_at desc);
create index if not exists network_automation_runs_entity_idx
  on public.network_automation_runs (organization_id, entity_type, entity_id, created_at desc);

alter table public.network_automation_runs enable row level security;

-- Readable by the whole org for the same reason the rules are: this is the
-- answer to "why did this appear on my queue?".
drop policy if exists network_automation_runs_select on public.network_automation_runs;
create policy network_automation_runs_select on public.network_automation_runs
  for select to authenticated
  using (organization_id in (select public.current_principal_org_ids()));

-- There is deliberately NO insert, update or delete policy for members.
--
-- Org membership alone was the wrong gate. It let any authenticated member
-- write an arbitrary run row: forge a history entry against a colleague's rule,
-- attribute an action to a rule that never took it, or — worse — insert a row
-- carrying a legitimate firing's dedupe key and take the claim, so the real
-- firing lost the unique index and silently did nothing. The run log is
-- supposed to be the trustworthy answer to "why did this appear on my queue?",
-- and a log anybody can write is not that.
--
-- Members reach this table only through network_automation_claim_run() below,
-- which decides what a row may say. Like network_audit_log, nothing here can be
-- edited or deleted from the client afterwards.
drop policy if exists network_automation_runs_insert on public.network_automation_runs;

-- ── 2a. Claiming a firing ────────────────────────────────────────────────────
--
-- The insert IS the lock: it is written before any action runs, and the unique
-- index refuses the second attempt. Returns the new run's id, or null when this
-- exact firing has already been claimed.
--
-- SECURITY DEFINER because members have no insert policy. The checks below are
-- what it buys back: the automation must exist, in the caller's own org, and
-- the caller must be a member of that org. A member therefore cannot write a
-- run against another tenant's rule, against a rule that does not exist, or
-- with an entity_type the table would not otherwise accept.
--
-- claimed_by is taken from auth.uid() rather than from an argument, so a member
-- cannot attribute their claim to somebody else.

create or replace function public.network_automation_claim_run(
  target_org uuid,
  target_automation uuid,
  run_entity_type text,
  run_entity_id uuid,
  run_entity_label text,
  run_dedupe_key text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if target_org is null or not exists (
    select 1 from public.network_automations a
     where a.id = target_automation
       and a.organization_id = target_org
  ) or target_org not in (select public.current_principal_org_ids()) then
    return null;
  end if;

  insert into public.network_automation_runs (
    organization_id, automation_id, entity_type, entity_id, entity_label,
    status, dedupe_key, claimed_by
  ) values (
    target_org, target_automation, run_entity_type, run_entity_id, run_entity_label,
    'processing', run_dedupe_key, (select auth.uid())
  )
  returning id into new_id;

  return new_id;
exception
  -- Somebody else already holds this firing. That is a successful outcome, not
  -- a failure: the caller does nothing and the work happens exactly once.
  when unique_violation then
    return null;
end;
$$;

grant execute on function public.network_automation_claim_run(uuid, uuid, text, uuid, text, text)
  to authenticated;

-- ── 3. Closing out a run ─────────────────────────────────────────────────────
--
-- The engine claims a run, applies the actions, then records how they went.
-- That second write is the one thing the client is allowed to change about a
-- run row, and only for a run it just claimed, so it goes through a function
-- rather than an UPDATE policy that would let any member rewrite any run.
--
-- SECURITY DEFINER because there is no update policy for it to pass. The org
-- predicate below is what keeps it in bounds: the id alone is not enough, the
-- caller must also be a member of the row's organization.

create or replace function public.network_automation_run_finish(
  target_org uuid,
  target_run uuid,
  run_status text,
  run_results jsonb default '[]'::jsonb,
  run_error text default null
)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.network_automation_runs r
     set status = run_status,
         results = coalesce(run_results, '[]'::jsonb),
         error = run_error
   where r.id = target_run
     and r.organization_id = target_org
     and target_org in (select public.current_principal_org_ids())
     -- Only the claimant closes out their own run. Org membership alone let any
     -- member rewrite the result of any run in the workspace — enough to make
     -- a rule that did nothing read as applied, or one that worked read as
     -- failed. The run log has to be trustworthy or it is not worth keeping.
     and r.claimed_by = (select auth.uid())
     -- A run is finalised once. Without this a member could re-open somebody
     -- else's finished run and overwrite its results.
     and r.status = 'processing'
     and run_status in ('applied','skipped','failed');
$$;

grant execute on function public.network_automation_run_finish(uuid, uuid, text, jsonb, text)
  to authenticated;

-- ── 4. Counting a firing on the rule ─────────────────────────────────────────
--
-- run_count is incremented in the database rather than read-then-written in
-- the application: the sweep and a member's edit can fire the same rule at the
-- same moment, and a read-modify-write would lose one of them. The only
-- columns this can touch are the three operational ones, so a member cannot
-- reach a rule's logic through it.
--
-- SECURITY DEFINER for the same reason as above — updating network_automations
-- is admin-only, and a rule has to be able to record that it ran when it was
-- an ordinary member's edit that set it off.

create or replace function public.network_automation_record_run(
  target_org uuid,
  target_automation uuid,
  ran_at timestamptz default now(),
  run_error text default null
)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.network_automations a
     set run_count = a.run_count + 1,
         last_run_at = ran_at,
         last_error = run_error
   where a.id = target_automation
     and a.organization_id = target_org
     and target_org in (select public.current_principal_org_ids())
     -- Only for a rule this caller actually ran. Org membership alone let any
     -- member inflate any rule's counter or stamp a fabricated last_error onto
     -- it, which is the field an admin reads to decide whether a rule is
     -- working.
     and exists (
       select 1 from public.network_automation_runs r
        where r.automation_id = target_automation
          and r.organization_id = target_org
          and r.claimed_by = (select auth.uid())
     );
$$;

grant execute on function public.network_automation_record_run(uuid, uuid, timestamptz, text)
  to authenticated;

-- ── 5. Candidates for the time-based triggers ────────────────────────────────
--
-- The three scheduled triggers each ask a question the sweep would otherwise
-- answer with a table scan per rule. One function answers all three, so a firm
-- with ten idle-deal rules pays for one query rather than ten.
--
-- SECURITY INVOKER (the default) is load-bearing and the same choice the
-- Phase 2 rollups made: a colleague's private relationship must not become
-- visible because an automation looked at it. When the sweep runs as the
-- service role it sees everything, which is correct — it is acting for the
-- organization, not for a member — and it scopes every call to one org.
--
-- Two different day comparisons here, deliberately, each matching the Phase 2
-- rollup it has to agree with:
--
--   • 'opportunity_idle' and 'contact_going_cold' compare ELAPSED TIME
--     (`< now() - make_interval(days => n)`), which is exactly what
--     network_workspace_summary's contacts_cold does
--     (`last_activity_at < now() - interval '90 days'`). "Quiet for 21 days"
--     therefore means the same thing in the sweep as on the dashboard tile.
--     Converting these to a plain UTC-date comparison would make the two
--     disagree by up to a day, which is the opposite of what is wanted.
--
--   • 'close_date_approaching' compares UTC DATES, because expected_close is a
--     `date` and the client renders it as one. That is the same arithmetic
--     network_workspace_summary uses for closing_soon.
--
-- An earlier version of this comment claimed all three used UTC dates. They do
-- not, and the difference is load-bearing, so it is spelled out.

create or replace function public.network_automation_candidates(
  target_org uuid,
  kind text,
  threshold_days integer
)
returns table (
  entity_id     uuid,
  entity_label  text,
  snapshot      jsonb
)
language sql
stable
set search_path = public
as $$
  -- Deals with no logged activity for N days. A deal that has never had any
  -- activity counts from when it was created, otherwise a pipeline imported in
  -- bulk would sit silently outside every idle rule forever.
  select o.id,
         o.name,
         jsonb_build_object(
           'id', o.id,
           'name', o.name,
           'stage', o.stage,
           'status', o.status,
           'owner_id', o.owner_id,
           'contact_id', o.contact_id,
           'investor_id', o.investor_id,
           'fund_id', o.fund_id,
           'target_amount', o.target_amount,
           'currency', o.currency,
           'probability', o.probability,
           'expected_close', o.expected_close,
           'source', o.source,
           'tags', to_jsonb(o.tags),
           'custom', o.custom,
           'updated_at', o.updated_at
         )
    from public.network_opportunities o
   where kind = 'opportunity_idle'
     and o.organization_id = target_org
     and o.status = 'open'
     and coalesce(
           (select max(a.occurred_at) from public.network_activities a
             where a.opportunity_id = o.id),
           o.created_at
         ) < now() - make_interval(days => threshold_days)

  union all

  -- Deals whose expected close is within N days and still open. Bounded below
  -- at today so an overdue deal — which is a different problem, and has its
  -- own tile on the dashboard — does not fire the "closing soon" rule daily
  -- forever.
  select o.id,
         o.name,
         jsonb_build_object(
           'id', o.id,
           'name', o.name,
           'stage', o.stage,
           'status', o.status,
           'owner_id', o.owner_id,
           'contact_id', o.contact_id,
           'investor_id', o.investor_id,
           'fund_id', o.fund_id,
           'target_amount', o.target_amount,
           'currency', o.currency,
           'probability', o.probability,
           'expected_close', o.expected_close,
           'source', o.source,
           'tags', to_jsonb(o.tags),
           'custom', o.custom,
           'updated_at', o.updated_at
         )
    from public.network_opportunities o
   where kind = 'close_date_approaching'
     and o.organization_id = target_org
     and o.status = 'open'
     and o.expected_close is not null
     and o.expected_close >= (now() at time zone 'UTC')::date
     and o.expected_close <= ((now() at time zone 'UTC')::date + threshold_days)

  union all

  -- Relationships that have gone quiet. Same coalesce reasoning as the deals:
  -- a contact who has never been logged counts from when they were added.
  select c.id,
         c.full_name,
         jsonb_build_object(
           'id', c.id,
           'name', c.full_name,
           'stage', c.stage,
           'company', c.company,
           'title', c.title,
           'owner_id', c.relationship_owner,
           'contact_id', c.id,
           'visibility', c.visibility,
           'strength_score', c.strength_score,
           'tags', to_jsonb(coalesce(c.tags, '{}'::text[])),
           'custom', c.custom,
           'last_activity_at', c.last_activity_at,
           'updated_at', c.updated_at
         )
    from public.network_contacts c
   where kind = 'contact_going_cold'
     and c.organization_id = target_org
     and c.archived_at is null
     and c.merged_into_id is null
     and coalesce(c.last_activity_at, c.created_at)
           < now() - make_interval(days => threshold_days);
$$;

grant execute on function public.network_automation_candidates(uuid, text, integer) to authenticated;
