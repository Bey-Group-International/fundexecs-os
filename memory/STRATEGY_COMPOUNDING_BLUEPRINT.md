# Strategy → Compounding Command Surface — Blueprint

> **Status:** Decision-locked spec. Translates the four product decisions made
> on 2026-06-08 into a phased, file/table-mapped build for `/strategy`. Mirrors
> the proposal pattern in `memory/INTELLIGENCE_LAYER_PROPOSAL.md`. Phase 1 (the
> capital-weighted posture rollup) ships with this doc; Phases 2–5 are scoped,
> not yet built.

## Why this exists

Today `/strategy` (`app/strategy/StrategyView.tsx`, backed by the
`governance_plans` and `governance_objectives` tables) is a **manual checklist
with AI annotations**. The 100 / 30 / 10 horizons are real, but:

- progress `%` is faked from status (`statusPct` → 0 / 50 / 100),
- tiers are string-matched from "100/30/10",
- nothing flows in from the intelligence flywheel (`market_signals`,
  `signal_matches`, EDGAR ingestion) that already exists,
- completing an objective fires one `emitTrust({ layer: 'execution' })` and
  otherwise compounds nothing.

The goal: fuse strategy into the substrate already in the repo so the plan
becomes **dynamic, compounding, capital-weighted, and institutionally
compliant** — the surface that makes a first-time GP operate like a seasoned
investment-firm executive.

## The four locked decisions

| #   | Decision                                                   | Choice                                                                                                                                                                                |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Dynamism** — how objectives appear/update                | **Earn drafts, you approve.** Specialists draft objectives from live signals + lifecycle stage; the operator one-click approves into the plan. Control retained; plan self-refreshes. |
| 2   | **Compounding** — what finishing one thing multiplies into | **All four:** unlock the next lifecycle gate · momentum deltas + streaks · cascade the next-tier objective · capital-weighted scoring.                                                |
| 3   | **Unicorn** — what makes the operator best-in-class        | **All four:** Institutional Posture scorecard + peer percentile · best-in-class playbook templates · specialist executive briefings · authority/proof surfacing.                      |
| 4   | **Compliance** — staying institutionally compliant         | **Standing compliance tier**, auto-seeded and maintained by Adrian (GC), refreshed from SEC filing signals; never empties.                                                            |

## Substrate already in the repo (reuse, don't rebuild)

- **Lifecycle engine** — `lib/lifecycle.ts`: `computeLifecycleStageResult` (7
  stages, gates, `loopProgress`) and `computeReadinessScore` (0–100 composite
  with a per-dimension breakdown incl. a **capital** dimension). This is the
  backbone for both gate-unlock compounding and the Posture scorecard.
- **Intelligence flywheel** — `market_signals`, `signal_matches`, EDGAR Form D
  ingestion + scheduled scoring + compounding multipliers (migrations
  `2026060823*_intelligence_flywheel.sql`, `*_adaptive_match_intelligence.sql`,
  `*_wave6_market_signal_intelligence.sql`). Source of dynamic objective drafts.
- **Chain of Trust** — Truth → Concept → Execution → Work + `trust_events`
  append-only ledger. Objectives prove posture, not just track it.
- **15-specialist roster** — `lib/team/roster.ts`. Theodore (Chief Strategy),
  Adrian (GC/Compliance), Priya (Capital Markets), Eleanor (IR) own and seed
  objectives by domain.
- **Dashboard-v2 compounding** — `docs/DASHBOARD_V2_COMPOUNDING.md`: snapshot →
  momentum-delta and streak patterns the posture surface reuses.

## Phased build

### Phase 1 — Capital-weighted posture rollup (UI-only, no new tables) ✅ ships here

The honest down-payment on decision **#2 (capital-weighted scoring)** and the
visual seam for **#3 (Posture scorecard)**, computed purely from objectives
already loaded — degrades gracefully, fabricates nothing.

- Weight each objective by priority as a capital proxy (`High 3 · Medium 2 ·
Low 1`) and roll up a **weighted completion** per horizon + one overall
  **Execution posture** number, replacing the flat mean.
- Files: `app/strategy/StrategyView.tsx` only.
- No peer percentile yet (would require a cohort table — Phase 3). No fake Δ.

### Refine pass — simplify / fortify / optimize flow (UI-only) ✅ shipped

Consolidated the surface and hardened the loop after Phases 1 + 2a stacked three
summary cards before any objective.

- **One summary:** removed the standalone Earn banner; folded its objective-count
  line into the hero's Earn strip. The page now leads with a single summary
  (hero) → capital-weighted tier card → objectives.
- **Flow:** inline quick-add per horizon (type + Enter creates at that tier via
  the `TIER_TIMELINE` → `deriveTier` round-trip), with optimistic insert.
- **Fortify:** undo on archive/delete (new `restoreObjective` action) + a
  two-step inline confirm before delete; every mutation now `revalidatePath`s
  and the per-action full `router.refresh()` is gone (optimistic local state +
  server revalidation); `role=status`/`aria-live` flash, fuller aria-labels.
- **Deferred:** "real editable progress" — `pct` should come from lifecycle
  gates (Phase 2c real-pct), not a manual slider, so a hand-edit now would fight
  that design.

### Phase 2a — Lifecycle/posture hero (UI-only, no new tables) ✅ shipped

The read-only, verifiable half of the gate-unlock mechanic, reusing the tested
lifecycle engine via `getDashboardData` — no migration.

- `app/strategy/StrategyHero.tsx`: current lifecycle stage + loop progress, the
  **Institutional Readiness** composite (the "how investable am I" number) with
  its per-dimension breakdown, and the compounding line — **which stage this one
  unlocks** ("Clear this stage to unlock → Source LPs").
- `app/strategy/page.tsx` composes `getStrategyData` + `getDashboardData` and
  derives the next stage from `LIFECYCLE_STAGES`.

### Phase 2c — Live plan vs. proposed drafts (migration applied) ✅ shipped

The migration is now applied to the live DB, and ~10 drafts/org are already
seeded (the standing compliance tier — Form ADV, Form D, Rule 206(4)-7, Code of
Ethics — plus signal-driven Form D follow-ups). Before this, those drafts were
rendering into the live plan. Phase 2c separates them.

- `getStrategyData` selects `category` / `source` / `approved_at`, computes
  `isDraft = source ≠ 'manual' && approved_at is null`, and returns `objectives`
  (live) split from `drafts` (pending). The capital-weighted posture rollup now
  reflects only the live plan, not unapproved drafts.
- `StrategyView` adds a **"Proposed objectives — from your executive team"**
  section with **Approve** (`approveDraftObjective`) / **Dismiss** per draft,
  category + source labels (Lifecycle playbook / Market signal), and a category
  chip on live cards. Approve moves it into the plan optimistically; Dismiss is
  undoable.
- Delivers the **standing compliance tier (#4)** + the approve half of **Earn
  drafts, you approve (#1)** on the surface.
- Follow-up: `loadMaterialsReadiness` (dashboard) still counts unapproved drafts
  as incomplete — should exclude `isDraft` so readiness isn't dragged down.

### Phase 2b — Real signals in, gate-unlock writeback (data layer) ✅ migration applied

Implements **#1 (Earn drafts)** + the cascade + completion-writeback parts of
**#2** (the migration-dependent half of Phase 2).

**Shipped (committed, awaiting `supabase db push`):**

- `supabase/migrations/20260609150000_strategy_objective_compounding.sql` —
  additive columns on `governance_objectives`: `category`, `capital_weight`,
  `source`, `source_signal_id` (FK → `market_signals`), `parent_objective_id`
  (self-FK), `lifecycle_stage`, `approved_at`; guarded check constraints + FK
  indexes + a partial index for the pending-drafts inbox. All nullable/defaulted
  — no backfill, existing rows valid.
- `lib/supabase/database.types.ts` — hand-updated to the post-migration shape so
  the action layer typechecks.
- `lib/actions/strategy.ts` — `createObjective` carries the new fields **opt-in
  only** (legacy manual insert byte-for-byte unchanged → safe pre-migration);
  new `approveDraftObjective` stamps `approved_at`.

**Pending (after the migration is applied):**

- Regenerate `database.types.ts` from the live DB to replace the hand-edit.
- `getStrategyData`: select the new columns, derive real `pct` from lifecycle
  gates / linked trust layers (retire `statusPct`), expose draft state.
- Earn/specialist drafting job (signals + stage → `status` draft objectives).
- Cascade on completion + gate-unlock writeback; draft-approval UI on
  `/strategy`.

- Extend `governance_objectives` (additive migration): `category text`
  (`'capital' | 'governance' | 'compliance' | 'execution'`), `capital_weight
numeric`, `source text` (`'manual' | 'signal' | 'lifecycle' | 'cascade'`),
  `source_signal_id uuid references market_signals`, `parent_objective_id uuid`,
  `lifecycle_stage text`, `approved_at timestamptz` (draft vs. accepted).
- `lib/queries/strategy.ts`: join `lifecycle` inputs so `pct` is **real**
  (derived from gate progress / linked trust layers), not `statusPct`.
- `lib/actions/strategy.ts`: `approveDraftObjective`, `cascadeObjective`
  (closing a 100-day bet spawns its 30-day children; a 30 spawns 10-day moves),
  `acceptSpecialistDraft`.
- Earn/specialist drafting job: match `signal_matches` + current
  `computeLifecycleStageResult` → proposed objectives in `status='draft'`
  routed to the owning specialist. Reuses `brain_routing_rules`.
- On objective `done`: re-run lifecycle; if a gate flips cleared, surface the
  unlocked stage ("Proof of Concept complete → LP outreach unlocks").

### Phase 3 — Institutional Posture scorecard + peer percentile

Implements **#3** fully.

- `lib/strategy/posture.ts` (pure, testable like `lib/lifecycle.ts`): composite
  across **Compliance · Governance · Execution · Capital** from lifecycle +
  objective + trust inputs.
- `org_posture_snapshots` (additive migration, daily upsert RPC like
  `dashboard_snapshots`) → enables momentum Δ + streak (**#2**) and the
  percentile.
- Peer percentile computed against same-stage / same-member-type cohort from
  snapshots — only shown once N≥ a privacy floor; otherwise show the composite
  alone (never fabricate a rank).
- Posture header card on `/strategy` with four sub-bars + Δ-this-week + streak.

### Phase 4 — Standing compliance tier (Adrian)

Implements **#4**.

- Seed a permanent `category='compliance'` lane per org, owned by Adrian.
- Scheduled job refreshes it from SEC filing signals (Form ADV review cadence,
  Form D follow-ups) → compliance objectives that age into `High` if ignored.
- Compliance objectives feed the Compliance sub-score in Phase 3's posture.
- Surfaced as its own lane/eyebrow on `/strategy`, visually distinct, never
  empty.

### Phase 5 — Best-in-class playbooks + specialist briefings

Rounds out **#3**.

- `strategy_playbooks` seed: stage-tuned objective templates modeled on how top
  GPs run a raise/close — a first-timer instantiates a veteran's plan.
- Weekly specialist briefing (Theodore/Priya/Adrian) woven into the Earn dock
  and the strategy hero: "3 Form D matches on your thesis; here's the move."
- Promote Chain-of-Trust proofs onto each objective (authority/proof
  surfacing) — every objective shows the evidence backing it.

## Guardrails (carried from Wave-1)

- Additive migrations + server actions only; UI lanes stay in `app/` /
  `components/` / `lib/queries/`.
- 15 brain slugs in `lib/team/roster.ts` stable; voice "Chief Operating Officer
  · your live AI guide" / "on the record / audit-ready".
- All scoring server-side under RLS; client never grants its own posture/XP.
- **Never fabricate** a percentile, peer rank, or momentum Δ without the
  snapshot data behind it — degrade to the composite alone.
- Tokens-only styling; reuse `--cta-gradient`, `--shadow-cta`; solid `bg-bg-1`.

## Open questions for the next pass

- Q1. Capital proxy: keep priority-weighting (Phase 1) or move to true `$`
  weighting (pipeline value / capital deployed per objective) once objectives
  link to deals?
- Q2. Gate-unlock UX: celebrate inline on the strategy card, or route the
  unlock moment to the dashboard "Since you were away" band?
- Q3. Peer-percentile privacy floor: minimum cohort size before a rank shows?
- Q4. Draft approval: per-objective approve, or a batched "review 5 drafts
  from your team" inbox?
