# KYC / AML Screening (`kyc-screen`)

Screen a prospective subject (individual or entity) against a deterministic
KYC/AML **rules grid** — document completeness and expiry, screening-check
results, PEP and sanctions flags — and return a structured, provenanced
screening posture: **clear_for_review / incomplete / escalate**. It surfaces the
gaps and **routes exceptions to a compliance officer**.

This is a **native FundExecs skill**: a versioned, schema-defined,
policy-governed reusable workflow. It runs through the skill runtime
(`lib/skills/runner.ts`), which validates the input, checks that the assigned
executive is permitted to run it, executes the deterministic core, validates the
output, resolves the approval tier, and persists a `skill_runs` record with an
audit event.

## The core guardrail: it SCREENS and ROUTES — it never APPROVES

**This skill NEVER approves onboarding and NEVER makes a final compliance
determination.** Its `screeningStatus` is only ever `clear_for_review`,
`incomplete`, or `escalate` — it is **never** `"approved"` (or `"clear"`). It
evaluates the rules grid, flags what is missing, and routes any exception to a
compliance officer, who owns the final call. Every `recommendedAction` ends by
stating that **a compliance officer makes the final onboarding determination**.

## Contract

|                   |                                                                                                                       |
|-------------------|-----------------------------------------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible screening support                                                                            |
| **Risk**          | elevated                                                                                                              |
| **Executives**    | Risk & Compliance                                                                                                     |
| **Inputs**        | `subjectName` (required) + optional `subjectType`, `documents`, `checks`, `pepFlag`, `sanctionsHit`                   |
| **Outputs**       | `screeningStatus`, `documentCompleteness`, `missingDocuments`, `expiringDocuments`, `failedChecks`, `escalationReasons`, `missingFields`, `recommendedAction` |
| **Artifacts**     | `risk_report`                                                                                                         |
| **Downstream**    | `policy-check`                                                                                                        |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Guardrails (the reason this is a skill, not a prompt)

- **Never approves, never determines.** `screeningStatus` is never `"approved"`.
  A compliance officer makes the final onboarding determination; this skill only
  prepares and routes the file.
- **Exceptions always escalate.** A sanctions hit, a PEP flag, or any failed
  check produces an `escalate` status and a routed `escalationReasons` entry.
- **Never fabricates.** A missing document or check is *flagged* in
  `missingDocuments` / `missingFields`, never invented. Every provided value is a
  `fact`; every computed figure (e.g. document completeness) is a `calculation`;
  the escalation routing basis is `generated`. These are returned in `sources`
  and never collapsed.
- **Deterministic + testable.** The status and every figure come from the pure
  core in `lib/skills/catalog/kyc-screen.ts`, tested independently of any model.
  The expiry window is evaluated against `ctx.now` so it is fully deterministic.

## How the status is decided

1. **Escalation** is a hard gate → any sanctions hit, PEP flag, or failed check
   ⇒ `escalate`, with the reason routed to a compliance officer.
2. **Completeness** → otherwise, any missing document, any pending check, or
   absent documentation ⇒ `incomplete` (gather the outstanding items, re-screen).
3. Otherwise ⇒ `clear_for_review` — the file is prepared for the compliance
   officer's review. This is **not** an approval.

## Example

See [`examples/example-1.json`](./examples/example-1.json) — a subject with a
sanctions hit that screens **ESCALATE** and is routed to a compliance officer.
