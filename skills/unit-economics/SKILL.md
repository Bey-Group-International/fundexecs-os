# Unit Economics (`unit-economics`)

Compute a first-pass **unit economics** read for a company and return a
structured, provenanced result — annual gross profit per user, **LTV**,
**LTV/CAC**, and **CAC payback** — together with a health **band**
(healthy / watch / unhealthy), the key risks, and the material data that is
missing.

This is a **native FundExecs skill**: a versioned, schema-defined, policy-governed
reusable workflow. It runs through the skill runtime (`lib/skills/runner.ts`),
which validates the input, checks that the assigned executive is permitted to run
it, executes the deterministic core, validates the output, resolves the approval
tier, and persists a `skill_runs` record with an audit event.

## Contract

|                   |                                                                                                   |
|-------------------|---------------------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis                                                                 |
| **Risk**          | low                                                                                               |
| **Executives**    | Analyst                                                                                           |
| **Inputs**        | `companyName` (required) + optional `arpu`, `cac`, `grossMarginPct`, `churnRatePct`               |
| **Outputs**       | `annualGrossProfitPerUser`, `ltv`, `ltvCacRatio`, `paybackMonths`, `band`, `keyRisks`, `missingFields`, `recommendedAction` |
| **Artifacts**     | `analysis`                                                                                        |
| **Downstream**    | `ic-memo`                                                                                         |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Guardrails (the reason this is a skill, not a prompt)

- **Never fabricates a financial value.** A missing input is *flagged* in
  `missingFields`, never invented. `ltv`, `ltvCacRatio`, and `band` are computed
  **only** when the inputs they depend on are present — otherwise they are `null`.
- **Guards divide-by-zero.** A churn rate of `0` makes LTV mathematically
  undefined: the skill returns `ltv: null` and the risk
  `"Churn rate 0 — LTV undefined"`, never a fabricated or infinite value.
- **Separates epistemics.** Every provided figure is a `fact`; every computed
  number (gross profit per user, LTV, ratio, payback) is a `calculation`. These
  are returned in `sources` and never collapsed.
- **Advisory only.** The read informs analysis; it can never authorize a
  capital-binding (Tier 3) action. The runtime enforces the tier and the
  executive's approval ceiling.
- **Deterministic + testable.** Every number comes from the pure core in
  `lib/skills/catalog/unit-economics.ts`, tested independently of any model.

## The math

1. `annualGrossProfitPerUser = arpu × (grossMarginPct ÷ 100)`
2. `ltv = annualGrossProfitPerUser ÷ (churnRatePct ÷ 100)` — **only** when
   `churnRatePct > 0`; otherwise `null` (LTV undefined).
3. `ltvCacRatio = ltv ÷ cac` (2 dp) — only when `ltv` is known and `cac > 0`.
4. `paybackMonths = cac ÷ (annualGrossProfitPerUser ÷ 12)` (1 dp) — only when
   `annualGrossProfitPerUser > 0`.

**Band:** `ltvCacRatio ≥ 3` ⇒ `healthy`; `≥ 1` ⇒ `watch`; otherwise
`unhealthy` (`null` when the ratio is not computable).

**Key risks** are derived deterministically — e.g. a payback over 24 months
raises `"Long payback (>24mo)"`, and an `unhealthy` band raises
`"LTV/CAC below 1 — acquisition uneconomic"`.

## Example

See [`examples/example-1.json`](./examples/example-1.json) — a SaaS company that
reads **3.2× LTV/CAC** with an **18.8-month** CAC payback (healthy band) at 80%
gross margin and 20% annual churn.
