# Exit Readiness & Equity Story (`exit-readiness`)

Assesses the business the way a buyer's diligence will, lists what to fix before launch with owners and times, and keeps only equity-story claims that have a proof document.

A **native FundExecs skill** (PE department pack · Exit + IPO). It runs through the
skill runtime (`lib/skills/runner.ts`) using the shared evidence grades (`lib/pe/evidence.ts`) and return hurdles
(`lib/pe/returns-hurdles.ts`).

## Contract

|                   |                                       |
|-------------------|---------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis |
| **Executives**    | portfolio_ops · diligence |
| **Inputs**        | `company`, `items` |
| **Outputs**       | `items`, `counts`, `ready`, `blockers`, `weeksIfParallel`, `weeksIfSerial`, `equityStory`, `gate` |
| **Downstream**    | data-room-prep, exit-routes, ipo-readiness |

## Guardrails

- A requirement marked met without evidence is treated as unverified.
- Equity-story claims without proof are removed and listed, never softened.
- Timing is reported both as parallel and as serial; the optimistic one is not chosen for you.
- The deal lead decides launch timing.

Firm-specific settings are per organization (`org_pe_root_files`); without them the skill
runs on labelled standing defaults.
