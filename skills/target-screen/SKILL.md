# Target Screening (`target-screen`)

Screens a supplied list of companies against the mandate tests: hard limits first (a fail ends the screen), then scored preferences, with needs-data wherever a field is empty. Survivors are ranked by score.

A **native FundExecs skill** (PE department pack · Deal Sourcing). It runs through the
skill runtime (`lib/skills/runner.ts`) on the shared mandate-test engine
(`lib/pe/mandate-tests.ts`), so mandate-screen, target-screen and first-look cannot
disagree about what passes the mandate.

## Contract

|                   |                                                    |
|-------------------|----------------------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis                  |
| **Executives**    | deal_sourcer · analyst                             |
| **Inputs**        | `mandate`, `targets`                               |
| **Outputs**       | `results`, `counts`, `basis`, `limitation`, `gate` |
| **Downstream**    | first-look, screen-deal, dd-checklist              |

## Guardrails

- Never invents a number to make a company pass; empty fields are needs-data.
- Every fail cites the criterion (and clause) it failed.
- Ranks only the list it is given — never fabricates a company.
- A pass means worth a call, not worth a bid; an associate reviews every pass before outreach.

The mandate it tests against is per organization (`org_pe_root_files`, key `mandate`).
With no approved mandate it runs **default-screened** and labels every result so.
