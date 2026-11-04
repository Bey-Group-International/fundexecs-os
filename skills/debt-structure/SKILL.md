# Debt Structure (`debt-structure`)

Sizes and shapes the debt package from the tranches you propose, rolls the balance, computes leverage, interest cover and fixed-charge cover by period in the operating and downside cases, tests the covenants you list, and checks the structure against the firm's financing limits.

A **native FundExecs skill** (PE department pack · Valuation). It runs through the
skill runtime (`lib/skills/runner.ts`) using the shared evidence grades (`lib/pe/evidence.ts`) and return hurdles
(`lib/pe/returns-hurdles.ts`).

## Contract

|                   |                                       |
|-------------------|---------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis |
| **Executives**    | analyst · legal_closing |
| **Inputs**        | `dealName`, `entryEbitda`, `tranches`, `base` |
| **Outputs**       | `tranches`, `closing`, `base`, `downside`, `covenants`, `policyChecks`, `gate` |
| **Downstream**    | financing-terms, bid-range, covenant-watch, ic-memo |

## Guardrails

- Covenant headroom is reported at the TIGHTEST period in each case, never an average.
- A covenant that cites no term-sheet source is flagged: headroom on the model's definition may differ from the lender's.
- The balance falls by mandatory amortisation only (no sweep or prepayment) and interest is annualised on the opening balance; both are stated as assumptions.
- An unsized or unpriced tranche is flagged and its metrics are left null, never estimated. The financing lead approves the structure before lenders see it.

Firm-specific settings are per organization (`org_pe_root_files`); without them the skill
runs on labelled standing defaults.
