# Preliminary Returns Case (`returns`)

Build a first-pass **LBO returns case** for a deal and return a structured,
provenanced result — entry and exit economics, **MOIC** and **IRR**, remaining
debt, and a bear / base / bull **sensitivity** on the exit multiple — together
with the assumptions applied, the key risks, and the material data that is
missing.

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
| **Executives**    | Analyst · Investment Committee                                                                      |
| **Inputs**        | `deal` (at minimum `companyName`) + optional `assumptions`                                          |
| **Outputs**       | `entryEv`, `entryEquity`, `exitEbitda`, `exitEv`, `exitEquity`, `moic`, `irrPct`, `remainingDebt`, `sensitivities`, `assumptionsUsed`, `keyRisks`, `missingFields`, `recommendedAction` |
| **Artifacts**     | `model`, `analysis`                                                                                 |
| **Downstream**    | `ic-memo`                                                                                           |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Guardrails (the reason this is a skill, not a prompt)

- **Never fabricates a financial value.** A missing input is *flagged* in
  `missingFields`, never invented. `moic` / `irrPct` are computed **only** when
  entry EBITDA and entry multiple are present — otherwise they are `null`.
- **Separates epistemics.** Every provided figure is a `fact`; every default
  (hold period, exit multiple, EBITDA CAGR, debt paydown) is a labelled
  `assumption`; every computed number (EV, equity, MOIC, IRR) is a `calculation`.
  These are returned in `sources` and never collapsed.
- **Advisory only.** The case informs analysis; it can never authorize a
  capital-binding (Tier 3) action. The runtime enforces the tier and the
  executive's approval ceiling.
- **Deterministic + testable.** Every number comes from the pure core in
  `lib/skills/catalog/returns.ts`, tested independently of any model.

## The LBO math (all figures in $M)

1. `entryEv = entryEbitda × entryMultiple`
2. `entryEquity = equityContribution ?? (entryEv − netDebt)`
3. Defaults (each an **assumption** when not supplied): `holdYears = 5`,
   `exitMultiple = entryMultiple`, `ebitdaCagr = 0`, `annualDebtPaydown = 0`.
4. `exitEbitda = entryEbitda × (1 + ebitdaCagr)^holdYears`
5. `exitEv = exitEbitda × exitMultiple`
6. `remainingDebt = max(0, netDebt − annualDebtPaydown × holdYears)`
7. `exitEquity = exitEv − remainingDebt`
8. `moic = exitEquity ÷ entryEquity` (2 dp); `irrPct = (moic^(1/holdYears) − 1) × 100` (1 dp)

**Sensitivities** re-run MOIC / IRR at `exitMultiple − 1` (bear), `exitMultiple`
(base), and `exitMultiple + 1` (bull), so `bull > base > bear`.

## Example

See [`examples/example-1.json`](./examples/example-1.json) — a buyout that
returns **2.0× MOIC / 14.9% IRR** over a 5-year hold at a flat 10.0× exit.
