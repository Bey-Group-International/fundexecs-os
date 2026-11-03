# IPO Readiness (`ipo-readiness`)

Assesses readiness for a listing across reporting, governance, controls and equity story, against the requirements the user names for the target exchange.

A **native FundExecs skill** (PE department pack · Exit + IPO). It runs through the
skill runtime (`lib/skills/runner.ts`) using the shared evidence grades (`lib/pe/evidence.ts`) and return hurdles
(`lib/pe/returns-hurdles.ts`).

## Contract

|                   |                                                                                                           |
|-------------------|-----------------------------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis                                                                         |
| **Executives**    | portfolio_ops · legal_closing                                                                             |
| **Inputs**        | `company`, `exchange`, `items`                                                                            |
| **Outputs**       | `items`, `counts`, `ready`, `blockers`, `weeksIfParallel`, `weeksIfSerial`, `uncitedRequirements`, `gate` |
| **Downstream**    | exit-routes, final-investment-report                                                                      |

## Guardrails

- The skill holds no listing rules; every requirement must cite its source rule or is flagged.
- Each gap needs a time estimate; timing is shown parallel and serial.
- Counsel and the sponsor confirm the requirements.
- The board decides whether to pursue the listing.

Firm-specific settings are per organization (`org_pe_root_files`); without them the skill
runs on labelled standing defaults.
