# Portfolio Company Review (`portfolio-review`)

Review a portfolio company against its plan and its debt terms, and return a
structured, provenanced result — the **budget-to-actual variance** on revenue and
EBITDA (absolute and as a percentage), a **covenant compliance** check
(pass / breach / unknown) for each covenant, the names of any covenants in
**breach**, the **key risks**, the material data that is **missing**, and a
recommended next action.

This is a **native FundExecs skill**: a versioned, schema-defined, policy-governed
reusable workflow. It runs through the skill runtime (`lib/skills/runner.ts`),
which validates the input, checks that the assigned executive is permitted to run
it, executes the deterministic core, validates the output, resolves the approval
tier, and persists a `skill_runs` record with an audit event.

## Contract

|                   |                                                                                                                                                    |
|-------------------|----------------------------------------------------------------------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis                                                                                                                  |
| **Risk**          | low                                                                                                                                                |
| **Executives**    | Portfolio Ops                                                                                                                                      |
| **Inputs**        | `companyName` (required) + optional `period`, `budgetRevenue`, `actualRevenue`, `budgetEbitda`, `actualEbitda`, `covenants`                        |
| **Outputs**       | `revenueVariance`, `revenueVariancePct`, `ebitdaVariance`, `ebitdaVariancePct`, `covenantChecks`, `breaches`, `missingFields`, `keyRisks`, `recommendedAction` |
| **Artifacts**     | `analysis`                                                                                                                                         |
| **Downstream**    | `value-creation`                                                                                                                                  |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Guardrails (the reason this is a skill, not a prompt)

- **Never fabricates a financial value.** A missing input is *flagged* in
  `missingFields`, never invented. A variance is computed **only** when both the
  budget and the actual are present — otherwise it is `null`. The variance
  percentage is `null` when the budget is zero (no divide-by-zero).
- **Covenant status is derived, never assumed.** A covenant is scored `pass` or
  `breach` **only** when its `threshold`, `actual`, and `type` are all present;
  otherwise it is `unknown` and its missing data is flagged. `min` covenants
  require `actual ≥ threshold`; `max` covenants require `actual ≤ threshold`.
- **Separates epistemics.** Every provided figure is a `fact`; every computed
  number (variance, variance %, covenant status) is a `calculation`. These are
  returned in `sources` and never collapsed.
- **Advisory only.** The review informs analysis; it can never distribute a
  report, move capital, or sign a document. The runtime enforces the tier and the
  executive's approval ceiling.
- **Deterministic + testable.** Every number and every verdict comes from the
  pure core in `lib/skills/catalog/portfolio-review.ts`, tested independently of
  any model.

## How the review is computed

Variances (revenue shown; EBITDA identical):

1. `revenueVariance = actualRevenue − budgetRevenue` (2 dp), `null` unless both present.
2. `revenueVariancePct = revenueVariance / budgetRevenue × 100` (1 dp), `null` when the variance is `null` or the budget is zero.

Covenant compliance, for each covenant:

3. `min`  ⇒ `status = actual ≥ threshold ? pass : breach`
4. `max`  ⇒ `status = actual ≤ threshold ? pass : breach`
5. any of `threshold` / `actual` / `type` missing ⇒ `status = unknown`
6. `breaches` = the names of every covenant whose status is `breach`.

Key risks (deterministic):

- Revenue or EBITDA **more than 10% below budget** (`variancePct ≤ −10`) is raised as a risk.
- **Every covenant breach** is raised as a risk (`Covenant breach: <name>`).

## Example

See [`examples/example-1.json`](./examples/example-1.json) — a clean Q2 2026
review with revenue and EBITDA both **+5%** versus budget and both covenants
passing.
