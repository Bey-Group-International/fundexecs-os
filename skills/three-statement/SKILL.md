# Three-Statement Projection (`three-statement`)

Project a simplified, **internally-consistent** three-statement model (income
statement, cash flow, balance sheet) for N years from **caller-supplied** drivers,
and **tie out** the balance sheet (assets = liabilities + equity) every year.

This is a **native FundExecs skill**: a versioned, schema-defined, policy-governed
reusable workflow that runs through the skill runtime (`lib/skills/runner.ts`) —
input validation, executive permission, deterministic core, output validation,
approval-tier resolution, and a persisted `skill_runs` record with an audit event.

## Contract

|                   |                                                                                             |
|-------------------|---------------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis                                                           |
| **Risk**          | low                                                                                         |
| **Executives**    | Analyst                                                                                     |
| **Inputs**        | horizon + operating drivers (revenue, margins, D&A/capex/NWC %s, tax) + opening balance sheet |
| **Outputs**       | `years`, `projection`, `balances`, `missingInputs`, `recommendedAction`                     |
| **Artifacts**     | `analysis`                                                                                   |
| **Downstream**    | `dcf`, `ic-memo`                                                                             |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Guardrail (the reason this is a skill, not a prompt)

- **Never fabricates a driver.** The required drivers are `baseRevenue`,
  `revenueGrowth`, `ebitdaMargin`, `daPctOfRevenue`, `taxRate`,
  `capexPctOfRevenue`, and `nwcPctOfRevenue`. If any is missing the skill returns
  an **empty** `projection`, flags the gap in `missingInputs`, and produces no
  model — a missing driver is never invented.
- **Ties out by construction.** The load-bearing output is the balance-sheet
  tie-out check. With debt held constant and equity rolling by net income, the
  balance difference is invariant across years and equals the opening difference —
  so `balanceCheck` is ~0 every year and `balances` is `true`.
- **Separates epistemics.** Every supplied driver is a `fact`; every projected
  line item is a `calculation`; the equity plug and the held-constant debt are
  `assumption`s. Nothing is presented as a fact that was not supplied.
- **Advisory only.** Distribution or sign-off are separate, prohibited actions —
  the skill prepares a projection for review.

## How the model is built

For each year `t = 1..N`:

```
revenue   = prevRevenue × (1 + revenueGrowth)
ebitda    = ebitdaMargin × revenue
da        = daPctOfRevenue × revenue
ebit      = ebitda − da
tax       = max(0, ebit) × taxRate
netIncome = ebit − tax
capex     = capexPctOfRevenue × revenue
nwc       = nwcPctOfRevenue × revenue
fcf       = netIncome + da − capex − (nwc − prevNwc)
cash      = prevCash + fcf
ppe       = prevPPE + capex − da
equity    = prevEquity + netIncome
debt      = beginningDebt              (held constant)
balanceCheck = round(cash + nwc + ppe − (debt + equity), 2)
```

## Opening balance sheet

`beginningCash`, `beginningPPE`, and `beginningDebt` default to 0 (labelled
assumptions). Opening NWC is `nwcPctOfRevenue × baseRevenue`. When `beginningEquity`
is **omitted**, it is **derived as a balancing plug** —
`beginningCash + beginningNWC + beginningPPE − beginningDebt` — and labelled an
assumption, so the opening balance sheet ties out. When `beginningEquity` **is**
supplied and the opening balance sheet does **not** tie out, the imbalance is
flagged in `missingInputs` and never silently adjusted; it propagates, so
`balances` reports `false`.
