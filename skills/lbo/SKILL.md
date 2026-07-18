# LBO Returns Model (`lbo`)

Compute a **leveraged-buyout returns model** from caller-supplied assumptions —
sources & uses at entry, the exit equity bridge, and the resulting **MOIC** and
**IRR** — and return a structured, provenanced result together with the
assumptions applied and the required inputs that are missing.

This is a **native FundExecs skill**: a versioned, schema-defined, policy-governed
reusable workflow. It runs through the skill runtime (`lib/skills/runner.ts`),
which validates the input, checks that the assigned executive is permitted to run
it, executes the deterministic core, validates the output, resolves the approval
tier, and persists a `skill_runs` record with an audit event.

## Contract

|                   |                                                                                                                                     |
|-------------------|-------------------------------------------------------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis                                                                                                   |
| **Risk**          | low                                                                                                                                 |
| **Executives**    | Analyst                                                                                                                             |
| **Inputs**        | optional `entryEbitda`, `entryMultiple`, `leverageMultiple` / `debtAmount`, `holdYears`, `exitMultiple`, `ebitdaGrowthRate`, `annualDebtPaydown`, `transactionFeesPct` |
| **Outputs**       | `entryEV`, `entryEquity`, `debt`, `exitEbitda`, `exitEV`, `exitEquity`, `moic`, `irr`, `assumptions`, `missingInputs`, `recommendedAction` |
| **Artifacts**     | `analysis`                                                                                                                          |
| **Downstream**    | `returns`, `ic-memo`                                                                                                                |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Guardrails (the reason this is a skill, not a prompt)

- **Never fabricates a financial assumption.** The model computes only from what
  the caller supplies. `entryEbitda`, `entryMultiple`, and `holdYears` are
  required to compute returns — if any is missing, MOIC, IRR, and exit equity are
  `null` and the missing field is listed in `missingInputs`, never guessed.
- **Conservative defaults are labelled, not hidden.** An omitted `exitMultiple`
  defaults to `entryMultiple` (no multiple expansion); `ebitdaGrowthRate`,
  `annualDebtPaydown`, and `transactionFeesPct` default to 0; a deal with no debt
  is modelled all-equity. Each is a labelled `assumption`, never a `fact`.
- **Separates epistemics.** Every supplied figure is a `fact`; every derived
  figure — entry EV, debt, entry equity, exit EBITDA/EV/equity, MOIC, IRR — is a
  `calculation`. These are returned in `sources` and never collapsed.
- **Null-safe returns.** MOIC requires a positive entry equity; if debt ≥ entry EV
  + fees, entry equity is non-positive and MOIC/IRR are `null` with a flag.
- **Advisory only.** The model informs analysis; it can never authorize a
  capital-binding (Tier 3) action. The runtime enforces the tier and the
  executive's approval ceiling.
- **Deterministic + testable.** Every number comes from the pure core in
  `lib/skills/catalog/lbo.ts`, tested independently of any model.

## The LBO math

Defaults, each a labelled **assumption** when not supplied: `exitMultiple =
entryMultiple`, `ebitdaGrowthRate = 0`, `annualDebtPaydown = 0`,
`transactionFeesPct = 0`. When both `debtAmount` and `leverageMultiple` are
supplied, `debtAmount` takes precedence.

1. `entryEV = entryEbitda × entryMultiple`
2. `debt = debtAmount ?? leverageMultiple × entryEbitda` (0, all-equity, if neither)
3. `fees = transactionFeesPct × entryEV`
4. `entryEquity = entryEV + fees − debt`
5. `exitEbitda = entryEbitda × (1 + ebitdaGrowthRate)^holdYears`
6. `exitEV = exitEbitda × exitMultiple`
7. `exitNetDebt = max(0, debt − annualDebtPaydown)`
8. `exitEquity = exitEV − exitNetDebt`
9. `MOIC = exitEquity / entryEquity` (`null` when `entryEquity ≤ 0`)
10. `IRR = MOIC^(1/holdYears) − 1` (`null` when MOIC is `null` or `≤ 0`)

## Example

See [`examples/example-1.json`](./examples/example-1.json) — a five-year LBO,
$100M EBITDA in at 10x with $600M of debt, exiting at 12x with $100M of debt paid
down: **~$400M equity in**, **~$700M out**, **MOIC ~1.75x**, **IRR ~11.8%**.
