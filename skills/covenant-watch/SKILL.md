# Covenant Watch (`covenant-watch`)

Calculates each financial covenant per period on the credit agreement's own definitions, shows headroom now and forward, and flags headroom below the firm's warning threshold.

A **native FundExecs skill** (PE department pack · Execution + Portfolio). It runs through the
skill runtime (`lib/skills/runner.ts`) using the shared evidence grades (`lib/pe/evidence.ts`) and return hurdles
(`lib/pe/returns-hurdles.ts`).

## Contract

|                   |                                       |
|-------------------|---------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis |
| **Executives**    | portfolio_ops · fund_admin |
| **Inputs**        | `company`, `covenants`, `periods` |
| **Outputs**       | `covenants`, `excludedAddbacks`, `warnThresholdPct`, `cureOptions`, `gate` |
| **Downstream**    | portfolio-review, cash-13-week |

## Guardrails

- A covenant must quote its agreement clause; an unquoted covenant is not calculated.
- An EBITDA addback counts only when it cites the clause that permits it; others are excluded and listed.
- Cure options are quoted from the agreement, never assumed.
- The portfolio CFO and the fund's finance lead sign the compliance certificate.

Firm-specific settings are per organization (`org_pe_root_files`); without them the skill
runs on labelled standing defaults.
