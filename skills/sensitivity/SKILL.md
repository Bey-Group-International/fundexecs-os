# Sensitivity & Break-evens (`sensitivity`)

Flexes the assumptions the deal team names over the same LBO core as the lbo and bid-range skills: one-way flexes, two-way tables, named cases, and the entry multiple, exit multiple and growth at which returns just meet the hurdle.

A **native FundExecs skill** (PE department pack · Valuation). It runs through the
skill runtime (`lib/skills/runner.ts`) using the shared evidence grades (`lib/pe/evidence.ts`) and return hurdles
(`lib/pe/returns-hurdles.ts`).

## Contract

|                   |                                                                               |
|-------------------|-------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis                                             |
| **Executives**    | analyst · investment_committee                                                |
| **Inputs**        | `entryEbitda`, `entryMultiple`, `holdYears`                                   |
| **Outputs**       | `base`, `oneWay`, `twoWay`, `cases`, `breakEvens`, `warnings`, `note`, `gate` |
| **Downstream**    | bid-range, ic-memo, returns                                                   |

## Guardrails

- Ranges and cases come only from the input; the skill never picks a range or a case for the deal team.
- A set of cases with no combined downside (two or more assumptions moving together) is flagged: single-variable stresses understate how things go wrong together.
- Break-evens move one assumption at a time against the firm's base hurdle (standing default labelled) and report room or shortfall in the safe direction.
- A downside case is tested only against a downside hurdle the firm has set; otherwise it is reported, not tested. The deal lead chooses the case the price rests on.

Firm-specific settings are per organization (`org_pe_root_files`); without them the skill
runs on labelled standing defaults.
