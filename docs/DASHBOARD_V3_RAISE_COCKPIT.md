# Dashboard v3 — the Raise Conversion Engine

Companion to `DASHBOARD_V2_COMPOUNDING.md`. Where v2 makes the command center
**compound** (resume, deltas, between-session leverage), v3 makes it **convert** —
it turns the org-aggregate score into the entity-level, forecast-driven, gate-pulled
next move on the **raise spine** of the private-market lifecycle.

Per decisions (Jun-13): deepen **`source_lps → convert_lps`** first · add
**predictive pace + prescriptive automation + diagnostic depth + external enrichment**
(in that priority) · evolve gates from binary thresholds into **actionable checklists
(tasks + owning agent + ETA)** · operate at the **entity level** (per-LP next moves),
not just org aggregate.

## The conversion thesis

A command center *compounds* (v2). It *converts* when it answers the operator's real
daily question — **"who do I move, how, and by when?"** Today `getDashboardData`
returns one readiness score and one pipeline count: it tells you the score, not the
play. The raise spine is where GPs spend the most calendar time and where the gate to
deploying capital actually sits, so that is where entity-level intelligence pays back
fastest. v3 adds the layer underneath the score: **which LP, what move, by when,
drafted and ready to fire.**

## Where this sits in the lifecycle

The 7-stage loop is unchanged (`lib/lifecycle.ts`). v3 concentrates on stages **3–4**:

- **`source_lps`** — build + qualify a targeted LP universe. Gate to next:
  `pipeline.contacted ≥ 3`.
- **`convert_lps`** — interest → soft-circle → commitment → close. Gate to
  `source_deals`: `softCircledOrCommitted ≥ 1`.

LP records flow from `capital_providers`, normalized by `normalizeLpStage`
(`lib/pipeline/lp-stages.ts`) into `prospect → contacted → soft_circled → committed`
(terminal: `passed`). Per-LP metadata (fit, warmth, source, lastTouch,
assignedSpecialist) is parsed from the `criteria` JSON today.

## The four surfaces

### 1. Conversion Forecast — *predictive / pace* (priority 1)

From the normalized funnel, compute **velocity** (transition rate across stages over a
trailing window) and project it forward:

- **Pace-to-target:** "Soft-circle → commit at 2/wk → target met in ~5 wks."
- **Time-to-next-gate:** weeks until the `convert_lps` gate clears at current rate —
  feeds the gate checklist (surface 3).
- **Pace vs. needed (the felt delta):** behind/ahead vs. the rate required to hit
  `targetRaise`, rendered like the existing `momentum` sparkline so trajectory is
  _felt_, not just stated.

> **Data dependency (the one true blocker):** stages today are point-in-time
> (`criteria.lastTouch`), so real velocity needs a **stage-transition log**. Until it
> exists, degrade to a coarse estimate from `created_at` + `lastTouch` — the same
> graceful-degradation pattern v2 uses for momentum deltas (no-Δ until snapshots
> exist).

### 2. Per-LP Next Moves — *entity-level* (the daily workflow surface)

For each LP, derive a next-best-action + **owning agent** (already mapped in
`STAGE_ON_POINT`) + urgency:

| Signal | Trigger | Owner |
| --- | --- | --- |
| **Cooling** | `soft_circled`, no touch > N days | Eleanor · `investor-relations` |
| **Stalled** | `contacted`, no stage progression | Vivian · `rainmaker` |
| **Ready-to-ask** | warm + high fit, not yet asked | Sloane · `capital-raiser` |
| **Needs match** | committed interest, no deal fit | Priya · `capital-connector` |

Aggregates tell you the score; these rows tell you what to *do*. Each row is a deep
link into the LP and carries the urgency that ranks it in the dashboard's next-move
slot.

### 3. Actionable Gate — *gate mechanics*

Render the live lifecycle gate as a **checklist**, not a threshold. Remaining items,
owning agent, and an ETA derived from surface 1's velocity:

```
Gate → source_deals  (1 of 2 cleared)
☑ Soft-circle ≥ 1
☐ Contact 2 more LPs — Vivian · ETA ~6d at current pace
```

The gate stops being a passive status and becomes a pull toward the next stage —
directly compounding v2's "decisive next move."

### 4. Approval Queue — *prescriptive automation* (priority 2)

Closes the loop. Agents pre-draft the actual artifact for each next move (the
cooling-LP follow-up, the intro request, the soft-circle confirmation). It sits in a
dashboard queue; the operator **approves → it fires and writes a `trust_event`** (on
the record) and advances the entity. Predicted move → drafted artifact → one-click
execute. Highest-trust, highest-effort piece (agents' words in front of LPs) — ship
last of the core four.

### Diagnostic depth + external enrichment (layered on, priorities 3–4)

- **Diagnostic (3):** "why" drill-downs hang off the forecast and readiness — _why_
  pace is behind (which funnel stage is the drag), _what's_ blocking the gate. Reuses
  the existing `readinessBreakdown` dimensions.
- **Enrichment (4, integration-gated):** Apollo (LP firmographics, warm paths) and
  Carta (cap-table / commit data) feed the LP rows once the core loop is proven.
  Sequenced last because it is the slowest and least-certain dependency — it must not
  block the surfaces that run on data you already have.

## Data needs (what conversion requires that we don't have yet)

- **Velocity / ETAs** → `lp_stage_events` (entity_id, from_stage, to_stage, at).
  _(Codex: table + write on stage change. Claude: read + compute rates; degrade to
  `created_at`/`lastTouch` until populated.)_
- **Approval queue** → `agent_drafts` (entity_id, agent_slug, kind, body, status:
  pending/approved/dismissed). _(Codex: table + RLS. Claude: draft-generation +
  approve→`trust_event` server actions.)_
- **Enrichment** → live Apollo / Carta integration seams (last).

Everything in surfaces 2 and 3 runs on **existing** `capital_providers` data + the
current gate thresholds — no new tables required to ship the entity layer.

## Agent split

- **Codex (data):** `lp_stage_events` (+ write-on-transition), `agent_drafts`
  (pending/approved/dismissed). RLS org/member-scoped.
- **Claude (logic):** extend `getDashboardData` → `conversionForecast`,
  `lpNextMoves[]`, gate-as-checklist with ETAs, `approvalQueue[]`; new loaders under
  `lib/queries/dashboard/`; draft-generation + approve→`trust_event` server actions.
- **Emergent (UI):** Raise Cockpit panel in the dense grid — forecast header, per-LP
  move rows, gate checklist, approval queue. Tokens-only; solid `bg-bg-1`; voice
  "Chief Operating Officer · your live AI guide".

## Build order

1. **Claude-now (no new tables):** `lpNextMoves[]` (cooling/stalled/ready-to-ask +
   owning agent from `STAGE_ON_POINT`) + actionable gate checklist — from existing
   `capital_providers` + gate thresholds. Ships the entity layer immediately.
2. **Claude-now:** coarse `conversionForecast` from `created_at`/`lastTouch`
   (degrades cleanly to no-pace).
3. **Codex:** `lp_stage_events` → real velocity + ETAs; `agent_drafts` → the queue.
4. **Claude:** wire real ETAs onto the gate; draft-generation + approve→`trust_event`.
5. **Emergent:** Raise Cockpit UI binding the extended loader.
6. **Later (integration-gated):** Apollo / Carta enrichment on the LP rows.

_Encodes the Jun-13 raise-conversion decisions. Extends `DASHBOARD_V2_COMPOUNDING.md`._
