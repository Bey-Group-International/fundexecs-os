# Investor Profile (`investor-profile`)

Build a structured **LP/investor profile** from **caller-supplied** data: organize
the known facts, assess fit against a fund's targeting criteria, and **flag the
fields that are missing**.

This is a **native FundExecs skill**: a versioned, schema-defined, policy-governed
reusable workflow that runs through the skill runtime (`lib/skills/runner.ts`) —
input validation, executive permission, deterministic core, output validation,
approval-tier resolution, and a persisted `skill_runs` record with an audit event.

## Contract

|                   |                                                                                          |
|-------------------|------------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis                                                        |
| **Risk**          | low                                                                                      |
| **Executives**    | Investor Relations, Capital Formation                                                    |
| **Inputs**        | `investor` (known facts) + optional `fundCriteria` (targeting)                           |
| **Outputs**       | `profile`, `fitSignals`, `fitScore`, `missingFields`, `suggestedNextStep`, `missingContext` |
| **Artifacts**     | `analysis`                                                                               |
| **Downstream**    | `raise-pipeline`, `commitment-tracker`                                                   |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Guardrail (the reason this is a skill, not a prompt)

- **Organizes supplied facts — never fabricates investor data.** The skill profiles
  only what the caller provides. It does **not** invent, research, or hallucinate an
  investor's AUM, wealth, mandate, PEP status, or preferences. Absent fields are
  surfaced in `missingFields` and `missingContext`, never filled in.
- **Separates epistemics.** Every supplied investor field is a `fact` source; the
  computed `fitScore` and the derived `ticketBand` are `calculation`s. Nothing is
  invented.
- **Advisory only.** Reaching out to an LP is a separate Tier-2 action, prohibited
  here — `suggestedNextStep` prompts to complete the profile or route it to Capital
  Formation for targeting; it never executes outreach.

## How fit is scored

`fitScore` (0–100) is the average of the **known** dimension fits — ticket
(`typicalTicket` vs `minTicket`), sector overlap (`sectorsOfInterest` ∩
`targetSectors`), and geography overlap. A dimension the fund criteria is silent on,
or the investor omits, is `unknown` and excluded from the average rather than
penalised. `ticketBand` (`<1M` / `1-5M` / `5-25M` / `25M+`, USD millions) is derived
**only** from a supplied `typicalTicket`; absent → `null` and flagged.
