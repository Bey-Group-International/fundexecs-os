# Red Flag Register (`red-flag-register`)

Pulls findings from every diligence workstream into one register: de-duplicated at worst case, ranked by impact, graded by evidence, with blind-spot workstreams named.

A **native FundExecs skill** (PE department pack · Diligence + Valuation). It runs through the
skill runtime (`lib/skills/runner.ts`) using the shared evidence grades (`lib/pe/evidence.ts`) and return hurdles
(`lib/pe/returns-hurdles.ts`).

## Contract

|                   |                                       |
|-------------------|---------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis |
| **Executives**    | diligence · investment_committee |
| **Inputs**        | `findings`, `workstreamsRun` |
| **Outputs**       | `register`, `blindSpots`, `supportedPriceAdjustment`, `unsupportedPriceClaims`, `challenges`, `gate` |
| **Downstream**    | bid-range, ic-memo |

## Guardrails

- A price claim resting on C / U evidence is excluded from the price adjustment and listed separately.
- Ungraded findings are U (untested) and labelled so.
- Workstreams that did not run are named as blind spots.
- The challenge pass is rule-based; run a second-model adversarial pass for IC.

Firm-specific settings are per organization (`org_pe_root_files`); without them the skill
runs on labelled standing defaults.
