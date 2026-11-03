# 13-Week Cash Flow (`cash-13-week`)

Rolls a direct weekly cash forecast, tests closing cash against the liquidity minimum and facility, builds a downside-receipts case, and logs forecast accuracy against actuals.

A **native FundExecs skill** (PE department pack · Execution + Portfolio). It runs through the
skill runtime (`lib/skills/runner.ts`) using the shared evidence grades (`lib/pe/evidence.ts`) and return hurdles
(`lib/pe/returns-hurdles.ts`).

## Contract

|                   |                                       |
|-------------------|---------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis |
| **Executives**    | portfolio_ops · fund_admin |
| **Inputs**        | `company`, `openingCash`, `weeks` |
| **Outputs**       | `base`, `downside`, `accuracy`, `gate` |
| **Downstream**    | covenant-watch, portfolio-review |

## Guardrails

- Opening cash not tied to the bank statements is flagged.
- A downside receipts haircut is the user's number; it is never defaulted.
- Facility shortfall against the minimum is sized and compared with the available facility.
- The portfolio company CFO owns the forecast.

Firm-specific settings are per organization (`org_pe_root_files`); without them the skill
runs on labelled standing defaults.
