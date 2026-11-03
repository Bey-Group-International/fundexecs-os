# Final Investment Report (`final-investment-report`)

Calculates realised IRR from dated cash flows and MOIC, bridges returns into EBITDA growth, multiple change and deleveraging, ties them to the fund's records, and reviews the entry thesis claim by claim.

A **native FundExecs skill** (PE department pack · Exit + IPO). It runs through the
skill runtime (`lib/skills/runner.ts`) using the shared evidence grades (`lib/pe/evidence.ts`) and return hurdles
(`lib/pe/returns-hurdles.ts`).

## Contract

|                   |                                                                                     |
|-------------------|-------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis                                                   |
| **Executives**    | investment_committee · analyst                                                      |
| **Inputs**        | `company`, `cashFlows`, `entry`, `exit`                                             |
| **Outputs**       | `realised`, `hurdleVerdict`, `bridge`, `fundTie`, `thesisReview`, `lessons`, `gate` |
| **Downstream**    | lp-update                                                                           |

## Guardrails

- IRR uses dated cash flows (act/365), never an annual approximation.
- The attribution sums exactly to value created and is labelled analytical, not causal.
- Returns that do not tie to the fund's records are flagged.
- Each entry-thesis claim needs a recorded outcome. The IC reviews the report.

Firm-specific settings are per organization (`org_pe_root_files`); without them the skill
runs on labelled standing defaults.
