# Value-Creation Plan (`value-creation`)

Build a portfolio company's value-creation plan from structured inputs and return
a provenanced **EBITDA bridge** — current run-rate EBITDA plus the initiatives
that lift it to a bridged figure — alongside the **gap to target**, the
initiatives **ranked by EBITDA impact**, a derived **100-day plan**, the material
data that is missing, and the key risks.

This is a **native FundExecs skill**: a versioned, schema-defined, policy-governed
reusable workflow. It runs through the skill runtime (`lib/skills/runner.ts`),
which validates the input, checks that the assigned executive is permitted to run
it, executes the deterministic core, validates the output, resolves the approval
tier, and persists a `skill_runs` record with an audit event.

## Contract

|                   |                                                                                                                                         |
|-------------------|-----------------------------------------------------------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis                                                                                                       |
| **Risk**          | low                                                                                                                                     |
| **Executives**    | Portfolio Ops                                                                                                                           |
| **Inputs**        | `companyName` (required) + optional `currentEbitda`, `targetEbitda`, `initiatives`                                                      |
| **Outputs**       | `bridgedEbitda`, `gapToTarget`, `ebitdaBridge`, `rankedInitiatives`, `hundredDayPlan`, `missingFields`, `keyRisks`, `recommendedAction` |
| **Artifacts**     | `analysis`, `memo`                                                                                                                      |
| **Downstream**    | none                                                                                                                                    |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Guardrails (the reason this is a skill, not a prompt)

- **Never fabricates a financial value.** An initiative with no stated
  `ebitdaImpact` is treated as **0** and *flagged* in `missingFields`, never
  invented; missing `currentEbitda` / `targetEbitda` are flagged too.
- **Separates epistemics.** Every provided figure is a `fact`; every computed
  number (total impact, bridged EBITDA, gap to target) is a `calculation`; the
  derived 100-day plan is `generated`. These are returned in `sources` and never
  collapsed.
- **Advisory only.** The plan initiates portfolio work; it can never authorize a
  capital-binding action. The runtime enforces the tier and the executive's
  approval ceiling.
- **Deterministic + testable.** The bridge and every number come from the pure
  core in `lib/skills/catalog/value-creation.ts`, tested independently of any model.

## How the plan is built

1. **EBITDA bridge** — `bridgedEbitda = currentEbitda + Σ initiative.ebitdaImpact`
   (a missing impact counts as 0 and is flagged). The bridge is returned as an
   ordered list: Current EBITDA → one step per initiative → Bridged EBITDA.
2. **Gap to target** — `targetEbitda − bridgedEbitda`, computed only when both are
   known. A positive remaining gap is surfaced as a key risk.
3. **Ranked initiatives** — sorted by EBITDA impact descending; an initiative with
   no stated impact sorts last.
4. **100-day plan** — the names of initiatives realisable in ≤3 months. When no
   initiative carries a timeline, this is noted rather than left silently empty.

## Example

See [`examples/example-1.json`](./examples/example-1.json) — two initiatives that
bridge EBITDA from **100** to **135** against a **150** target (a **15** gap), with
the 2-month pricing initiative landing in the 100-day plan.
