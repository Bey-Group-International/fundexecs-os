# Discounted Cash Flow (`dcf`)

Build a **discounted cash flow** valuation for a company and return a structured,
provenanced result — the present value of an explicit FCF projection, a Gordon
**terminal value**, the implied **enterprise value**, **equity value**, and
**per-share value**, plus a **sensitivity** on the discount rate and terminal
growth — together with the assumptions applied, the key risks, and the material
data that is missing.

This is a **native FundExecs skill**: a versioned, schema-defined, policy-governed
reusable workflow. It runs through the skill runtime (`lib/skills/runner.ts`),
which validates the input, checks that the assigned executive is permitted to run
it, executes the deterministic core, validates the output, resolves the approval
tier, and persists a `skill_runs` record with an audit event.

## Contract

|                   |                                                                                                                                                                              |
|-------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis                                                                                                                                          |
| **Risk**          | low                                                                                                                                                                        |
| **Executives**    | Analyst                                                                                                                                                                    |
| **Inputs**        | `companyName` (required) + optional `baseFcf`, `projectionYears`, `fcfGrowth`, `discountRate`, `terminalGrowth`, `netDebt`, `sharesOutstanding`                            |
| **Outputs**       | `enterpriseValue`, `equityValue`, `perShare`, `pvExplicit`, `pvTerminal`, `terminalValue`, `cashFlows`, `sensitivities`, `assumptionsUsed`, `missingFields`, `keyRisks`, `recommendedAction` |
| **Artifacts**     | `model`, `analysis`                                                                                                                                                        |
| **Downstream**    | `ic-memo`                                                                                                                                                                  |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Guardrails (the reason this is a skill, not a prompt)

- **Never fabricates a financial value.** A missing input is *flagged* in
  `missingFields`, never invented. `enterpriseValue` is computed **only** when
  base FCF and discount rate are both present — otherwise it is `null`.
- **Terminal-growth guard.** The Gordon terminal value is only defined when the
  discount rate exceeds the terminal growth rate. If `discountRate ≤
  terminalGrowth`, no terminal value is computed, `enterpriseValue` is `null`,
  and the key risk *"Discount rate must exceed terminal growth"* is raised.
- **Separates epistemics.** Every provided figure is a `fact`; every default
  (projection horizon, FCF growth, terminal growth, net debt) is a labelled
  `assumption`; every computed number (PVs, terminal value, EV, equity, per
  share) is a `calculation`. These are returned in `sources` and never collapsed.
- **Advisory only.** The valuation informs analysis; it can never authorize a
  capital-binding (Tier 3) action. The runtime enforces the tier and the
  executive's approval ceiling.
- **Deterministic + testable.** Every number comes from the pure core in
  `lib/skills/catalog/dcf.ts`, tested independently of any model.

## The DCF math (all figures in $M)

Defaults, each a labelled **assumption** when not supplied: `projectionYears = 5`,
`fcfGrowth = 0`, `terminalGrowth = 0.02`, `netDebt = 0`. Base FCF and the discount
rate have **no defaults** — they are flagged when missing.

1. For `t = 1..N`: `fcf_t = baseFcf × (1 + fcfGrowth)^t`
2. `pv_t = fcf_t / (1 + discountRate)^t`
3. `pvExplicit = Σ pv_t`
4. `terminalValue = fcf_N × (1 + terminalGrowth) / (discountRate − terminalGrowth)`
5. `pvTerminal = terminalValue / (1 + discountRate)^N`
6. `enterpriseValue = pvExplicit + pvTerminal` (1 dp)
7. `equityValue = enterpriseValue − netDebt`
8. `perShare = equityValue / sharesOutstanding` (2 dp; `null` without shares)

**Sensitivities** recompute `enterpriseValue` at `discountRate ± 0.01` and
`terminalGrowth ± 0.005`, each returned as `{ param, value, enterpriseValue }`.

## Example

See [`examples/example-1.json`](./examples/example-1.json) — a five-year DCF at a
10% WACC and 2% terminal growth that returns **~$1,170.8M enterprise value**,
**~$970.8M equity**, and **~$9.71 per share**.
