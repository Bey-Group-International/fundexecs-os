# Policy & Restricted-Action Check (`policy-check`)

Evaluate a **proposed action** against a **supplied policy set** and return a
structured, provenanced list of flags — **ok / review / restricted** per policy —
plus counts, an escalation signal, the context that was missing, and a
recommended next step.

This is a **native FundExecs skill**: a versioned, schema-defined, policy-governed
reusable workflow. It runs through the skill runtime (`lib/skills/runner.ts`),
which validates the input, checks that the assigned executive is permitted to run
it, executes the deterministic core, validates the output, resolves the approval
tier, and persists a `skill_runs` record with an audit event.

## Guardrail (read this first)

**This skill is SUPPORT only.** It flags *potential* restrictions and conflicts
for a human to review. It **never makes a final legal or compliance
determination**, and it **never authorizes the action**. Even an all-clear result
is not permission to proceed — `recommendedAction` *always* defers the final call
to a **compliance or legal officer**. A restriction it cannot evaluate because the
relevant context is missing is surfaced as `review`, never silently passed.

## Contract

|                   |                                                                                                        |
|-------------------|--------------------------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible SUPPORT check                                                                 |
| **Risk**          | elevated                                                                                               |
| **Executives**    | Risk & Compliance                                                                                      |
| **Inputs**        | `action` (required) + optional `context` + optional `policies`                                         |
| **Outputs**       | `flags`, `restrictedCount`, `reviewCount`, `requiresEscalation`, `missingContext`, `recommendedAction` |
| **Artifacts**     | `risk_report`, `analysis`                                                                              |
| **Downstream**    | none — a human owns the next step                                                                      |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Guardrails (the reason this is a skill, not a prompt)

- **Never a final determination, never an authorization.** The final legal /
  compliance call is a compliance or legal officer's — encoded in every
  `recommendedAction` branch, including the all-clear.
- **Never fabricates context.** A missing input is *flagged* in `missingContext`,
  never assumed. A policy that cannot be evaluated becomes `review`, not `ok`.
- **Separates epistemics.** Every supplied value is a `fact`; counts are a
  `calculation`; the escalation summary is `generated`. These are returned in
  `sources` and never collapsed.
- **Deterministic + testable.** Every flag and count comes from the pure core in
  `lib/skills/catalog/policy-check.ts`, tested independently of any model.

## How a flag is decided

For each supplied policy, against the supplied context:

1. **`restricted`** if the policy is marked `restricted: true`, **or** the
   `counterpartyDomain` is in `forbiddenDomains`, **or** `dollarAmount` exceeds
   `maxDollar`, **or** `jurisdiction` is not in the permitted `jurisdictions`.
2. **`review`** if the policy references a domain / dollar / jurisdiction rule but
   the matching context field is **missing** — it cannot be evaluated, so it needs
   a human.
3. **`ok`** otherwise.

`restrictedCount > 0` ⇒ `requiresEscalation`. With no policies supplied, `flags`
is empty and `missingContext` explains that the applicable policy set must be
provided.

## Example

See [`examples/example-1.json`](./examples/example-1.json) — a payment that is
over the spend cap **and** hits a blocked counterparty domain, both **FLAGGED**
for a compliance/legal officer to review. The check does not authorize the action.
