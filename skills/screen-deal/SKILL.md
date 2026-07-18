# Deal Screening (`screen-deal`)

Screen an inbound opportunity against a fund's mandate and return a structured,
provenanced verdict — **pass / watch / fail** — with mandate-fit scoring, a
preliminary valuation, key risks, the material data that is missing, and the
diligence priorities that follow.

This is a **native FundExecs skill**: a versioned, schema-defined, policy-governed
reusable workflow. It runs through the skill runtime (`lib/skills/runner.ts`),
which validates the input, checks that the assigned executive is permitted to run
it, executes the deterministic core, validates the output, resolves the approval
tier, and persists a `skill_runs` record with an audit event.

## Contract

| | |
|---|---|
| **Approval tier** | 1 — internal, reversible analysis |
| **Risk** | low |
| **Executives** | Analyst · Investment Committee · Diligence |
| **Inputs** | `mandate` (criteria) + `deal` (at minimum `companyName`) |
| **Outputs** | `verdict`, `mandateFit`, `preliminaryValuation`, `keyRisks`, `missingFields`, `diligencePriorities`, `recommendedAction` |
| **Artifacts** | `analysis` |
| **Downstream** | `returns`, `dd-checklist`, `ic-memo` |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Guardrails (the reason this is a skill, not a prompt)

- **Never fabricates a financial value.** A missing input is *flagged* in
  `missingFields`, never invented.
- **Separates epistemics.** Every provided figure is a `fact`; every default
  (e.g. the leverage band) is a labelled `assumption`; every computed number
  (e.g. EV/EBITDA) is a `calculation`. These are returned in `sources` and never
  collapsed.
- **Advisory only.** The verdict initiates analysis; it can never authorize a
  capital-binding (Tier 3) action. The runtime enforces the tier and the
  executive's approval ceiling.
- **Deterministic + testable.** The verdict and every number come from the pure
  core in `lib/skills/catalog/screen-deal.ts`, tested independently of any model.

## How verdict is decided

1. **Exclusions** are a hard gate → any hit ⇒ `fail`.
2. **Mandate fit** scores sector, geography, and size (revenue / EBITDA / EV
   bands). Unknown dimensions are not penalised as misses — they are surfaced as
   missing data.
3. `overall ≥ 70` with no clear miss and adequate completeness ⇒ `pass`;
   a clear miss with low fit ⇒ `fail`; otherwise ⇒ `watch` (get more data first).

## Example

See [`examples/example-1.json`](./examples/example-1.json) — a clean
mandate-fit buyout that screens **PASS** at 8.0× EV/EBITDA.
