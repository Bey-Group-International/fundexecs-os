# KPI Variance Tracking (`kpi-variance`)

Variance of each KPI to budget and prior year, flagged on the firm's materiality, direction-aware, with a computed trend test and driver decomposition that must sum to the variance.

A **native FundExecs skill** (PE department pack · Execution + Portfolio). It runs through the
skill runtime (`lib/skills/runner.ts`) using the shared evidence grades (`lib/pe/evidence.ts`) and return hurdles
(`lib/pe/returns-hurdles.ts`).

## Contract

|                   |                                       |
|-------------------|---------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis |
| **Executives**    | portfolio_ops |
| **Inputs**        | `company`, `period`, `kpis` |
| **Outputs**       | `rows`, `materialCount`, `policy`, `gate` |
| **Downstream**    | portfolio-review, value-creation, lp-update |

## Guardrails

- Materiality is the firm's percent AND absolute floor when set; the default is labelled.
- Drivers must sum to the variance; the residual is reported.
- A classification with no evidence is flagged as management's word only.
- A 'timing' or 'one-off' call that the series contradicts is challenged.

Firm-specific settings are per organization (`org_pe_root_files`); without them the skill
runs on labelled standing defaults.
