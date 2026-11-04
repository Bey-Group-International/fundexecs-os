# Tax DD Issues List (`tax-dd`)

Identifies historic tax exposures and structuring questions for the tax adviser: open years by jurisdiction reconciled from the accounts to the computation, exposures by type with the document each rests on, a range only where a basis is stated, and the questions the adviser should be asked.

A **native FundExecs skill** (PE department pack · Due Diligence). It runs through the
skill runtime (`lib/skills/runner.ts`) using the shared evidence grades (`lib/pe/evidence.ts`) and issue engine
(`lib/pe/dd-issues.ts`).

## Contract

|                   |                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Approval tier** | 1 — internal, reversible analysis                                                                                  |
| **Executives**    | diligence · legal_closing                                                                                          |
| **Inputs**        |                                                                                                                    |
| **Outputs**       | `issues`, `years`, `documentGaps`, `typesNotReviewed`, `rangeTotal`, `adviserQuestions`, `handoff`, `note`, `gate` |
| **Downstream**    | red-flag-register, dd-checklist                                                                                    |

## Guardrails

- An open year with no computation is named and graded U; no year is assumed clean.
- No exposure range appears without a stated basis; the total is a plain sum of supported ranges and overlaps are not netted.
- Every exposure cites a document or is graded U; missing documents and exposure types not reviewed are listed as gaps.
- The skill flags issues; it does not quantify or opine. The tax adviser confirms each exposure before it moves into the price or SPA.

Firm-specific settings are per organization (`org_pe_root_files`); without them the skill
runs on labelled standing defaults.
