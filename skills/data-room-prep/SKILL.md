# Data Room Preparation (`data-room-prep`)

Builds the data room index by workstream, maps each expected buyer request to a document or a gap, lists documents needing redaction or staging, and opens a Q&A log row per gap.

A **native FundExecs skill** (PE department pack · Exit + IPO). It runs through the
skill runtime (`lib/skills/runner.ts`) using the shared evidence grades (`lib/pe/evidence.ts`) and return hurdles
(`lib/pe/returns-hurdles.ts`).

## Contract

|                   |                                                               |
|-------------------|---------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis                             |
| **Executives**    | legal_closing · diligence                                     |
| **Inputs**        | `company`, `documents`                                        |
| **Outputs**       | `index`, `coverage`, `gaps`, `redactionList`, `qaLog`, `gate` |
| **Downstream**    | exit-readiness, buyer-list                                    |

## Guardrails

- Every expected request maps to a document or a gap.
- Competitor-sensitive documents must be staged; personal data redacted; third-party-confidential items go to counsel.
- A generic default request list is labelled and is no substitute for the buyer's real list.
- Counsel approves the redaction list before the room opens.

Firm-specific settings are per organization (`org_pe_root_files`); without them the skill
runs on labelled standing defaults.
