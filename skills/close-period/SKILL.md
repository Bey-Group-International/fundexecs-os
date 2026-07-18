# Period-Close Checklist (`close-period`)

**Prepare** a period-close **readiness checklist** for a fund. The skill assesses
a fixed canonical close checklist against the tasks the operator has marked done,
computes a **readiness** fraction, lists the items still open, flags any missing
input, and returns a recommended next action. It **only prepares the checklist**
— it never closes, reopens, or posts to the period.

This is a **native FundExecs skill**: a versioned, schema-defined, policy-governed
reusable workflow. It runs through the skill runtime (`lib/skills/runner.ts`),
which validates the input, checks that the assigned executive is permitted to run
it, executes the deterministic core, validates the output, resolves the approval
tier, and persists a `skill_runs` record with an audit event.

## Contract

|                   |                                                                                                  |
|-------------------|--------------------------------------------------------------------------------------------------|
| **Approval tier** | 1 — **preparing** the checklist is internal, reversible work product                             |
| **Risk**          | moderate                                                                                         |
| **Executives**    | Fund Administration                                                                              |
| **Inputs**        | `fundName` (required) + optional `periodEnd`, `tasksComplete` (canonical task keys marked done)  |
| **Outputs**       | `checklist`, `readiness`, `completeCount`, `totalTasks`, `openTasks`, `missingFields`, `recommendedAction` |
| **Artifacts**     | `analysis`                                                                                        |
| **Downstream**    | none — this is a leaf preparation step                                                           |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## The core guardrail: it PREPARES, it never CLOSES

`close-period` assesses close readiness for an operator to review. It does **not**
close the period, reopen it, or post anything:

- **Closing / locking a period is a Tier-3 action — always the human operator's.**
  Closing, reopening, and force-posting into a closed period lock or unlock the
  books; a delegated executive can never take them. They are listed in
  `prohibitedActions` (`close_period`, `post_to_closed_period`, `reopen_period`,
  `post_journal_entry`). This skill only produces a checklist; `recommendedAction`
  **always** states that closing the period is a Tier-3 action requiring explicit
  human authorization, and is never performed here.
- **The eight canonical tasks are a standard template.** They are labelled
  `generated` (a starting checklist to confirm), not facts about the period.
- **A task is complete only when the operator marks its key done.** Status is
  derived solely from `tasksComplete`; unknown keys are ignored, never counted.
- **A missing input becomes a flagged field — never a fabricated value.** An
  absent `periodEnd` is surfaced in `missingFields` with a note; it is never
  invented.
- **Deterministic + testable.** The checklist, readiness, and recommendation come
  from the pure core in `lib/skills/catalog/close-period.ts`, tested independently
  of any model.

## The canonical checklist

| Key                  | Task                                    |
|----------------------|-----------------------------------------|
| `bank_recs`          | Bank reconciliations complete           |
| `accruals`           | Accruals booked                         |
| `capital_activity`   | Capital activity recorded               |
| `fee_calc`           | Management/performance fees calculated  |
| `nav_tieout`         | NAV tie-out complete                    |
| `lp_statements`      | LP statements prepared                  |
| `subdoc_updates`     | Subscription/transfer updates applied   |
| `investor_reporting` | Investor reporting drafted              |

`readiness = round(completeCount / totalTasks, 2)`. When `readiness < 1` the
recommendation is to resolve the open items before **requesting** close; at
`readiness = 1` the checklist is ready to **request** close — but the close itself
is still a Tier-3 human action, never performed by this skill.

## Example

See [`examples/example-1.json`](./examples/example-1.json) — a mid-close checklist
with three of eight tasks done, screening at **0.38** readiness with five open
items.
