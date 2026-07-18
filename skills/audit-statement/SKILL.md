# Audit Statement Tie-Out (`audit-statement`)

Prepare **audit support** by tying out **caller-supplied** financial-statement
line items against their supporting schedules / GL balances, and return a
structured, provenanced result — each line's **variance** and **status** (`tied`,
`variance`, or `unsupported`), the tied / variance / unsupported **counts**, the
**total absolute variance** over supported lines, the material context that is
missing, and the recommended next action.

This is a **native FundExecs skill**: a versioned, schema-defined, policy-governed
reusable workflow. It runs through the skill runtime (`lib/skills/runner.ts`),
which validates the input, checks that the assigned executive is permitted to run
it, executes the deterministic core, validates the output, resolves the approval
tier, and persists a `skill_runs` record with an audit event.

## Contract

|                   |                                                                                                                        |
|-------------------|------------------------------------------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible preparation of audit support                                                                  |
| **Risk**          | low                                                                                                                    |
| **Executives**    | Fund Administration                                                                                                    |
| **Inputs**        | optional `statementLines`, `materialityThreshold`                                                                      |
| **Outputs**       | `tieOuts`, `tiedCount`, `varianceCount`, `unsupportedCount`, `totalAbsVariance`, `recommendedAction`, `missingContext` |
| **Artifacts**     | `analysis`                                                                                                             |
| **Downstream**    | `nav-review`, `close-period`                                                                                           |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Guardrails (the reason this is a skill, not a prompt)

- **Prepares support — never issues an opinion, never signs off.** This skill
  *prepares* audit support for review. It **never** issues an audit opinion,
  **never** signs off, and **never** posts an entry — those belong to the external
  auditor / a human. Issuing an opinion, signing, posting a journal entry, closing
  a period, and moving capital are prohibited on this manifest
  (`sign_document`, `post_journal_entry`, `close_period`, `move_capital`) and
  cross-checked against the executive's prohibited actions.
- **Never fabricates a balance.** A line with **no supporting value** is *flagged*
  `unsupported` and its `variance` is `null` — it is **never** assumed to equal the
  statement value. An empty statement-line set returns an empty tie-out with the
  note *"No statement lines supplied — this skill ties out provided lines against
  support; it does not fabricate balances."*
- **Separates epistemics.** Every provided figure (statement value, support value)
  is a `fact`; every computed `variance` and the `totalAbsVariance` is a
  `calculation`; a **defaulted** materiality threshold is a labelled `assumption`.
  These are returned in `sources` and never collapsed.
- **Deterministic + testable.** Every variance, status, and count comes from the
  pure core in `lib/skills/catalog/audit-statement.ts`, tested independently of any
  model.

## How the tie-out is decided

1. **Variance.** For each line with a supporting value,
   `variance = round(statementValue − supportValue, 2)`; a line with no support
   has a `null` variance and status `unsupported` (never assumed equal).
2. **Status.** A supported line ties when `|variance| ≤ materialityThreshold`
   (status `tied`), otherwise `variance`. The threshold defaults to `0` (exact tie
   required), surfaced as an assumption.
3. **Totals.** `tiedCount` / `varianceCount` / `unsupportedCount` count the
   statuses; `totalAbsVariance` is the rounded sum of `|variance|` over **supported**
   lines only.
4. **Recommendation.** Unsupported and variance lines are called out as needing
   supporting schedules before the auditor's review — this tool does not issue an
   opinion.

## Example

See [`examples/example-1.json`](./examples/example-1.json) — four lines tied out at
a $100 materiality threshold: Cash ties, AR carries a $250 variance beyond
materiality, Investments has no support (`unsupported`, never assumed equal), and
Accrued expenses tie within materiality. Prepared for the auditor's review only.
