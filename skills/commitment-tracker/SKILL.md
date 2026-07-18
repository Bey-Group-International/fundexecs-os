# Commitment Tracker (`commitment-tracker`)

Track a **caller-supplied** set of LP commitments/allocations against a fund's target
close and return a roll-up: total committed, remaining-to-target, per-investor
allocation %, binding vs. soft, and over/under-subscription against a hard cap.

This is a **native FundExecs skill**: a versioned, schema-defined, policy-governed
reusable workflow that runs through the skill runtime (`lib/skills/runner.ts`) —
input validation, executive permission, deterministic core, output validation,
approval-tier resolution, and a persisted `skill_runs` record with an audit event.

## Contract

|                   |                                                                                                                            |
|-------------------|----------------------------------------------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis                                                                                          |
| **Risk**          | low                                                                                                                        |
| **Executives**    | Capital Formation                                                                                                          |
| **Inputs**        | `targetClose?`, `hardCap?`, `commitments?` (a supplied set to track)                                                        |
| **Outputs**       | `byInvestor`, `totalCommitted`, `bindingCommitted`, `totalInvestors`, `remainingToTarget`, `pctOfTarget`, `targetClose`, `overSubscribed`, `recommendedAction`, `missingContext` |
| **Artifacts**     | `analysis`                                                                                                                  |
| **Downstream**    | — (none; a capital call or funding is a human Tier-3 action, never seeded here)                                             |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Guardrail (the reason this is a skill, not a prompt)

- **This skill NEVER binds, calls, or moves capital.** It tracks supplied records
  only. Issuing a capital call, moving capital, signing a subscription document, or
  executing a subdoc are **prohibited** Tier-3 actions reserved for a human — the
  skill produces a read-only roll-up for review.
- **Tracks a provided set — never fabricates commitments.** It rolls up the
  commitments the caller supplies. With none it returns an empty roll-up and the note
  *"No commitments supplied — this skill tracks a provided commitment set; it does not
  fabricate commitments."*
- **A missing amount is flagged, never assumed.** A commitment with no `amount` is
  counted (the investor is real) but excluded from every sum and surfaced in
  `missingContext` — it is never silently treated as zero.
- **Separates epistemics.** Supplied `amount`/`status` values are `fact` sources;
  every `totalCommitted`, `pctOfTotal`, `remainingToTarget`, and `pctOfTarget` is a
  labelled `calculation`. Nothing is invented.

## What it computes

- **`totalCommitted`** = Σ supplied amounts across all statuses. **`bindingCommitted`**
  = Σ amounts where status is `signed` or `funded`.
- **`byInvestor`** — each investor's `amount` (null when not supplied), `pctOfTotal`
  (share of the known committed total), and `status`, sorted by amount descending.
- **`remainingToTarget`** = `max(0, targetClose − totalCommitted)` and **`pctOfTarget`**
  = `totalCommitted / targetClose` when a `targetClose` is supplied; otherwise both are
  `null` and the gap is flagged.
- **`overSubscribed`** = true when a `hardCap` is supplied and `totalCommitted` exceeds
  it; over-subscription is flagged prominently, and scale-back is left as a human
  decision.
