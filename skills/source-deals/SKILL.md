# Deal Sourcing — Rank Candidates (`source-deals`)

Rank a **caller-supplied** set of candidate companies against a fund's mandate and
return them scored by fit, with match reasons and exclusion flags.

This is a **native FundExecs skill**: a versioned, schema-defined, policy-governed
reusable workflow that runs through the skill runtime (`lib/skills/runner.ts`) —
input validation, executive permission, deterministic core, output validation,
approval-tier resolution, and a persisted `skill_runs` record with an audit event.

## Contract

| | |
|---|---|
| **Approval tier** | 1 — internal, reversible analysis |
| **Risk** | low |
| **Executives** | Deal Sourcing |
| **Inputs** | `mandate` (criteria) + `candidates` (a supplied set to rank) |
| **Outputs** | `ranked`, `topTargets`, `excludedCount`, `candidateCount`, `missingContext`, `recommendedAction` |
| **Artifacts** | `analysis` |
| **Downstream** | `screen-deal` |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Guardrail (the reason this is a skill, not a prompt)

- **Ranks a provided set — never fabricates targets.** This skill scores the
  candidates the caller supplies against the mandate. It does **not** invent,
  research, or hallucinate companies. With no candidates it returns an empty
  `ranked` list and the note *"No candidates supplied — this skill ranks a
  provided candidate set; it does not fabricate targets."*
- **Separates epistemics.** Provided candidate fields are `fact` sources; each
  computed `fitScore` is a `calculation`. Nothing is invented.
- **Advisory only.** Outreach to a target is a separate Tier-2 action, prohibited
  here — the skill prepares a ranked list for review.

## How fit is scored

`fitScore` (0–100) is the average of the **known** dimension fits — sector,
geography, and size (revenue/EBITDA bands). A dimension the mandate is silent on,
or the candidate omits, is excluded from the average rather than penalised. A
candidate matching a mandate exclusion is flagged `excluded` and sorted last.
`topTargets` are the top non-excluded names by fit.
