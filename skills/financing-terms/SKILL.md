# Financing Terms Comparison (`financing-terms`)

Compares lender term sheets like for like: annualised all-in cost with the method shown, cost and flexibility ranked separately, checked against the firm's financing policy, with downside-biting terms flagged.

A **native FundExecs skill** (PE department pack · Execution + Portfolio). It runs through the
skill runtime (`lib/skills/runner.ts`) using the shared evidence grades (`lib/pe/evidence.ts`) and return hurdles
(`lib/pe/returns-hurdles.ts`).

## Contract

|                   |                                       |
|-------------------|---------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis |
| **Executives**    | analyst · legal_closing |
| **Inputs**        | `baseRatePct`, `offers` |
| **Outputs**       | `rows`, `costMethod`, `flexibilityMethod`, `gate` |
| **Downstream**    | bid-range, ic-memo, closing-checklist |

## Guardrails

- Every term must cite a term-sheet page; uncited terms are marked.
- Cost and flexibility are ranked separately and the methods are shown.
- The skill ranks; the financing lead selects the lender group.
- Default policy limits are labelled 'run on default settings'.

Firm-specific settings are per organization (`org_pe_root_files`); without them the skill
runs on labelled standing defaults.
