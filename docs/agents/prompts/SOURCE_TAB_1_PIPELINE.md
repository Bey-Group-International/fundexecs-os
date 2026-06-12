# Agent prompt — Source tab 1: Deal pipeline

Copy-paste prompt for the agent (read `docs/agents/SOURCE_TABS_PLAYBOOK.md`
first — it is binding):

---

You own the **Deal pipeline** tab of the Source hub in
Bey-Group-International/fundexecs-os. Branch: `agent/source-pipeline` from
current main. Your mission: bring
`components/source/DealPipelineFlow.tsx` (+ `lib/queries/pipeline.ts`, page
`app/(shell)/source/pipeline/`) to full UX/UI parity with the `DealPipeline`
component in `docs/agents/prototype/source/source.jsx.txt`, under the rules
in `docs/agents/SOURCE_TABS_PLAYBOOK.md`.

The prototype's element inventory — verify each against the live flow and
close every gap:

1. **Panel framing** — title "Deal pipeline", eyebrow "Sourced & scored by
   Marcus · tap a deal to open", trending-up icon, ghost "Source more deals"
   action (routes to Earn).
2. **Pipeline summary tiles** — In pipeline (count, azure) · Pipeline value
   ($, gold) · At close ($ in Closing, success), all from real deals.
3. **Stage funnel** — the five-column `DEAL_STAGES` strip (Sourced,
   Screening, Diligence, IC, Closing) with per-stage counts and
   `DEAL_STAGE_TONE` top borders.
4. **Deal cards grid** — sorted by stage desc then score; building icon,
   name + sector, stage badge, Size $ / Score (fit-colored via the
   prototype's `fitColor` thresholds: ≥85 success, ≥75 gold, else fg-3).
5. **Detail drawer** — the right-hand slide-over: header with icon/name/
   sector, three stat cards (Size / Score / Stage badge), the "Thesis" card
   ("Marcus scored this a {score} against your mandate"), the **stage
   tracker** (five segments, filled to current stage in the stage's tone),
   Source / Last update meta, and the gold **"Earn's next move"** block —
   `DEAL_NEXT[stage]` with the per-stage draft copy — or, at Closing, the
   success block with "Drive the close with Earn".
6. **Advance choreography** — `runDeal`: ActionRunner steps ("Pull the
   latest on the deal", "Prepare the {next} package", "Cross-check against
   your thesis", "Prepare for your approval"), draft copy per the prototype,
   approve → server action advances exactly one stage.

Fidelity notes specific to this tab:

- The live flow already persists deals and advances them through the approve
  loop (this surface shipped in PR #331); your job is parity on the funnel
  strip, card grid, drawer anatomy, tracker, and copy.
- Real data only: prototype `DEAL_SEED` rows never appear; empty pipeline
  renders an honest empty state with a path to add/source a deal.
- The live deal stages may differ in naming from `DEAL_STAGES` — reconcile
  in your tab's query/config layer with unit tests, and say in the PR body
  how you mapped them.

Definition of done, gates, and PR format: per the playbook. Open a draft PR
titled `Source tab — Deal pipeline: prototype parity`.
