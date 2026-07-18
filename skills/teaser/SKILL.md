# Deal Teaser — Draft (`teaser`)

Assemble a one-page **anonymized deal teaser DRAFT** from caller-**supplied** facts:
a headline, business overview, financial highlights, investment highlights, and a
neutral process line — scored for completeness, with every blank flagged.

This is a **native FundExecs skill**: a versioned, schema-defined, policy-governed
reusable workflow that runs through the skill runtime (`lib/skills/runner.ts`) —
input validation, executive permission, deterministic core, output validation,
approval-tier resolution, and a persisted `skill_runs` record with an audit event.

## Contract

|                   |                                                                              |
|-------------------|------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal DRAFT (distribution is a separate, gated action)                |
| **Risk**          | low                                                                          |
| **Executives**    | Communications                                                               |
| **Inputs**        | `deal` (supplied facts) + `anonymize` (default true)                         |
| **Outputs**       | `sections`, `anonymized`, `missingFields`, `disclaimer`, `recommendedAction` |
| **Artifacts**     | `document`                                                                   |
| **Downstream**    | none — distributing/sending/sharing the teaser is Tier-2 and prohibited here |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Guardrail (the reason this is a skill, not a prompt)

- **Drafts for review — never publishes, sends, or shares.** Distributing,
  sharing, or sending a teaser are Tier-2 actions, explicitly prohibited here. This
  skill assembles a draft and hands it to a human.
- **Never invents financials.** Every figure comes from the supplied facts. When
  no revenue / EBITDA / growth figure is supplied, `financialHighlights` becomes a
  flagged placeholder *"[Financials to be provided]"* — a number is **never**
  fabricated. Missing sections are recorded in `missingFields`.
- **Separates epistemics.** Each supplied figure is a `fact` source; connective and
  framing prose (the headline framing and the standard process line) is `generated`.
- **Anonymized by default.** The deal is named by its codename only; no real
  company name is emitted.
- **Carries a fixed disclaimer** that the teaser is a draft, not an offer, and that
  figures are as-supplied and unverified.

## Sections

`headline` (codename + sector + a one-liner from the supplied description),
`businessOverview` (from the description), `financialHighlights` (only supplied
revenue / EBITDA / growth), `investmentHighlights` (supplied bullets), and
`process` (a fixed, neutral, generated line). Each is
`{ key, title, body, status }` where `status` is `complete` or `placeholder`.
`recommendedAction` reports the placeholder count and routes the draft to a human
for review before any distribution.
