# CIM Outline — Draft (`cim`)

Assemble a **Confidential Information Memorandum (CIM) DRAFT OUTLINE** from
caller-**supplied** deal facts: an executive summary, company overview, market
overview, products & services, financial summary, management, and transaction
overview — fuller than a teaser, scored for completeness, with every blank section
flagged.

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
| **Downstream**    | none — distributing/sending/sharing the CIM is Tier-2 and prohibited here    |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Guardrail (the reason this is a skill, not a prompt)

- **Drafts for review — never publishes, distributes, or shares.** Distributing,
  sharing, or sending a CIM are Tier-2 actions, explicitly prohibited here. This
  skill assembles a draft and hands it to a human.
- **Never invents financials.** Every figure comes from the supplied facts — the
  reported revenue / EBITDA / growth rate and any `historicalFinancials` rows. When
  no financials are supplied, `financialSummary` becomes a flagged placeholder
  *"[Financial summary to be provided]"* — a number is **never** fabricated. Every
  section with no supplied content is recorded in `missingFields`.
- **Separates epistemics.** Each supplied figure is a `fact` source; connective and
  framing prose (the executive-summary framing) and the standard confidentiality /
  disclaimer language are `generated`.
- **Anonymized by default.** The deal is named by its codename only and management
  names are withheld (roles kept); no real company name is emitted.
- **Carries a fixed disclaimer** that the CIM is a confidential draft, not an offer,
  and that figures are as-supplied and unverified.

## Sections

`executiveSummary` (synthesized one-liner from codename + sector + description +
ask), `companyOverview` (from the description), `marketOverview` (from market
notes), `productsServices` (supplied product bullets), `financialSummary` (only
supplied revenue / EBITDA / growth and historical rows), `management` (roles kept;
names withheld when anonymized), and `transactionOverview` (from the transaction
ask). Each is `{ key, title, body, status }` where `status` is `complete` or
`placeholder`. `recommendedAction` reports the placeholder count and routes the
draft to a human for review before any distribution.
