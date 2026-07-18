# Diligence Request List (`dd-checklist`)

Assemble a workstream-organized **diligence request list** for a deal — the
concrete items a fund asks a target to provide — across 16 diligence workstreams,
with per-workstream priority, simple rule-based tailoring off the deal's sector
and transaction type, and an explicit note of the context that is missing.

This is a **native FundExecs skill**: a versioned, schema-defined, policy-governed
reusable workflow. It runs through the skill runtime (`lib/skills/runner.ts`),
which validates the input, checks that the assigned executive is permitted to run
it, executes the deterministic core, validates the output, resolves the approval
tier, and persists a `skill_runs` record with an audit event.

## Contract

|                   |                                                                                      |
|-------------------|--------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal; PREPARES the request list, never sends it                              |
| **Risk**          | low                                                                                  |
| **Executives**    | Diligence                                                                            |
| **Inputs**        | `deal` (at minimum `companyName`) + optional `workstreams` filter                    |
| **Outputs**       | `workstreams`, `totalRequests`, `tailoredFor`, `missingContext`, `recommendedAction` |
| **Artifacts**     | `analysis`                                                                           |
| **Downstream**    | `dd-prep`, `ic-memo`                                                                 |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Workstreams

Financial · Commercial · Legal · Tax · Operational · Technology · Cybersecurity ·
Human Capital · Environmental · Insurance · Regulatory · Customer · Vendor ·
Ownership & Structure · Debt & Financing · Intellectual Property.

Each carries a base list of 3–6 concrete PE-diligence requests. **Financial,
Commercial, Legal, and Tax** are `high` priority by default; the rest are
`medium` (and are elevated to `high` when tailoring adds items to them).

## Guardrails (the reason this is a skill, not a prompt)

- **Prepares, never sends.** This skill assembles the list. Issuing it to a
  counterparty is a separate Tier-2 action (`send_diligence_request`), which is
  prohibited here.
- **Template, not facts.** The base catalog is a standard PE request template, so
  every item is labelled a `generated` source — a starting request list to
  *confirm*, not a claim about the company.
- **Additive tailoring only.** Rules only ever add items:
  - sector matches `software|saas|tech` → adds code-ownership and SOC 2 / security
    items to Technology and Cybersecurity (both elevated to `high`);
  - transaction type matches `carve-out` → adds TSA scope and standalone cost
    analysis to Operational (elevated to `high`);
  - regulated sector matches `health|financ|bank|insur` → adds regulatory approval
    and licensing items to Regulatory (elevated to `high`).
- **Flags missing context.** Absent sector / transaction type / deal size are
  surfaced in `missingContext`, never invented.
- **Deterministic + testable.** The full checklist comes from the pure core in
  `lib/skills/catalog/dd-checklist.ts`, tested independently of any model.

## Filtering

Pass `workstreams` (an array of keys, e.g. `["financial", "legal", "tax"]`) to
restrict the output to those workstreams. Canonical ordering is preserved and
unknown keys are ignored.

## Example

See [`examples/example-1.json`](./examples/example-1.json) — a software carve-out
that returns all 16 workstreams with the software/security and TSA/standalone
tailoring applied.
