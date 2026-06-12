# Agent prompt — Execute tab 3: Capital calls

Copy-paste prompt for the agent (read `docs/agents/EXECUTE_TABS_PLAYBOOK.md`
first — it is binding, including the Execute honesty contracts):

---

You own the **Capital calls** tab of the Execute hub in
Bey-Group-International/fundexecs-os. Branch: `agent/execute-capital` from
current main. Your mission: bring
`components/execute/CapitalCallsFlow.tsx` (+ `lib/capital/**`,
`lib/capital-calls/**`, `lib/queries/capital-calls.ts`, page
`app/(shell)/execute/capital/`) to full UX/UI parity with the
`CapitalCalls` component in
`docs/agents/prototype/execute/execute.jsx.txt` (plus `CALLS_SEED`/
`CALL_SUMMARY`/`CALL_LP_*`, `DISTRIBUTIONS`/`DIST_STATUS`), under the rules
in `docs/agents/EXECUTE_TABS_PLAYBOOK.md`.

The prototype's element inventory — verify each against the live flow and
close every gap:

1. **Summary tiles** — the `CALL_SUMMARY` strip (committed / called /
   funded style aggregates), computed from real calls and commitments.
2. **The call selector** — one row per call with its name, "{pct}% draw"
   badge, due date (danger when overdue LPs exist), funded progress
   ("{funded} of {total} funded"); selecting a call opens its funnel.
3. **The call posture card** — left-bordered by state (closed success /
   overdue danger / open gold), the funded ProgressBar, overdue count.
4. **The LP funding funnel** — per-LP rows with `CALL_LP_*` badges
   (Funded / Pending / Overdue), amounts, and the per-state action:
   **Chase** on overdue (drafts the reminder) / **Confirm** on pending
   (records receipt — the wire honesty contract applies: confirming
   RECORDS the funding; the operator attests against their bank). All
   through the approve loop, ending **"Log to Chain of Trust"** — real.
5. **Distributions** — the `DISTRIBUTIONS` list with `DIST_STATUS` badges
   (Paid / Staged / Planned), from the real distributions data
   (`lp_room_distributions_and_capital_accounts` schema) — never seeds.
6. **"New call"** — the prototype's plus action becomes a real flow: a
   small dialog (call name, amount/percentage, due date) feeding an
   ActionRunner whose approve creates the call against real commitments
   (mirror the Deal pipeline's "Source more deals" pattern).

Fidelity notes specific to this tab:

- The live flow persists via `lib/capital-calls/**` +
  `lib/queries/capital-calls.ts`; your job is parity on the tiles,
  selector, funnel anatomy, distributions and copy.
- Funded/overdue states derive from real LP commitment rows; an empty
  funnel is an honest empty state explaining when calls appear.
- Call/distribution vocabulary (statuses, tones, draw math) belongs in
  `lib/capital-calls/` (pure, unit-tested).

Definition of done, gates, and PR format: per the playbook. Open a draft PR
titled `Execute tab — Capital calls: prototype parity`.
