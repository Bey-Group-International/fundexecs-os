# Sector Research Brief (`sector-research`)

Organize a **caller-supplied body of research points** into a structured sector
brief — findings grouped by category (drivers, risks, trends, key players,
sizing), each finding graded for source quality, and every claim that arrives
**without a source flagged as unsupported**.

This is a **native FundExecs skill**: a versioned, schema-defined, policy-governed
reusable workflow. It runs through the skill runtime (`lib/skills/runner.ts`),
which validates the input, checks that the assigned executive is permitted to run
it, executes the deterministic core, validates the output, resolves the approval
tier, and persists a `skill_runs` record with an audit event.

## Contract

|                   |                                                                                                                          |
|-------------------|--------------------------------------------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis                                                                                        |
| **Risk**          | low                                                                                                                      |
| **Executives**    | Research                                                                                                                 |
| **Inputs**        | `sector` (required) + optional `findings` set (`claim`, `category`, `source?`, `sourceType?`)                            |
| **Outputs**       | `sector`, `sections`, `sourcedCount`, `unsourcedCount`, `unsupportedClaims`, `sourceQuality`, `recommendedAction`, `missingContext` |
| **Artifacts**     | `analysis`                                                                                                               |
| **Downstream**    | `market-map`, `source-deals`                                                                                             |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Guardrails (the reason this is a skill, not a prompt)

- **Organizes provided research — never invents facts, figures, or market data.**
  This skill structures and source-checks the findings the caller supplies. It
  does **not** research the sector, size the market, or manufacture claims. The
  findings are inputs, not researched facts.
- **Every material claim must carry a source.** The Research review standard is
  load-bearing: a supplied claim **with** a source is a `fact` (it carries its
  source ref); a claim **without** a source is still surfaced but marked
  unsupported and emitted as a `generated` (flagged) item — **never** as a fact.
  No source is ever invented.
- **Empty in, empty out.** An empty (or omitted) `findings` set yields an empty
  brief and the explicit note: *"No findings supplied — this skill organizes
  provided research; it does not fabricate market data."*
- **Grades source quality, never inflates it.** Each finding is graded from its
  supplied `sourceType` — `primary` → A, `expert` → B, `secondary`/`news` → C,
  `unknown`/absent → D. A claim with no source is grade D and flagged.
- **Deterministic + testable.** The brief comes from the pure core in
  `lib/skills/catalog/sector-research.ts`, tested independently of any model.

## How the brief is built

1. Each finding is grouped by its `category` into a section (drivers, risks,
   trends, key players, sizing).
2. Each finding is graded for source quality from its `sourceType`; a finding
   with no `source` is graded D and added to `unsupportedClaims`.
3. `sourcedCount` / `unsourcedCount` tally coverage; `sourceQuality` reports the
   grade distribution plus a coarse majority grade.
4. `recommendedAction` calls out unsupported claims to be sourced before the brief
   is relied upon.

## Example

See [`examples/example-1.json`](./examples/example-1.json) — a supplied payments
research set grouped into driver / risk / sizing sections, one unsourced sizing
claim flagged as unsupported.
