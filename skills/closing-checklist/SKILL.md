# Closing Checklist (`closing-checklist`)

Produce a canonical **closing-readiness checklist** for a deal — a fixed set of
standard closing tasks and conditions precedent — merged with the caller's
**supplied** completion status, plus a readiness %.

This is a **native FundExecs skill**: a versioned, schema-defined, policy-governed
reusable workflow that runs through the skill runtime (`lib/skills/runner.ts`) —
input validation, executive permission, deterministic core, output validation,
approval-tier resolution, and a persisted `skill_runs` record with an audit event.

## Contract

|                   |                                                                                                                         |
|-------------------|-------------------------------------------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis                                                                                       |
| **Risk**          | low                                                                                                                     |
| **Executives**    | Legal & Closing                                                                                                         |
| **Inputs**        | `deal` (required) + `completedItems` + `conditionsPrecedent` (supplied status)                                          |
| **Outputs**       | `items`, `readinessPct`, `openItems`, `blockingItems`, `totalItems`, `doneItems`, `recommendedAction`, `missingContext` |
| **Artifacts**     | `analysis`                                                                                                              |
| **Downstream**    | _none_                                                                                                                  |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Guardrail (the reason this is a skill, not a prompt)

- **Never closes, signs, or executes.** The skill assesses readiness only.
  Closing and signing are **Tier-3, human-only** actions (`sign_document`,
  `execute_subdoc`, `submit_term_sheet`, `move_capital` are prohibited here). Even
  when every item is complete it routes to a human for final closing authorization —
  it never auto-closes.
- **Never fabricates completion.** A canonical item is `done` **only** when the
  caller reports it done (its key or label appears in `completedItems`,
  case-insensitive); a condition precedent is `done` only when the caller marks it
  `satisfied`. Everything else is `open`.
- **Separates epistemics.** Every supplied completion fact is a `fact` source; the
  `readinessPct` is a labelled `calculation`. Missing context is flagged, never
  silently assumed.

## The canonical checklist

Eight standard closing tasks are assessed on every deal: signed purchase agreement /
subscription documents executed, funds flow memo confirmed, KYC / AML cleared,
board & IC approvals recorded, disclosure schedules finalized, closing conditions
satisfied, legal opinions delivered, and post-closing filings prepared. Caller-supplied
conditions precedent are merged into the same list. `readinessPct` is
`round(done / total * 100)`. An open **critical** task, or an **unsatisfied blocking**
condition precedent, surfaces in `blockingItems` — resolve those before scheduling a
close.
