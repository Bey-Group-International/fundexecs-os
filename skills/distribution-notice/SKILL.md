# Distribution Notice (`distribution-notice`)

Prepare a **draft** distribution notice for an investor from already-structured
distribution data. The skill assembles an ordered, provenanced set of sections —
**Header, Amount, Type, Record Date, Payment Date, Source of Proceeds** — into a
`noticeDraft`, flags every required input that is missing, and lists the open
items that a human must resolve before anything is released or sent.

This is a **native FundExecs skill**: a versioned, schema-defined, policy-governed
reusable workflow. It runs through the skill runtime (`lib/skills/runner.ts`),
which validates the input, checks that the assigned executive is permitted to run
it, executes the deterministic core, validates the output, resolves the approval
tier, and persists a `skill_runs` record with an audit event.

## Contract

|                   |                                                                                                    |
|-------------------|----------------------------------------------------------------------------------------------------|
| **Stage**         | PREPARATION — assembles a **draft** only                                                           |
| **Approval tier** | 1 — internal, reversible preparation                                                               |
| **Risk**          | moderate                                                                                            |
| **Executives**    | Investor Relations                                                                                 |
| **Inputs**        | `fundName` (required) + optional investor / distribution details                                   |
| **Outputs**       | `noticeDraft`, `sections`, `missingFields`, `openItems`, `recommendedAction`                        |
| **Artifacts**     | `memo`                                                                                              |
| **Downstream**    | none — any send or payment is a separate human step                                                |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Guardrails (the reason this is a skill, not a prompt)

- **Prepares, never executes.** This skill produces a DRAFT for operator review.
  It **NEVER moves capital** and **NEVER sends** the notice. Releasing funds is a
  **Tier-3 human decision**; transmitting the notice is a **Tier-2 human
  decision**. The runtime enforces the tier and the executive's approval ceiling,
  and the manifest forbids `move_capital`, `distribute_report`, `send_reply`, and
  `sign_document` — even to prepare.
- **Amounts, dates, and bank details are never fabricated.** A missing amount or
  date is *flagged* (in `missingFields`) or surfaced as an *open item*, never
  invented. No amount or date is asserted in the draft without a source.
- **Requires the essentials.** `fundName` **and** `distributionAmount` are
  required; either missing is flagged in `missingFields` and the run is not a
  releasable notice.
- **Separates epistemics.** Every provided figure is a `fact`; the assembled draft
  is `generated`. These are returned in `sources` and never collapsed.
- **Deterministic + testable.** Every section and status comes from the pure core
  in `lib/skills/catalog/distribution-notice.ts`, tested independently of any
  model.

## How the draft is assembled

1. **Required inputs** are checked first: `fundName` and `distributionAmount`.
   Either missing ⇒ flagged in `missingFields`; the draft is explicitly not
   releasable.
2. **Sections** are built in fixed order — Header, Amount, Type, Record Date,
   Payment Date, Source of Proceeds. Each carries a `status` of `complete` (data
   supplied) or `open` (data missing — a stated open item, never a guess). An
   unspecified type reads *"Pending — confirm classification"*.
3. **`noticeDraft`** is assembled from the **complete** sections only. `openItems`
   is the list of section headings still open. `recommendedAction` always stresses
   this is a DRAFT for operator review and that release/send is a human decision.

## Example

See [`examples/example-1.json`](./examples/example-1.json) — a fully-specified
distribution that assembles a DRAFT with all six sections complete and no open
items, still for operator review only (never moved, never sent).
