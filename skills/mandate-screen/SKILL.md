# Investment Mandate Screen (`mandate-screen`)

Turns the fund's mandate into a written, testable screen: every criterion with its test, threshold, type (hard limit / preference / kill fact) and source, plus the open questions that block sign-off.

A **native FundExecs skill** (PE department pack · Deal Sourcing). It runs through the
skill runtime (`lib/skills/runner.ts`) on the shared mandate-test engine
(`lib/pe/mandate-tests.ts`), so mandate-screen, target-screen and first-look cannot
disagree about what passes the mandate.

## Contract

|                   |                                                                       |
|-------------------|-----------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis                                     |
| **Executives**    | deal_sourcer · analyst · investment_committee                         |
| **Inputs**        | `mandate`                                                             |
| **Outputs**       | `rows`, `issues`, `openQuestions`, `readyForSignOff`, `basis`, `gate` |
| **Downstream**    | target-screen, first-look, screen-deal, ic-memo                       |

## Guardrails

- A criterion with no number is a blocker, never defaulted.
- A hard limit with no LPA clause or side-letter source is flagged as a preference in disguise.
- Contradictions (min above max, preference outside a hard band) are surfaced, not resolved silently.
- Sign-off is a human gate; the skill only reports readiness.

The mandate it tests against is per organization (`org_pe_root_files`, key `mandate`).
With no approved mandate it runs **default-screened** and labels every result so.
