-- Loop-close idempotency: make the "close the loop" credit atomic.
--
-- recordLoopClose (lib/actions/loop.ts) credits a member's proof layer at most
-- once per execution event, using a `trust_events` row with action 'loop_closed'
-- as the ledger marker. A read-before-write check alone is racy (two concurrent
-- closes of the same entity could both credit). This partial unique index makes
-- the marker insert the atomic gate: the second insert hits a unique violation,
-- so only the first close credits readiness.
--
-- Scoped to action = 'loop_closed' so the rest of the append-only trust_events
-- ledger (evidence_approved, layer_advanced, …) keeps its multi-row semantics.
-- entity_id is a UUID unique across deals / diligence runs / commitments, so
-- (org_id, entity_id) is a sufficient idempotency key for this action.

create unique index if not exists trust_events_loop_close_idem
  on public.trust_events (org_id, entity_id)
  where action = 'loop_closed';
