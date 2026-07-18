# Quarterly LP Update (`lp-update`)

Assemble a quarterly **LP update letter** from already-structured fund data. The
skill orders five standard sections, builds each `body` from the provided input,
states only the performance metrics that were actually supplied, and marks a
section as an **open item** wherever the source data is absent. It returns the
stated metrics, a completeness score, the collected open items, the missing
fields, and a recommended next action.

This is a **native FundExecs skill**: a versioned, schema-defined,
policy-governed reusable workflow. It runs through the skill runtime
(`lib/skills/runner.ts`), which validates the input, checks that the assigned
executive is permitted to run it, executes the deterministic core, validates the
output, resolves the approval tier, and persists a `skill_runs` record with an
audit event.

## Contract

|                   |                                                                                                          |
|-------------------|----------------------------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible DRAFT assembly                                                                  |
| **Risk**          | low                                                                                                      |
| **Executives**    | Investor Relations                                                                                       |
| **Inputs**        | `fundName` (required) + optional `period`, `nav`, `dpi`, `tvpi`, `netIrrPct`, `highlights`, `portfolioNotes`, `capitalActivity` |
| **Outputs**       | `sections`, `statedMetrics`, `openItems`, `missingFields`, `completeness`, `recommendedAction`           |
| **Artifacts**     | `lp_update`                                                                                              |
| **Downstream**    | none — this is a leaf assembly step                                                                       |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## The core guardrail: it PREPARES a DRAFT, it never DISTRIBUTES

`lp-update` assembles a **draft** letter for internal review. It does **not**
send the letter to LPs — external distribution is a **Tier-2, human-gated**
action (`distribute_report`), prohibited here — and it never manufactures a
performance figure to fill a section:

- **A missing performance metric becomes an open item — never a fabricated
  figure.** If no metrics are provided, the Performance section reads *"Pending —
  confirm from fund admin"* and the shortfall is added to `openItems`. Only the
  metrics actually supplied (NAV / DPI / TVPI / Net IRR) are stated, and their
  names are returned in `statedMetrics`.
- **Epistemics stay separated.** Provided figures (`nav`, `dpi`, `tvpi`,
  `netIrrPct`), highlights, notes, and capital activity are `fact` sources; the
  neutral Outlook placeholder is `generated`. These are returned in `sources` and
  never collapsed.
- **Deterministic + testable.** Every section, the stated metrics, and the
  completeness score come from the pure core in
  `lib/skills/catalog/lp-update.ts`, tested independently of any model.

## Sections (fixed order)

1. **Summary** — fund + period; complete when the fund name is present.
2. **Performance** — lists only the provided NAV / DPI / TVPI / Net IRR as stated
   figures; open (*"Pending — confirm from fund admin"*) when none are provided.
3. **Portfolio Highlights** — from `highlights` / `portfolioNotes`, else open.
4. **Capital Activity** — from `capitalActivity`, else open.
5. **Outlook** — a neutral, generated placeholder with no forward-looking
   performance commitments.

`completeness` is the fraction of the five sections that are `complete`;
`missingFields` lists the labelled inputs that were not provided.

## Example

See [`examples/example-1.json`](./examples/example-1.json) — a fully-populated
quarterly update draft with all four performance metrics stated, every section
complete.
