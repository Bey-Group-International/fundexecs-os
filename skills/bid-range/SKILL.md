# Bid Price Range (`bid-range`)

Solves the maximum entry price that clears the return hurdle in the base and downside cases using the lbo core, subtracts supported red-flag price items, and sets the result against the comps range.

A **native FundExecs skill** (PE department pack · Diligence + Valuation). It runs through the
skill runtime (`lib/skills/runner.ts`) using the shared evidence grades (`lib/pe/evidence.ts`) and return hurdles
(`lib/pe/returns-hurdles.ts`).

## Contract

|                   |                                       |
|-------------------|---------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis |
| **Executives**    | analyst · investment_committee |
| **Inputs**        | `ebitda` |
| **Outputs**       | `base`, `downside`, `walkAway`, `target`, `opening`, `versusComps`, `note`, `gate` |
| **Downstream**    | ic-memo, returns |

## Guardrails

- Walk-away is re-tested against the hurdles; the note says so plainly if it does not clear.
- Opening and target bids are computed only from discounts the deal team supplies, never invented.
- Default hurdles are labelled 'run on default settings'.
- The IC sets the price; this note informs it.

Firm-specific settings are per organization (`org_pe_root_files`); without them the skill
runs on labelled standing defaults.
