# Model Audit (`model-audit`)

Audit a **caller-supplied** financial model for internal consistency and red flags.
The skill runs a rules grid over the line items, cross-checks, and ratios it is
given and returns **findings** — flagged anomalies with a severity — plus pass/fail
counts and a recommended next action.

This is a **native FundExecs skill**: a versioned, schema-defined, policy-governed
reusable workflow that runs through the skill runtime (`lib/skills/runner.ts`) —
input validation, executive permission, deterministic core, output validation,
approval-tier resolution, and a persisted `skill_runs` record with an audit event.

## Contract

|                   |                                                                                                              |
|-------------------|--------------------------------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis                                                                            |
| **Risk**          | low                                                                                                          |
| **Executives**    | Analyst                                                                                                      |
| **Inputs**        | `lineItems`, `checks`, `ratios` (all optional — a provided model to audit)                                   |
| **Outputs**       | `findings`, `checkedCount`, `passedCount`, `failedCount`, `errorCount`, `warningCount`, `summary`, `recommendedAction` |
| **Artifacts**     | `analysis`                                                                                                   |
| **Downstream**    | —                                                                                                            |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Guardrail (the reason this is a skill, not a prompt)

- **Reviews a provided model — never fabricates figures.** This skill audits the
  figures the caller supplies. It does **not** invent, research, or hallucinate a
  model. With nothing supplied it returns empty `findings` and the note *"No model
  supplied — this skill audits a provided model; it does not fabricate figures."*
- **Flags, never fixes.** It reviews supplied numbers and **never** re-computes a
  corrected model or invents a "right" number — it flags each anomaly for the
  analyst to resolve. No finding carries a corrected value.
- **Separates epistemics.** Every supplied value is a `fact` source; each pass/fail
  verdict is a `calculation` (the audit verdict, not a new model value).
- **Advisory only.** Distributing the audit is a separate Tier-2 action, prohibited
  here — the skill prepares findings for review.

## The rules grid

- **Line items** — a `value` outside a supplied `[min, max]` band is flagged
  (warning); a value negative where its `kind` should never be (e.g. `revenue`,
  `cost`, `cash`) is an error.
- **Checks** — an equality that should hold (e.g. a subtotal that equals a sum):
  `|lhs − rhs|` beyond `tolerance` (default 0) is flagged as an error.
- **Ratios** — sanity bounds by `kind`: a `margin`/`rate` outside 0–100% is an
  error; `growth` beyond ±300% is a warning; a negative `multiple` is an error.

`recommendedAction` escalates when there are error-level findings: *"N error-level
issue(s) must be resolved before the model is relied upon."*
