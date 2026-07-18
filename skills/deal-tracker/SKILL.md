# Deal Tracker (`deal-tracker`)

Roll up the status of a deal in flight from a **caller-supplied** set of
workstreams/milestones and return a snapshot: counts by status, at-risk items,
an overall status, a completion percentage, and concrete next actions.

This is a **native FundExecs skill**: a versioned, schema-defined, policy-governed
reusable workflow that runs through the skill runtime (`lib/skills/runner.ts`) —
input validation, executive permission, deterministic core, output validation,
approval-tier resolution, and a persisted `skill_runs` record with an audit event.

## Contract

|                   |                                                                                                                    |
|-------------------|--------------------------------------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis                                                                                  |
| **Risk**          | low                                                                                                                |
| **Executives**    | Legal & Closing                                                                                                    |
| **Inputs**        | `deal` (name/stage/close date) + `milestones` (a supplied set to track)                                            |
| **Outputs**       | `tracked`, `byStatus`, `atRisk`, `overallStatus`, `completionPct`, `totalMilestones`, `nextActions`, `recommendedAction` |
| **Artifacts**     | `analysis`                                                                                                          |
| **Downstream**    | `closing-checklist`                                                                                                |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Guardrail (the reason this is a skill, not a prompt)

- **Tracks a provided set — never fabricates milestones.** This skill organizes the
  milestones the caller supplies. It does **not** invent milestones, dates, or
  owners. With no milestones it returns an empty `tracked` list and the note
  *"No milestones supplied — this skill tracks a provided milestone set; it does
  not fabricate milestones."*
- **Separates epistemics.** Supplied milestone fields (label/owner/dueDate) are
  `fact` sources; a status the caller omits is defaulted and labelled an
  `assumption`, never a fact; the completion percentage is a `calculation`.
  Missing owners/dates are flagged, not invented.
- **Advisory only.** It produces a status snapshot for review — it never advances
  the deal, signs a document, executes a sub-doc, or moves capital (all prohibited
  here).

## How the roll-up works

Each supplied milestone is normalized (status defaults to `not_started` when
absent) and flagged `atRisk` when it is **blocked**, or **critical and not done**.
`byStatus` counts milestones per status; `completionPct` is `round(done / total ×
100)`. `overallStatus` is `complete` when all are done, `at_risk` when any item is
at risk, `not_started` when nothing has moved, otherwise `on_track`. `nextActions`
emits one concrete action per at-risk item (`Unblock: <label>` /
`Advance critical: <label>`), capped, with truncation noted.
