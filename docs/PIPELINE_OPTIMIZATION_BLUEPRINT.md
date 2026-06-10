# `/pipeline` Optimization — Simplify · Refine · Fortify

> **Status:** Decision-locked spec. Translates four product decisions made on
> 2026-06-09 into a phased, file/table-mapped build for `www.fundexecs.com/pipeline`
> (`app/pipeline/*`). Mirrors the spec pattern in
> `memory/STRATEGY_COMPOUNDING_BLUEPRINT.md` and reuses the compounding patterns
> already proven in `docs/DASHBOARD_V2_COMPOUNDING.md`.

## Why this exists

`/pipeline` is the capital-formation surface — a 4-tab view
(`app/pipeline/PipelineView.tsx`): **Capital formation** (drag-drop stage
board), **LP Pipeline**, **Deal flow**, **Partners & services**, above a
4-KPI strip and an "Earn is working the book" band. It is solid but **mostly
static**:

- the per-deal **`fit` score is computed** in `lib/queries/pipeline.ts`
  (`computeFit`, 0–98 from stage progression + allocations + relative size)
  **but never shown** on the formation cards;
- the KPI strip shows **point-in-time values with no deltas** — there is no
  "up $1.2M this week", so progress is displayed, not _felt_;
- there is **no next-best-move** — the operator scans four tabs to decide what
  to do, rather than opening to a decision;
- the **deal board and the LP board are two separate tabs** with overlapping
  stages (`prospect → … → committed`), fragmenting the one thing they
  describe: the book.

The repo already establishes the cure — momentum deltas + streaks
(`lib/queries/dashboard/readiness-history.ts`, `MomentumCard`,
`GameBits.EarnCoinIncentive`), the "Earn drafts, you approve" pattern, and the
idempotent passive-snapshot capture used by Readiness. This pass **wires that
existing substrate into `/pipeline`** rather than inventing new mechanics.

## The four locked decisions (2026-06-09)

| #   | Decision                                    | Choice                                                                                                                                                               |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Lead lens** (simplify / refine / fortify) | **Refine — surface intelligence.** Bring the already-computed signals (fit, next move, momentum) to the surface first; highest visible payoff, reuses existing data. |
| 2   | **What "compound results" means here**      | **Momentum deltas + streaks.** Week-over-week Δ on the KPI strip and an engagement streak — the `DASHBOARD_V2` pattern, so every session builds on the last.         |
| 3   | **Biggest user-flow friction**              | **Unify the deal + LP boards.** One capital-formation flow instead of two tabbed boards with overlapping stages.                                                     |
| 4   | **Delivery**                                | **Plan doc, then build Phase 1.** This document + the Phase 1 PR.                                                                                                    |

## Substrate already in the repo (reuse, don't rebuild)

- **Fit score** — `lib/queries/pipeline.ts::computeFit` already returns a 0–98
  thesis-fit per deal on `PipelineDeal.fit`. Just surface it.
- **Snapshot → momentum pattern** — `readiness_snapshots` table + migration
  `20260609150000_readiness_snapshots.sql`, with
  `loadReadinessHistory` / `captureReadinessSnapshot` in
  `lib/queries/dashboard/readiness-history.ts`. Idempotent one-row-per-org-per-day
  upsert on render, no cron, degrades to a calm empty trend. **Phase 2 mirrors
  this exactly** for pipeline.
- **Momentum UI** — `components/dashboard/MomentumCard.tsx` (delta pill +
  "Building" empty state) and `GameBits.EarnCoinIncentive` (streak flame chip +
  next-move CTA). Reuse the visual language.
- **LP card** — `components/pipeline/LpPipelineBoard.tsx::LpCard` already renders
  a fit `ProgressBar`; the formation card should echo it (visual convergence is
  the first step toward the Phase 3 merge).

## Phased build

### Phase 1 — Refine: surface intelligence (UI + additive reads, **no migration**) ✅ ships with this doc

The honest down-payment on decision **#1**. Pure presentation over data the page
already loads — fabricates nothing, adds no tables.

| Change                             | File                                               | Notes                                                                                                                                                                  |
| ---------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Show `fit` on formation deal cards | `app/pipeline/PipelineView.tsx` (`FormationBoard`) | Thin `ProgressBar` + `fit%`, echoing `LpCard`. Data already on `PipelineDeal.fit`.                                                                                     |
| **"Next best move"** band          | `app/pipeline/PipelineView.tsx` (new `NextMove`)   | Deterministic heuristic over `data.stages`: highest-`fit` **non-committed/closed** deal, tie-broken by `amount`. Earn-styled CTA opens that deal's drawer. No AI call. |

### Phase 2 — Compound: momentum deltas + streaks (adds `pipeline_snapshots`)

Decision **#2**. Mirrors the Readiness snapshot pattern 1:1.

| Change                                             | File                                               | Notes                                                                                                                                                                                        |
| -------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pipeline_snapshots` table                         | `supabase/migrations/2026…_pipeline_snapshots.sql` | One row per (org, day): `pipeline_value`, `soft_circled`, `committed`, `total_deals`, `committed_count`, `conversion_pct`. Additive, idempotent, RLS-scoped — copy of `readiness_snapshots`. |
| `capturePipelineSnapshot` / `loadPipelineMomentum` | `lib/queries/pipeline-momentum.ts`                 | Best-effort daily upsert on render + a momentum reader (Δ vs ~7d ago + an engagement streak of consecutive captured days). Degrades to empty.                                                |
| Δ pills on KPI strip + streak chip                 | `app/pipeline/page.tsx`, `PipelineView.tsx`        | Capture on render (like Readiness); KPIs show `+Δ` (or "Building" with <2 samples); `EarnBand` shows the streak flame.                                                                       |

### Phase 3 — Simplify: unify the deal + LP boards

Decision **#3**. Structural; deserves its own PR after Phases 1–2 land the shared
card language.

- Collapse the **Capital formation** and **LP Pipeline** tabs into one
  capital-formation flow (deals and LPs under a shared stage spine), keeping
  **Deal flow** and **Partners** as supporting tabs.
- Single roll-up header spanning both books (combined pipeline value + committed).
- Carry the Phase 1 fit bar + Phase 2 deltas across the unified board.

### Phase 4 — Fortify (follow-on)

Error/empty-state polish, harden the optimistic drag-move reconciliation, and
add e2e coverage for the move + next-move + capture paths.

## Guardrails

UI + additive reads only per phase. Migrations are additive, idempotent, and
RLS-scoped (mirror `readiness_snapshots`); no changes to auth,
`lib/supabase` client, `proxy.ts`, middleware, or `app/login`. One draft PR per
phase, CI green before merge.
