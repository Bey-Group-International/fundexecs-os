# Technology DD Issues List (`technology-dd`)

Assesses the technology stack, security posture and technical debt, and what they will cost to fix: end-of-life components, security findings rated by a stated rule, the pen test's age, a capacity test using the plan's own growth, key technical people and their retention risk, and remediation cost ranges that need a stated basis.

A **native FundExecs skill** (PE department pack · Due Diligence). It runs through the
skill runtime (`lib/skills/runner.ts`) using the shared evidence grades and policy (`lib/pe/evidence.ts`) and issue engine
(`lib/pe/dd-issues.ts`).

## Contract

|                   |                                                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Approval tier** | 1 — internal, reversible analysis                                                                                                         |
| **Executives**    | diligence · analyst                                                                                                                       |
| **Inputs**        |                                                                                                                                           |
| **Outputs**       | `stack`, `penTest`, `capacity`, `issues`, `rangeTotal`, `priceSupportedRange`, `documentGaps`, `handoff`, `basisOfReview`, `note`, `gate` |
| **Downstream**    | red-flag-register, dd-checklist                                                                                                           |

## Guardrails

- Every risk cites a document or test; one that does not is kept, graded U (untested) and listed.
- A cost range appears only with a stated basis; the part of the total that the firm's evidence policy lets support a price is stated separately (standing default labelled).
- The capacity test uses the plan's own growth in each metric; 'tight' is flagged only against a threshold the caller supplies, and a breach is always flagged.
- This is a document review: the skill does not read code, even when repository access is granted. A technical reviewer confirms the risk ratings.

Firm-specific settings are per organization (`org_pe_root_files`); without them the skill
runs on labelled standing defaults.
