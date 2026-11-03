# Exit Strategy & Route Comparison (`exit-routes`)

Compares exit routes on net proceeds, returns against the hurdle, timing against fund life and the deal team's stated certainty, and recommends a primary and fallback by a stated rule.

A **native FundExecs skill** (PE department pack · Exit + IPO). It runs through the
skill runtime (`lib/skills/runner.ts`) using the shared evidence grades (`lib/pe/evidence.ts`) and return hurdles
(`lib/pe/returns-hurdles.ts`).

## Contract

|                   |                                       |
|-------------------|---------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis |
| **Executives**    | analyst · investment_committee |
| **Inputs**        | `company`, `equityInvested`, `ownershipPct`, `netDebtAtExit`, `yearsHeld`, `routes` |
| **Outputs**       | `routes`, `primary`, `fallback`, `orderingRule`, `gate` |
| **Downstream**    | exit-readiness, buyer-list, final-investment-report |

## Guardrails

- Every value range must cite its basis; a route without one is not eligible.
- The hurdle is tested at the LOW end of the range and the fund-life constraint is explicit.
- No market view or probability is invented; certainty is the deal team's stated view.
- The IC approves the exit route.

Firm-specific settings are per organization (`org_pe_root_files`); without them the skill
runs on labelled standing defaults.
