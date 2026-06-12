# Agent prompt — Run tab 2: Workflows & tasks

Copy-paste prompt for the agent (read `docs/agents/RUN_TABS_PLAYBOOK.md`
first — it is binding, including the **shared-file rule** for
`lib/run-ops/**`):

---

You own the **Workflows** tab of the Run hub in
Bey-Group-International/fundexecs-os. Branch: `agent/run-workflows` from
current main. Your mission: bring `components/run/WorkflowsFlow.tsx`
(+ `lib/workflows/**`, your sections of `lib/run-ops/**` and
`lib/queries/run-ops.ts`, page `app/(shell)/run/workflows/`) to full UX/UI
parity with the `WorkflowsBoard` component in
`docs/agents/prototype/run/run.jsx.txt` (plus `WF_STREAMS`, the `WF_*`
seeds and `AUTOMATIONS`), under the rules in
`docs/agents/RUN_TABS_PLAYBOOK.md`.

The prototype's element inventory — verify each against the live flow and
close every gap:

1. **Stream selector** — the `WF_STREAMS` chips (deal close, fundraise,
   portfolio onboarding, LP onboarding, reporting): selected state, per-
   stream completion counts. Live streams come from real workflow groups —
   never seeded; absent streams are honest empty states.
2. **Stream posture header** — "{done}/{n} workstreams complete" with the
   deadline sub-line, the blocking-aware CTA ("{n} blocking" disabled vs
   gold "Proceed to sign"), and the ghost "Close plan" calendar action.
3. **The kanban columns** — status columns with eyebrow labels, task cards
   carrying owner (`who`), due badge (`RUN_TONE` tones), drives-line, and
   the per-task action button.
4. **Task detail drawer** — slide-over with subtasks checklist
   (`{done}/{n}`), why-it-matters line, and the gold "{action} with Earn"
   approve-loop CTA.
5. **The automations strip** — "Automations · Earn runs these for you"
   with toggles. **User-approved honesty contract**: toggling persists a
   REAL org-scoped row (small additive migration following the house
   pattern) so state survives reload — but each automation's claimed
   outcomes stay badged `Illustrative` until real engines exist, and no
   fake automation activity is ever written.
6. **Advance choreography** — `runItem`: ActionRunner steps ("Pull context
   with {who}", the action, "Update the record", "Prepare for your
   approval"), draft copy per the prototype, approve → the existing
   `advanceWorkflowTask` server action (extend it server-side if subtask
   completion needs enforcement).

Fidelity notes specific to this tab:

- The live flow already persists workflow groups/tasks via
  `lib/run-ops/actions.ts` + `lib/queries/run-ops.ts`; your job is parity
  on the stream selector, posture header, kanban anatomy, drawer and
  automations strip.
- `lib/run-ops/**` is shared with Compliance and IR — append-only, your
  exports only.
- Pure stream/automation vocabulary goes in `lib/workflows/` or your
  section of `lib/run-ops/vocabulary.ts`, unit-tested.

Definition of done, gates, and PR format: per the playbook. Open a draft PR
titled `Run tab — Workflows: prototype parity`.
