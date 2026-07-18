# KPI Ingestion & Normalization (`kpi-ingest`)

Ingest a portfolio company's reported KPIs and return a uniform, provenanced
scorecard — each metric normalized to `{ name, value, unit, period, target,
variance, status }`, with on-track / off-track counts, the metrics whose values
are missing, and the next action that follows.

This is a **native FundExecs skill**: a versioned, schema-defined, policy-governed
reusable workflow. It runs through the skill runtime (`lib/skills/runner.ts`),
which validates the input, checks that the assigned executive is permitted to run
it, executes the deterministic core, validates the output, resolves the approval
tier, and persists a `skill_runs` record with an audit event.

## Contract

|                   |                                                                                                     |
|-------------------|-----------------------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis                                                                   |
| **Risk**          | low                                                                                                 |
| **Executives**    | Portfolio Ops                                                                                       |
| **Inputs**        | `companyName` + `kpis` (each at minimum `name`)                                                     |
| **Outputs**       | `normalized`, `kpiCount`, `onTrackCount`, `offTrackCount`, `missingKpis`, `missingFields`, `recommendedAction` |
| **Artifacts**     | `analysis`                                                                                           |
| **Downstream**    | `portfolio-review`                                                                                  |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Guardrails (the reason this is a skill, not a prompt)

- **Never fabricates a KPI value.** A metric with no reported value is *flagged*
  in `missingKpis` (status `unknown`), never invented.
- **Separates epistemics.** Every provided figure is a `fact`; every computed
  variance (`value − target`) is a `calculation`. These are returned in `sources`
  and never collapsed.
- **Advisory only.** The scorecard summarizes reported metrics; it can never
  distribute a report (Tier 2) or move capital (Tier 3). The runtime enforces the
  tier and the executive's approval ceiling.
- **Deterministic + testable.** Every normalized figure, status, and count comes
  from the pure core in `lib/skills/catalog/kpi-ingest.ts`, tested independently
  of any model.

## How status is decided

For each KPI, given its reported `value`, its `target`, and its `direction`
(`higher_better` by default):

1. **No value** ⇒ `unknown` (name added to `missingKpis`).
2. **Value but no target** ⇒ `no_target` (nothing to compare against).
3. **Value and target** ⇒ compare by polarity:
   `lower_better` is on track when `value ≤ target`; otherwise on track when
   `value ≥ target`. `variance` is `round(value − target, 2)`.

`onTrackCount` / `offTrackCount` are tallied from the resulting statuses;
`companyName` and at least one KPI are required, and their absence is surfaced in
`missingFields`.

## Example

See [`examples/example-1.json`](./examples/example-1.json) — a quarterly KPI set
where ARR and churn both beat target and gross margin is reported without a
target.
