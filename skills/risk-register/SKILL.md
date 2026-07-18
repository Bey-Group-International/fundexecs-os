# Risk Register (`risk-register`)

Assemble and **score** a risk register from a **supplied** set of risks. For each
risk the skill computes a score (`likelihood × impact`), assigns a severity —
**high / medium / low / unscored** — ranks the register, rolls up severity and
unmitigated counts, and flags every gap (missing likelihood/impact, mitigation,
or owner). It returns the register, the counts, the missing data, and a
recommended next action.

This is a **native FundExecs skill**: a versioned, schema-defined, policy-governed
reusable workflow. It runs through the skill runtime (`lib/skills/runner.ts`),
which validates the input, checks that the assigned executive is permitted to run
it, executes the deterministic core, validates the output, resolves the approval
tier, and persists a `skill_runs` record with an audit event.

## Contract

|                   |                                                                                                        |
|-------------------|--------------------------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis                                                                      |
| **Risk**          | moderate                                                                                               |
| **Executives**    | Risk & Compliance                                                                                     |
| **Inputs**        | `entityName` (required) + `risks` (a supplied set; each with name and optional likelihood/impact/etc.) |
| **Outputs**       | `register`, `highCount`, `mediumCount`, `lowCount`, `unmitigatedCount`, `riskCount`, `missingFields`, `recommendedAction` |
| **Artifacts**     | `risk_report`                                                                                          |
| **Downstream**    | —                                                                                                     |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Guardrails (the reason this is a skill, not a prompt)

- **Never fabricates a risk.** The register scores only the risks it is *given*.
  An empty `risks` set yields an **empty register** plus an explicit note —
  `No risks supplied — this skill scores a provided risk set; it does not
  fabricate risks.` — never an invented risk.
- **Separates epistemics.** Every provided field is a `fact`; every score is a
  `calculation` (`likelihood × impact`). These are returned in `sources` and
  never collapsed.
- **Flags gaps, never fills them.** A missing likelihood/impact leaves the risk
  `unscored`; a missing mitigation or owner is recorded in the risk's `gaps` —
  none is invented.
- **Deterministic + testable.** The scores, severities, and ranking come from the
  pure core in `lib/skills/catalog/risk-register.ts`, tested independently of any
  model.

## How severity is decided

For each risk with both likelihood and impact (each 1–5):

1. `score = likelihood × impact` (1–25).
2. `score ≥ 15` ⇒ **high**; `score ≥ 8` ⇒ **medium**; otherwise ⇒ **low**.
3. A risk missing likelihood or impact is **unscored** and sorts last.

The register is ranked by score descending, unscored risks last.

## Example

See [`examples/example-1.json`](./examples/example-1.json) — three supplied
risks that score to one **high**, one **medium**, and one **low**.
