# NAV Tie-Out Review (`nav-review`)

Prepare a single-period **NAV roll-forward** and tie it out to the
administrator's reported NAV. The skill returns a structured, provenanced
result — the computed NAV, an ordered signed roll-forward, the tie-out
difference, whether it **ties out**, the material data that is missing, and the
key risks — so a human reviewer can adjudicate it.

This is a **native FundExecs skill**: a versioned, schema-defined, policy-governed
reusable workflow. It runs through the skill runtime (`lib/skills/runner.ts`),
which validates the input, checks that the assigned executive is permitted to run
it, executes the deterministic core, validates the output, resolves the approval
tier, and persists a `skill_runs` record with an audit event.

## Contract

|                   |                                                                                                                                                            |
|-------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis                                                                                                                          |
| **Risk**          | moderate                                                                                                                                                   |
| **Executives**    | Fund Admin                                                                                                                                                 |
| **Inputs**        | `fundName` (required) + optional `priorNav`, `contributions`, `distributions`, `realizedGainLoss`, `unrealizedGainLoss`, `fees`, `expenses`, `reportedNav` |
| **Outputs**       | `computedNav`, `tieOutDifference`, `tiesOut`, `rollForward`, `missingFields`, `keyRisks`, `recommendedAction`                                              |
| **Artifacts**     | `analysis`                                                                                                                                                 |
| **Downstream**    | `lp-update`                                                                                                                                                |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Guardrails (the reason this is a skill, not a prompt)

- **Preparation only — approval is human.** This skill *prepares* a NAV tie-out
  for review. It never approves a NAV and never distributes or reports one; NAV
  approval and LP reporting remain a human decision. The prohibited actions
  (`post_journal_entry`, `distribute_report`, `move_capital`, `close_period`) are
  encoded on the manifest and enforced by the runtime.
- **Never fabricates a financial value.** A missing `priorNav` or `reportedNav`
  is *flagged* in `missingFields`, never invented — a missing prior NAV yields a
  `null` computed NAV.
- **Separates epistemics.** Every provided figure is a `fact`; every absent flow
  component is defaulted to 0 but returned as a labelled `assumption`
  (`"Assumed <component> = 0"`); every computed number (the NAV, the tie-out
  difference) is a `calculation`. These are returned in `sources` and never
  collapsed.
- **Deterministic + testable.** The roll-forward and every number come from the
  pure core in `lib/skills/catalog/nav-review.ts`, tested independently of any
  model.

## How the tie-out is computed

1. **Prior NAV is the anchor.** If it is missing the roll-forward is not
   computable — `computedNav` is `null` and the gap is flagged.
2. **Flow components are signed.** `contributions`, `realizedGainLoss`, and
   `unrealizedGainLoss` add; `distributions`, `fees`, and `expenses` subtract. An
   absent component is assumed 0 and labelled.
3. `computedNav = priorNav + contributions − distributions + realizedGainLoss +
   unrealizedGainLoss − fees − expenses` (rounded to 2 dp).
4. `tieOutDifference = reportedNav − computedNav` (when both exist);
   `tiesOut` is true when `|tieOutDifference| < 0.01`.

## Example

See [`examples/example-1.json`](./examples/example-1.json) — a clean roll-forward
that ties out at a computed NAV of **1205** against the reported NAV.
