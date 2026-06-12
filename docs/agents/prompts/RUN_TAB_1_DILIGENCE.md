# Agent prompt — Run tab 1: Diligence

Copy-paste prompt for the agent (read `docs/agents/RUN_TABS_PLAYBOOK.md`
first — it is binding):

---

You own the **Diligence** tab of the Run hub in
Bey-Group-International/fundexecs-os. Branch: `agent/run-diligence` from
current main. Your mission: bring the diligence surfaces
(`app/(shell)/run/diligence/**` — the index page with
`components/run/StartDiligence.tsx` and the `[runId]` detail route — plus
`lib/diligence/**`, `lib/diligence-desk/**`, `lib/diligence-ui.ts`,
`lib/queries/diligence.ts`, `lib/actions/diligence.ts`) to full UX/UI
parity with the prototype's inline Diligence center in
`docs/agents/prototype/run/run.jsx.txt` (the `tab === 'diligence'` branch
of `RunHub`, plus `DD_AGENTS`/`DD_DEALS`/`DD_STATUS`/`DD_SEV`), under the
rules in `docs/agents/RUN_TABS_PLAYBOOK.md`.

**URL contract (user-approved)**: the prototype's deal-switcher chips become
URL-synced navigation — `/run/diligence` shows the switcher and resolves to
the active run; selecting a deal pushes `/run/diligence/[runId]`; every run
keeps its shareable deep link. Prototype choreography on top of real routes.

The prototype's element inventory — verify each against the live flow and
close every gap:

1. **Deal switcher chips** — one chip per deal with a live run: building
   icon (accent-filled when active), name, sub-line with `x/15 clear`
   count. Live runs come from real `runDiligenceForDeal` data, never
   `DD_DEAL_META` seeds.
2. **The verdict card** — the left-bordered posture card computing the
   prototype's verdict ladder from real workstream statuses: high-severity
   flags → "On hold" (danger) → flags → "Conditional pass" (warning) →
   cautions → "Pass with notes" (info) → "Clear to proceed · IC-ready"
   (success), with the open-item note.
3. **Readiness stats** — cleared/total workstreams, `ddPct` progress,
   average confidence, total checks run — all from real run data.
4. **The risk register / agent matrix** — the per-workstream rows
   (`DD_AGENTS` = the 15-brain bench): specialist name + who, status chip
   (`DD_STATUS`: clear/caution/flag), severity (`DD_SEV`), headline,
   confidence; flagged/caution rows openable.
5. **The resolution drawer** — per-workstream slide-over: finding headline +
   detail, evidence, and the gold **"Earn's resolution"** block ("{action} —
   I'll prepare it with {who} and bring it back for your sign-off") →
   approve loop → server action clears the workstream and logs to the Chain
   of Trust; cleared state reads "Cleared · logged to Chain of Trust".
6. **Earn's verdict strip** — the closing line: open items → "{verdict} —
   {n} of {total} workstreams need your call…"; all clear → "All {total}
   workstreams clear at {avg}% avg confidence. This deal is IC-ready."
7. **"Ask Earn" ghost action** in the panel header — wire to a real
   affordance (the existing diligence kickoff or documents panel), never a
   dead button.

Fidelity notes specific to this tab:

- The live diligence engine is real (orchestrator, ingest, extraction,
  per-agent findings with personas via `personaFor`) — your job is parity
  on the center's composition: switcher, verdict ladder, matrix anatomy,
  drawer choreography and copy.
- `components/run/DiligenceDocumentsPanel.tsx` (the upload surface) stays —
  integrate it where the prototype's flow expects evidence, don't orphan it.
- Honest data: no seeded deals/findings ever; with no runs, the start
  surface (`StartDiligence`) is the honest empty state and entry point.
- Verdict/severity/status vocabulary belongs in `lib/diligence-ui.ts` or
  `lib/diligence-desk/config.ts` (pure, unit-tested) — extend there.

Definition of done, gates, and PR format: per the playbook. Open a draft PR
titled `Run tab — Diligence: prototype parity`.
