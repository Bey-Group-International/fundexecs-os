# Agent prompt — Run tab 3: Compliance

Copy-paste prompt for the agent (read `docs/agents/RUN_TABS_PLAYBOOK.md`
first — it is binding, including the **shared-file rule** for
`lib/run-ops/**`):

---

You own the **Compliance** tab of the Run hub in
Bey-Group-International/fundexecs-os. Branch: `agent/run-compliance` from
current main. Your mission: bring `components/run/ComplianceFlow.tsx`
(+ `lib/queries/compliance.ts`, your sections of `lib/run-ops/**` and
`lib/queries/run-ops.ts`, page `app/(shell)/run/compliance/`) to full UX/UI
parity with the `ComplianceCenter` component in
`docs/agents/prototype/run/run.jsx.txt` (plus `CO_ITEMS`/`CO_CATS` and the
shared `RunSection` anatomy), under the rules in
`docs/agents/RUN_TABS_PLAYBOOK.md`.

The prototype's element inventory — verify each against the live flow and
close every gap:

1. **The posture header** — the left-bordered card computing the posture
   ladder from real items: high-severity open → "Action required" (danger)
   → open → "Items open" (warning) → upcoming → "On track" (info) →
   "Fully compliant" (success), as the pill + supporting counts.
2. **The readiness CTA pair** — "{n} to clear" (disabled secondary) vs the
   gold "ODD-ready" state, plus the ghost "Filings calendar" action.
3. **Category filter chips** — All + `CO_CATS` (Regulatory, Investor,
   Internal, Data & Cyber) filtering the list.
4. **Upcoming deadlines strip** — the calendar-clock eyebrow with the
   upcoming items called out ahead of the main list.
5. **The obligations list** — left-bordered rows (`RUN_TONE` by status)
   with due badge, owner (`who`), drives-line, per-item action button;
   done rows dimmed with success styling.
6. **Item detail drawer** — slide-over with the checklist
   (`Checklist · {n}`), why-it-matters line, and the gold "{action} with
   Earn" approve-loop CTA; done state confirmed.
7. **Resolve choreography** — ActionRunner steps ("Pull context with
   {who}", the action, "Update the record", "Prepare for your approval"),
   draft copy per the prototype, approve → the existing
   `resolveComplianceItem` server action.

Fidelity notes specific to this tab:

- This is a regulated surface: the `Illustrative` badge stays, and the
  honest-data rule is sharpest here — obligations come from real rows
  (`seedCompliance` baseline + operator items), never `CO_ITEMS`; no fake
  filing is ever marked done.
- `lib/run-ops/**` is shared with Workflows and IR — append-only, your
  exports only; category/posture vocabulary goes in your section of
  `lib/run-ops/vocabulary.ts` or `lib/queries/compliance.ts`, unit-tested.

Definition of done, gates, and PR format: per the playbook. Open a draft PR
titled `Run tab — Compliance: prototype parity`.
