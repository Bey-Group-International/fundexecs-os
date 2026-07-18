# Raise Pipeline (`raise-pipeline`)

Aggregate a **caller-supplied** set of prospective LPs — each at a raise stage with
an expected ticket — into a fundraising pipeline roll-up: counts and expected $ by
stage, probability-weighted expected commitments, and coverage against a raise
target.

This is a **native FundExecs skill**: a versioned, schema-defined, policy-governed
reusable workflow that runs through the skill runtime (`lib/skills/runner.ts`) —
input validation, executive permission, deterministic core, output validation,
approval-tier resolution, and a persisted `skill_runs` record with an audit event.

## Contract

|                   |                                                                                                           |
|-------------------|-----------------------------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis                                                                         |
| **Risk**          | low                                                                                                       |
| **Executives**    | Capital Formation                                                                                         |
| **Inputs**        | `raiseTarget` (optional) + `prospects` (a supplied set of LPs, each with a stage and optional ticket/prob) |
| **Outputs**       | `byStage`, `totalProspects`, `weightedExpected`, `committedAmount`, `coveragePct`, `gapToTarget`, `raiseTarget`, `recommendedAction`, `missingContext` |
| **Artifacts**     | `analysis`                                                                                                 |
| **Downstream**    | —                                                                                                         |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Guardrail (the reason this is a skill, not a prompt)

- **Aggregates a provided set — never fabricates prospects or commitments.** This
  skill rolls up the prospects the caller supplies. It does **not** invent,
  research, or hallucinate LPs. With no prospects it returns an empty roll-up and
  the note *"No prospects supplied — this skill aggregates a provided prospect
  set; it does not fabricate prospects."*
- **Separates epistemics.** A supplied `expectedTicket` or `probability` is a
  `fact`; a stage-default probability applied because the caller omitted one is an
  `assumption`; every derived figure (`weightedExpected`, `committedAmount`,
  `coveragePct`, `gapToTarget`) is a `calculation`. Weighting is a labelled
  calculation, **not** a binding commitment.
- **Target with no prospects is flagged, not filled.** A raise target supplied
  without prospects yields a 0-coverage roll-up plus a flag; a missing target
  yields `null` coverage and is flagged.
- **Advisory only.** Outreach, intro requests, capital calls and moving capital
  are all prohibited here — the skill prepares a roll-up for review.

## How the roll-up is computed

- **`byStage`** — for each canonical stage present (identified → contacted →
  meeting → diligence → committed → passed), the prospect `count` and the sum of
  **supplied** `expectedTicket` values. Prospects missing a ticket are counted but
  contribute 0 to expected $, and the omission is flagged.
- **`weightedExpected`** — Σ `expectedTicket × probability` across **non-passed**
  prospects. Where the caller omits `probability`, a stage default is used
  (identified .05, contacted .15, meeting .3, diligence .55, committed 1.0,
  passed 0) and labelled an assumption.
- **`committedAmount`** — Σ `expectedTicket` where `stage = committed`. An
  indicative sum of supplied figures, **not** a capital call.
- **Coverage** — when a `raiseTarget` is supplied, `coveragePct` =
  round(`weightedExpected` / `raiseTarget` × 100) and `gapToTarget` =
  max(0, `raiseTarget − weightedExpected`). Both are `null` when no target is set.
