# Quality of Earnings Bridge (`qoe-bridge`)

Rebuilds diligence-adjusted EBITDA from reported EBITDA, tests each management addback one at a time, and records adjustments management missed.

A **native FundExecs skill** (PE department pack · Diligence + Valuation). It runs through the
skill runtime (`lib/skills/runner.ts`) using the shared evidence grades (`lib/pe/evidence.ts`) and return hurdles
(`lib/pe/returns-hurdles.ts`).

## Contract

|                   |                                                                                       |
|-------------------|---------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis                                                     |
| **Executives**    | diligence · analyst                                                                   |
| **Inputs**        | `reportedEbitda`                                                                      |
| **Outputs**       | `rows`, `diligenceAdjustedEbitda`, `deltaVsManagement`, `addbacksNotAccepted`, `gate` |
| **Downstream**    | bid-range, red-flag-register, ic-memo, lbo                                            |

## Guardrails

- No adjustment is accepted without a document reference; an accepted call with no support is downgraded and does not move the number.
- Adjustments are listed individually, never netted.
- Management's stated adjusted EBITDA is reconciled against its own bridge.
- The adjusted figure is not IC-memo-ready until the financial DD lead signs it.

Firm-specific settings are per organization (`org_pe_root_files`); without them the skill
runs on labelled standing defaults.
