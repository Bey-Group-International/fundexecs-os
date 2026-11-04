# Legal DD Issues List (`legal-dd`)

Turns the legal data room into a ranked issues list for counsel: a contract abstract table, issues rated red, amber or green with the document and clause they rest on, missing documents listed as gaps, and change-of-control, exclusivity and IP-title issues derived by stated rules.

A **native FundExecs skill** (PE department pack · Due Diligence). It runs through the
skill runtime (`lib/skills/runner.ts`) using the shared evidence grades (`lib/pe/evidence.ts`) and issue engine
(`lib/pe/dd-issues.ts`).

## Contract

|                   |                                                                                |
| ----------------- | ------------------------------------------------------------------------------ |
| **Approval tier** | 1 — internal, reversible analysis                                              |
| **Executives**    | diligence · legal_closing                                                      |
| **Inputs**        |                                                                                |
| **Outputs**       | `issues`, `abstract`, `documentGaps`, `notReviewed`, `handoff`, `note`, `gate` |
| **Downstream**    | red-flag-register, dd-checklist                                                |

## Guardrails

- Every issue cites a document and a clause; one that does not is kept, graded U (untested) and listed.
- A contract field that is not stated stays 'not stated' and is named; nothing in the abstract is guessed.
- Missing documents and categories not reviewed are listed as gaps; an empty list is not a clean bill.
- This is an issues list for counsel, not legal advice. Deal counsel reviews and owns the legal findings.

Firm-specific settings are per organization (`org_pe_root_files`); without them the skill
runs on labelled standing defaults.
