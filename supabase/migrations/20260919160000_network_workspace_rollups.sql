-- 20260919160000_network_workspace_rollups.sql
--
-- Phase 2 of the institutional workspace: the numbers a workspace opens with,
-- and the calendar the work sits on.
--
-- Phase 1 gave the pipeline a shape. What it did not give anyone is an answer
-- to "what needs me today". `network_tasks` has carried a due date since the
-- CRM spine and `network_opportunities` an expected close since phase 1, but
-- the only place either surfaced was one contact's record — so the work existed
-- and was unfindable unless you already knew which relationship to open.
--
-- Two things here:
--
--   1. network_workspace_summary — the dashboard's numbers in ONE round trip.
--   2. network_schedule          — tasks and expected closes on one timeline.
--
-- Both are SECURITY INVOKER (the default). That matters: a summary computed as
-- definer would count a colleague's private relationships into your totals, and
-- a number you cannot drill into is worse than no number. RLS and
-- network_contact_visible apply to these exactly as they do to a list query.

-- ── 1. Workspace summary ─────────────────────────────────────────────────────
--
-- Counts, plus the closing-soon money grouped per currency. Money is NEVER
-- summed across currencies here for the same reason the pipeline board stopped
-- doing it: a EUR total added to a USD total is not an amount of money in
-- either, and whichever symbol the UI picks is a lie about one of them.

drop function if exists public.network_workspace_summary(uuid);

create or replace function public.network_workspace_summary(target_org uuid)
returns table (
  tasks_overdue     bigint,
  tasks_due_today   bigint,
  tasks_due_week    bigint,
  tasks_unassigned  bigint,
  tasks_mine        bigint,
  contacts_cold     bigint,
  activities_week   bigint,
  closing_soon      jsonb
)
language sql
stable
set search_path = public
as $$
  select
    -- Work that is already late. Tasks with no due date are not late; they are
    -- unscheduled, which is a different problem and counted nowhere.
    --
    -- Compared as plain UTC CALENDAR DAYS, not as instants, because that is
    -- what `bucketTask` and the tasks route do. An instant comparison made a
    -- task due at 09:00 today read as overdue on this tile from 09:01 onwards
    -- while the queue it links to still filed it under "Today" — the tile said
    -- somebody was late for work they had all afternoon to do.
    --
    -- `date_trunc('day', now())` was wrong for the same reason in the other
    -- direction: it truncates in the SESSION timezone, so the day these counts
    -- meant depended on a connection setting rather than on the calendar the
    -- rest of the feature agrees on.
    (select count(*) from public.network_tasks t
      where t.organization_id = target_org and t.status = 'open'
        and t.due_at is not null
        and (t.due_at at time zone 'UTC')::date
              < (now() at time zone 'UTC')::date)                     as tasks_overdue,

    (select count(*) from public.network_tasks t
      where t.organization_id = target_org and t.status = 'open'
        and t.due_at is not null
        and (t.due_at at time zone 'UTC')::date
              = (now() at time zone 'UTC')::date)                     as tasks_due_today,

    -- Today plus the next seven days: exactly the span the queue shows under
    -- its "Today" and "This week" headings together, so the number on the tile
    -- is one a person can arrive at by counting what they are looking at.
    (select count(*) from public.network_tasks t
      where t.organization_id = target_org and t.status = 'open'
        and t.due_at is not null
        and (t.due_at at time zone 'UTC')::date
              between (now() at time zone 'UTC')::date
                  and (now() at time zone 'UTC')::date + 7)           as tasks_due_week,

    -- Work nobody owns. In a team this is the queue that quietly rots.
    (select count(*) from public.network_tasks t
      where t.organization_id = target_org and t.status = 'open'
        and t.assignee_id is null)                                    as tasks_unassigned,

    (select count(*) from public.network_tasks t
      where t.organization_id = target_org and t.status = 'open'
        and t.assignee_id = auth.uid())                               as tasks_mine,

    -- Relationships going cold: live ones that have not been touched in 90
    -- days. `dormant` and `passed` are excluded because they are already an
    -- acknowledged state rather than a slip, and a null last_activity_at is
    -- excluded because a freshly imported book would otherwise report itself
    -- as entirely cold on day one.
    (select count(*) from public.network_contacts c
      where c.organization_id = target_org
        and c.archived_at is null
        and c.stage in ('prospect','engaged','diligence','committed')
        and c.last_activity_at is not null
        and c.last_activity_at < now() - interval '90 days')          as contacts_cold,

    (select count(*) from public.network_activities a
      where a.organization_id = target_org
        and a.occurred_at >= now() - interval '7 days')               as activities_week,

    -- Deals expected to close within 30 days, per currency.
    coalesce((
      select jsonb_agg(row_to_json(s))
      from (
        select
          o.currency,
          count(*)                                                as deal_count,
          coalesce(sum(o.target_amount), 0)                       as target_total,
          coalesce(sum(o.target_amount * o.probability / 100.0), 0) as weighted_total
        from public.network_opportunities o
        where o.organization_id = target_org
          and o.status = 'open'
          and o.expected_close is not null
          and o.expected_close <= ((now() at time zone 'UTC')::date + 30)
        group by o.currency
        order by coalesce(sum(o.target_amount), 0) desc
      ) s
    ), '[]'::jsonb)                                                   as closing_soon;
$$;

grant execute on function public.network_workspace_summary(uuid) to authenticated;

-- ── 2. Schedule ──────────────────────────────────────────────────────────────
--
-- Tasks and expected closes on one timeline, because they compete for the same
-- day. A calendar that shows only tasks lets somebody book a week solid and
-- then discover three deals were meant to close in it.
--
-- Returned as one shape with a `kind` discriminator rather than two queries the
-- client interleaves: the ordering matters and belongs in the database, and a
-- client-side merge of two paginated lists silently drops whichever side is
-- longer than its page.

drop function if exists public.network_schedule(uuid, date, date);

create or replace function public.network_schedule(
  target_org uuid,
  range_start date,
  range_end date
)
returns table (
  kind            text,
  id              uuid,
  title           text,
  on_date         date,
  status          text,
  priority        text,
  assignee_id     uuid,
  contact_id      uuid,
  opportunity_id  uuid,
  amount          numeric,
  currency        text,
  overdue         boolean
)
language sql
stable
set search_path = public
as $$
  select
    'task'::text                                           as kind,
    t.id,
    t.title,
    (t.due_at at time zone 'UTC')::date                    as on_date,
    t.status,
    t.priority,
    t.assignee_id,
    t.contact_id,
    t.opportunity_id,
    null::numeric                                          as amount,
    null::text                                             as currency,
    -- Same UTC-day rule as the queue and the summary. A calendar that paints a
    -- task red at midday while the queue still calls it today's work is telling
    -- two different stories about one row.
    (t.status = 'open'
      and (t.due_at at time zone 'UTC')::date
            < (now() at time zone 'UTC')::date)                as overdue
  from public.network_tasks t
  where t.organization_id = target_org
    and t.due_at is not null
    and (t.due_at at time zone 'UTC')::date between range_start and range_end
    and t.status <> 'cancelled'

  union all

  select
    'close'::text                                          as kind,
    o.id,
    o.name,
    o.expected_close                                       as on_date,
    o.status,
    null::text                                             as priority,
    o.owner_id                                             as assignee_id,
    o.contact_id,
    o.id                                                   as opportunity_id,
    o.target_amount                                        as amount,
    o.currency,
    -- `current_date` is the session timezone's today; the calendar draws UTC
    -- days, so an expected close was briefly overdue on one and not the other.
    (o.status = 'open'
      and o.expected_close < (now() at time zone 'UTC')::date) as overdue
  from public.network_opportunities o
  where o.organization_id = target_org
    and o.expected_close is not null
    and o.expected_close between range_start and range_end

  order by on_date, kind, title;
$$;

grant execute on function public.network_schedule(uuid, date, date) to authenticated;

-- Supports the schedule's date-window scan on the opportunity side. The task
-- side is already served by network_tasks_due_idx.
create index if not exists network_opportunities_expected_close_idx
  on public.network_opportunities (organization_id, expected_close)
  where expected_close is not null;
