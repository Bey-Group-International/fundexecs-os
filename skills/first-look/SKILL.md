# First Look Screen (`first-look`)

Reads the headline numbers of a teaser or CIM and returns go / no-go / ask-more against the mandate tests. Reported and adjusted EBITDA are separated and every adjustment is listed individually.

A **native FundExecs skill** (PE department pack · Deal Sourcing). It runs through the
skill runtime (`lib/skills/runner.ts`) on the shared mandate-test engine
(`lib/pe/mandate-tests.ts`), so mandate-screen, target-screen and first-look cannot
disagree about what passes the mandate.

## Contract

|                   |                                       |
|-------------------|---------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis |
| **Executives**    | deal_sourcer · analyst · investment_committee |
| **Inputs**        | `mandate`, `deal.name` |
| **Outputs**       | `view`, `reason`, `ebitdaBridge`, `threeReasonsItCouldFail`, `threeFactsThatWouldKillIt`, `gate` |
| **Downstream**    | screen-deal, returns, dd-checklist, ic-memo |

## Guardrails

- Adjusted EBITDA is a calculation from listed adjustments; the seller's figure is only a claim to reconcile.
- A number with no source reference is graded U and cannot support a go.
- A hard limit that cannot be tested yields ask-more, never a silent pass.
- The deal lead owns the go / no-go; the skill never approves anything.

The mandate it tests against is per organization (`org_pe_root_files`, key `mandate`).
With no approved mandate it runs **default-screened** and labels every result so.
