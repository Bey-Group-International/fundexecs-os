# Comparable Company Analysis (`comps`)

Value a subject company off a set of trading comparables and return a structured,
provenanced output: the per-multiple statistics (**EV/EBITDA**, **EV/Revenue**,
**P/E**), the implied valuation each median produces, an enterprise-value range,
the material data that is missing, key risks, and the recommended next action.

This is a **native FundExecs skill**: a versioned, schema-defined, policy-governed
reusable workflow. It runs through the skill runtime (`lib/skills/runner.ts`),
which validates the input, checks that the assigned executive is permitted to run
it, executes the deterministic core, validates the output, resolves the approval
tier, and persists a `skill_runs` record with an audit event.

## Contract

|                   |                                                                                           |
|-------------------|-------------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis                                                         |
| **Risk**          | low                                                                                       |
| **Executives**    | Analyst                                                                                   |
| **Inputs**        | `subject` (at minimum `companyName`) + `comparables` (array of peers)                     |
| **Outputs**       | `multiples`, `impliedValuation`, `missingFields`, `keyRisks`, `recommendedAction`         |
| **Artifacts**     | `analysis`, `model`                                                                       |
| **Downstream**    | `ic-memo`                                                                                 |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Guardrails (the reason this is a skill, not a prompt)

- **Never fabricates a financial value.** A missing subject metric or an empty
  multiple is *flagged* in `missingFields`, never invented.
- **Separates epistemics.** Every provided figure (a subject metric, a peer
  multiple) is a `fact`; every statistic and implied value is a `calculation`.
  These are returned in `sources` and never collapsed.
- **Advisory only.** The analysis initiates work; it can never authorize a
  capital-binding action. The runtime enforces the tier and the executive's
  approval ceiling.
- **Deterministic + testable.** Every number comes from the pure core in
  `lib/skills/catalog/comps.ts`, tested independently of any model.

## How the valuation is built

1. **Statistics.** For each multiple, collect the values provided across the
   comparables (missing values ignored) and compute `{count, median, mean, min,
   max}` at 1 decimal place. A multiple with zero provided values is `null`.
2. **Implied valuation.** Apply the median EV/EBITDA to the subject's EBITDA,
   the median EV/Revenue to revenue, and the median P/E to net income. Each
   implied value is `null` when its subject metric is missing **or** its
   multiple has no comparables.
3. **Range.** `evRangeLow` / `evRangeHigh` are the min / max of the implied
   *enterprise values* computed.
4. **Risk.** Fewer than three comparables surfaces a thin-set risk — the result
   is indicative, not relied upon.

## Example

See [`examples/example-1.json`](./examples/example-1.json) — a subject valued off
three peers to an implied EV range of **200–250** and implied equity of **180**.
