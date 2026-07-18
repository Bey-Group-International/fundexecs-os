# IC Memorandum — Pre-Read (`ic-memo`)

Assemble an Investment Committee **pre-read** from already-structured deal data —
typically the output of the [`screen-deal`](../screen-deal/) and returns skills.
The skill orders twelve standard memo sections, builds each `body` from the
provided input, and marks a section as an **open item** wherever the source data
is absent. It returns a completeness score, the collected open items, and the
standard conditions precedent.

This is a **native FundExecs skill**: a versioned, schema-defined,
policy-governed reusable workflow. It runs through the skill runtime
(`lib/skills/runner.ts`), which validates the input, checks that the assigned
executive is permitted to run it, executes the deterministic core, validates the
output, resolves the approval tier, and persists a `skill_runs` record with an
audit event.

## Contract

|                   |                                                                                                                     |
|-------------------|---------------------------------------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible pre-read assembly                                                                          |
| **Risk**          | low                                                                                                                 |
| **Executives**    | Investment Committee                                                                                                |
| **Inputs**        | `deal` (at minimum `companyName`) + optional `thesis`, `screen`, `returns`, `market`, `mitigants`, `recommendation` |
| **Outputs**       | `sections`, `recommendation`, `openItems`, `conditionsPrecedent`, `missingSections`, `completeness`                 |
| **Artifacts**     | `ic_memo`                                                                                                           |
| **Downstream**    | none — this is a leaf assembly step                                                                                 |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## The core guardrail: it PREPARES, it never DECIDES

`ic-memo` assembles a memo for the committee to read. It does **not** make the
investment decision, and it never manufactures data to fill a section:

- **A missing input becomes an open item — never a fabricated fact.** If
  `returns` is absent, the Returns section reads *"Pending — run the returns
  skill"* and the shortfall is added to `openItems`. Market claims are never
  asserted without a source.
- **The recommendation is preliminary and advisory.** It uses an explicit
  `recommendation` when provided; otherwise it derives a *neutral* placeholder
  from the screen verdict (`pass` → "Advance to full IC review", `watch` →
  "Conditional — resolve open items first", `fail` → "Do not proceed") and labels
  it clearly as a preliminary recommendation for the IC's decision — **not** a
  decision. With neither a recommendation nor a verdict, it is itself an open item.
- **Epistemics stay separated.** Provided figures (`moic`, `irrPct`, screen
  `verdict`) are `fact` sources; the verdict → posture mapping is an
  `assumption`; the derived recommendation and the standard conditions precedent
  are `generated`. These are returned in `sources` and never collapsed.
- **Deterministic + testable.** Every section and the completeness score come
  from the pure core in `lib/skills/catalog/ic-memo.ts`, tested independently of
  any model.

## Sections (fixed order)

1. **Executive Summary** — company + screen verdict + returns headline, if present.
2. **Recommendation** — preliminary/advisory only.
3. **Transaction Overview** — from the deal fields.
4. **Investment Thesis** — from `thesis`, else open.
5. **Market** — from `market`, else open (no unsourced claims).
6. **Financials & Valuation** — from `returns.entryEv` / `exitEv`, else open.
7. **Returns** — from `returns.moic` / `irrPct`, else open.
8. **Key Risks** — from `screen.keyRisks`, else open.
9. **Mitigants** — from `mitigants`, else open (flagged when risks exist without them).
10. **Open Items** — the running summary of everything flagged above.
11. **Conditions Precedent** — a standard, generated list.
12. **Decision History** — placeholder; the IC records decisions, not this skill.

`completeness` is the fraction of the twelve sections that are `complete`;
`missingSections` lists the headings that remain `open`.

## Example

See [`examples/example-1.json`](./examples/example-1.json) — a fully-populated
pre-read assembled from screen-deal + returns output, every section complete.
