# Market Map (`market-map`)

Segment a **caller-supplied set of companies** into a structured market map —
companies grouped by segment, each segment counted, segments ordered by size, with
companies lacking a segment surfaced and the missing context flagged.

This is a **native FundExecs skill**: a versioned, schema-defined, policy-governed
reusable workflow. It runs through the skill runtime (`lib/skills/runner.ts`),
which validates the input, checks that the assigned executive is permitted to run
it, executes the deterministic core, validates the output, resolves the approval
tier, and persists a `skill_runs` record with an audit event.

## Contract

|                   |                                                                                          |
|-------------------|------------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis                                                        |
| **Risk**          | low                                                                                      |
| **Executives**    | Research                                                                                 |
| **Inputs**        | `sector` (required) + optional `geography` + optional `companies` set                    |
| **Outputs**       | `segments`, `totalCompanies`, `segmentCount`, `unsegmented`, `missingContext`, `recommendedAction` |
| **Artifacts**     | `analysis`                                                                               |
| **Downstream**    | `source-deals`                                                                           |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Guardrails (the reason this is a skill, not a prompt)

- **Maps a provided set — never researches or invents companies.** This skill
  organizes the company set the caller supplies. It does **not** go looking for
  companies, enrich them, or manufacture market claims. The companies are inputs,
  not researched facts.
- **Empty in, empty out.** An empty (or omitted) `companies` set yields an empty
  `segments` list and the explicit note: *"No companies supplied — this skill maps
  a provided company set; it does not research or fabricate companies."* It never
  fills the map with invented companies.
- **Separates epistemics.** Every provided company name is a `fact` (the caller
  asserted it); the grouping is a `calculation`; any narrative is `generated`.
  These are returned in `sources` and never collapsed.
- **Flags, never invents.** A company with no `segment` is grouped under
  `Unsegmented` and surfaced in `unsegmented` + `missingContext` — never assigned
  a fabricated segment. A missing `geography` is flagged, not filled in.
- **Deterministic + testable.** The segmentation comes from the pure core in
  `lib/skills/catalog/market-map.ts`, tested independently of any model.

## How the map is built

1. Each company is grouped by its provided `segment` (companies with no segment go
   to `Unsegmented`).
2. Each segment reports its member company **names** and a `count`.
3. Segments are sorted by `count` descending (ties keep first-seen order).
4. `totalCompanies` = number supplied; `segmentCount` = number of distinct
   segments; `unsegmented` lists the companies that arrived without a segment.

## Example

See [`examples/example-1.json`](./examples/example-1.json) — a supplied payments
company set grouped into `Acquiring` / `Issuing` segments, sorted by count, with
one unsegmented company flagged.
