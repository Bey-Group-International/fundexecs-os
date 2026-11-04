# Operational DD Memo (`operational-dd`)

Tests whether operations can deliver the plan: a cost map tied to the reported cost base and set against supplied benchmarks, a capacity test on the plan's own volume, key person and supplier dependencies, the plan's KPI moves against the firm's materiality, and an improvement register in which every improvement is evidenced or marked untested.

A **native FundExecs skill** (PE department pack · Due Diligence). It runs through the
skill runtime (`lib/skills/runner.ts`) using the shared evidence grades and policy (`lib/pe/evidence.ts`) and issue engine
(`lib/pe/dd-issues.ts`).

## Contract

|                   |                                                                                                                                                                |
|-------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis                                                                                                                              |
| **Executives**    | diligence · analyst                                                                                                                                            |
| **Inputs**        |                                                                                                                                                                |
| **Outputs**       | `costMap`, `capacity`, `suppliers`, `kpis`, `improvements`, `planSavings`, `outsidePlan`, `issues`, `documentGaps`, `handoff`, `basisOfReview`, `note`, `gate` |
| **Downstream**    | red-flag-register, dd-checklist                                                                                                                                |

## Guardrails

- The capacity test uses the plan's own volume; a plan volume that is not supplied is flagged and the test is not run, never estimated.
- Every improvement cites evidence or is marked untested; an untested improvement in the plan is flagged and its saving cannot support a price.
- A saving appears only with a stated basis; the plan's savings are split by evidence, and improvements outside the plan are listed and never added to them.
- Desk-based operational DD misses what a site visit shows: pair it with a visit before IC. The operating partner signs the improvement register.

Firm-specific settings are per organization (`org_pe_root_files`); without them the skill
runs on labelled standing defaults.
