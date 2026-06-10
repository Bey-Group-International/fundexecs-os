-- Team-task automation (Phase 2) — make the run write-path atomic and tamper-evident.
--
-- Phase 2 originally let the server actions write task_runs / tasks / trust_events
-- as three separate statements, and the member UPDATE policy allowed flipping a
-- run's status directly (bypassing the audit). This migration closes both gaps:
--
--   * propose_task_run / decide_task_run are SECURITY DEFINER functions that
--     perform the run insert/decision, the task status transition, and the
--     trust_events audit append in a single transaction — all succeed or none do.
--   * direct INSERT/UPDATE on task_runs is revoked from members, so the only way
--     to create or move a run is through these audited functions. SELECT (read)
--     and admin DELETE stay as-is.
--
-- Authorization is enforced inside each function via private.is_org_member on the
-- run/task's own org, so a definer function can't be used to cross org boundaries.

-- ---------- propose_task_run: queued/blocked task -> proposed run ----------
create or replace function public.propose_task_run(
  p_task_id uuid,
  p_action text,
  p_steps jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_agent text;
  v_status text;
  v_existing uuid;
  v_run_id uuid;
begin
  select org_id, agent_slug, status
    into v_org, v_agent, v_status
    from public.tasks
   where id = p_task_id;

  if v_org is null then
    raise exception 'Task not found.' using errcode = 'no_data_found';
  end if;
  if not private.is_org_member(v_org) then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;
  if v_agent is null then
    raise exception 'Assign a specialist before running.';
  end if;

  -- Idempotency: one open proposal per task (also enforced by a partial unique
  -- index). Return the existing one instead of creating a duplicate.
  select id into v_existing
    from public.task_runs
   where task_id = p_task_id and status = 'proposed'
   limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  -- Only non-active tasks can be proposed for a run.
  if v_status in ('running', 'done', 'failed') then
    raise exception 'A % task cannot be proposed for a run.', v_status;
  end if;

  insert into public.task_runs (org_id, task_id, agent_slug, action, steps, status, proposed_by)
  values (v_org, p_task_id, v_agent, p_action, coalesce(p_steps, '[]'::jsonb), 'proposed', v_uid)
  returning id into v_run_id;

  -- Optimistic guard: only move the task if it's still the status we validated,
  -- so a concurrent change isn't clobbered (the whole function rolls back).
  update public.tasks set status = 'awaiting'
   where id = p_task_id and status = v_status;
  if not found then
    raise exception 'Task status changed; refresh and retry.';
  end if;

  insert into public.trust_events (org_id, actor_id, entity_type, entity_id, action, metadata)
  values (
    v_org, v_uid, 'task_run', v_run_id, 'task_run_proposed',
    jsonb_build_object('task_id', p_task_id, 'agent_slug', v_agent, 'run_action', p_action)
  );

  return v_run_id;
exception
  -- Concurrent propose for the same task: the partial unique index fires. The
  -- other transaction already opened the proposal, so return it (idempotent).
  when unique_violation then
    select id into v_existing
      from public.task_runs
     where task_id = p_task_id and status = 'proposed'
     limit 1;
    return v_existing;
end;
$$;

-- ---------- decide_task_run: approve (-> running) / reject (-> blocked) ----------
create or replace function public.decide_task_run(
  p_run_id uuid,
  p_decision text,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_task uuid;
  v_status text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_next text;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid decision.';
  end if;

  select org_id, task_id, status
    into v_org, v_task, v_status
    from public.task_runs
   where id = p_run_id;

  if v_org is null then
    raise exception 'Run not found.' using errcode = 'no_data_found';
  end if;
  if not private.is_org_member(v_org) then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;
  if v_status <> 'proposed' then
    raise exception 'This run was already decided.';
  end if;

  update public.task_runs
     set status = p_decision,
         decided_by = v_uid,
         decided_at = now(),
         decision_note = v_note
   where id = p_run_id;

  v_next := case when p_decision = 'approved' then 'running' else 'blocked' end;
  update public.tasks set status = v_next where id = v_task and status = 'awaiting';
  -- If the task left 'awaiting' concurrently, abort so the decision + audit
  -- aren't recorded against a task that didn't actually transition.
  if not found then
    raise exception 'Task is no longer awaiting approval; decision aborted.';
  end if;

  insert into public.trust_events (org_id, actor_id, entity_type, entity_id, action, metadata)
  values (
    v_org, v_uid, 'task_run', p_run_id,
    case when p_decision = 'approved' then 'task_run_approved' else 'task_run_rejected' end,
    jsonb_build_object('task_id', v_task, 'note', v_note)
  );
end;
$$;

revoke all on function public.propose_task_run(uuid, text, jsonb) from public, anon;
revoke all on function public.decide_task_run(uuid, text, text) from public, anon;
grant execute on function public.propose_task_run(uuid, text, jsonb) to authenticated;
grant execute on function public.decide_task_run(uuid, text, text) to authenticated;

-- ---------- lock down direct writes: the functions are the only way in ----------
drop policy if exists "members insert task_runs" on public.task_runs;
drop policy if exists "members update task_runs" on public.task_runs;
