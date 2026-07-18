# Diligence Prep Workplan (`dd-prep`)

Prepare a **sequenced diligence workplan** for a deal — the prioritized, phased
*agenda* a deal team works through. It organizes the eight standard DD
workstreams into items with owners, status, and priority, merges the caller's
**supplied** known items and focus areas, assigns a coarse phase when a timeline
is given, and flags coverage gaps.

This is a **native FundExecs skill**: a versioned, schema-defined, policy-governed
reusable workflow. It runs through the skill runtime (`lib/skills/runner.ts`),
which validates the input, checks that the assigned executive is permitted to run
it, executes the deterministic core, validates the output, resolves the approval
tier, and persists a `skill_runs` record with an audit event.

## Distinct from `dd-checklist`

`dd-checklist` assembles the **request list** — the documents and items to ask a
target to provide. `dd-prep` sequences the **workplan** — who owns what, in what
order, at what status, in which phase. One is the ask; this is the agenda.

## Contract

|                   |                                                                                                         |
|-------------------|---------------------------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal; PREPARES the plan, never performs diligence or sends a request                            |
| **Risk**          | low                                                                                                     |
| **Executives**    | Diligence                                                                                               |
| **Inputs**        | `deal` (at minimum `name`) + optional `focusAreas`, `knownItems`, `timelineWeeks`                       |
| **Outputs**       | `workstreams`, `totalItems`, `highPriorityCount`, `coverageGaps`, `recommendedAction`, `missingContext` |
| **Artifacts**     | `analysis`                                                                                              |
| **Downstream**    | `dd-checklist`, `ic-memo`                                                                               |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Workstreams

Commercial · Financial · Legal · Tax · Technology · HR & Org · Operations · ESG.

Each carries a few canonical items. **Financial, Legal, Commercial, and Tax**
start at `medium` priority; the rest start `standard`. A workstream is bumped to
`high` when it is named in `focusAreas` or carries a supplied known gap.

## Guardrails (the reason this is a skill, not a prompt)

- **Prepares, never performs or sends.** This skill sequences the plan. It never
  performs diligence, draws conclusions, or issues a request — sending is a
  separate Tier-2 action (`send_diligence_request`), prohibited here.
- **Facts vs. assumptions.** A supplied known item's `status` and `owner` are
  `fact` sources. Template items default to status `not_started`, which is
  labelled an `assumption` (a plan default), never a fact about work done.
- **Merge, never drop.** Supplied `knownItems` are merged into the plan and
  deduped by workstream + item (case-insensitive). An item whose workstream is
  outside the standard eight is attached to a new workstream, never discarded.
- **No fabricated dates.** With a `timelineWeeks`, items are given a coarse phase
  (high → 1, medium → 2, standard → 3). Without one, `phase` is left `null` and
  the absence is flagged — no due dates are invented.
- **Flags gaps and missing context.** Workstreams with no started work, and focus
  areas that map to no workstream, are surfaced in `coverageGaps`; absent
  planning context is surfaced in `missingContext`, never invented.
- **Deterministic + testable.** The full workplan comes from the pure core in
  `lib/skills/catalog/dd-prep.ts`, tested independently of any model.

## Example

See [`examples/example-1.json`](./examples/example-1.json) — an 8-week software
buyout with Technology prioritized and two known items (a completed QoE and an
in-progress cyber review) merged and phased.
