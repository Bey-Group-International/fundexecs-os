# Revenue Quality & Customer Concentration (`revenue-quality`)

From customer-by-year revenue: ties the file to reported revenue, computes top-1/5/10 concentration (merging related customers), splits revenue by class, computes retention, and lists key customers with their change-of-control status.

A **native FundExecs skill** (PE department pack · Diligence + Valuation). It runs through the
skill runtime (`lib/skills/runner.ts`) using the shared evidence grades (`lib/pe/evidence.ts`) and return hurdles
(`lib/pe/returns-hurdles.ts`).

## Contract

|                   |                                       |
|-------------------|---------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis |
| **Executives**    | diligence · analyst |
| **Inputs**        | `years`, `reportedRevenue`, `customers` |
| **Outputs**       | `byYear`, `latestClassSplit`, `retention`, `keyCustomers`, `gate` |
| **Downstream**    | red-flag-register, bid-range, ic-memo |

## Guardrails

- Customers under common ownership are concentrated together (relatedGroup).
- The customer file must tie to reported revenue; breaks are reported.
- Change-of-control is taken only as supplied; unconfirmed stays unknown.
- The deal lead decides whether concentration needs price, structure or a condition.

Firm-specific settings are per organization (`org_pe_root_files`); without them the skill
runs on labelled standing defaults.
