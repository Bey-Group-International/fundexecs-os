# Buyer List — Rank Acquirers (`buyer-list`)

Rank a **caller-supplied** set of candidate buyers / acquirers for a sale process
and return a structured, provenanced ranking — each buyer scored 0–100 for fit,
counts by buyer type, the top names, the context that is missing, and the
recommended next action.

This is a **native FundExecs skill**: a versioned, schema-defined, policy-governed
reusable workflow. It runs through the skill runtime (`lib/skills/runner.ts`),
which validates the input, checks that the assigned executive is permitted to run
it, executes the deterministic core, validates the output, resolves the approval
tier, and persists a `skill_runs` record with an audit event.

## Contract

|                   |                                                                                      |
|-------------------|--------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible analysis                                                    |
| **Risk**          | low                                                                                  |
| **Executives**    | Deal Sourcer                                                                         |
| **Inputs**        | `company` (at minimum `name`) + optional `buyers[]` (the set to rank)                |
| **Outputs**       | `ranked`, `byType`, `topBuyers`, `buyerCount`, `missingContext`, `recommendedAction` |
| **Artifacts**     | `analysis`                                                                           |
| **Downstream**    | none                                                                                 |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Guardrails (the reason this is a skill, not a prompt)

- **Ranks a provided set — never invents buyers.** This skill scores the buyers
  the caller supplies. If `buyers` is empty or omitted, it returns an **empty
  `ranked` list** and a `missingContext` note:
  *"No buyers supplied — this skill ranks a provided buyer set; it does not
  fabricate buyers."* It does not source, hallucinate, or top up the set.
- **Separates epistemics.** Every provided field is a `fact`; every `fitScore` is
  a `calculation`. These are returned in `sources` and never collapsed.
- **Advisory only.** The ranking informs prioritisation; it can never send
  outreach, share materials, or sign anything — those actions are prohibited on
  the manifest and enforced by the runtime.
- **Deterministic + testable.** The ranking and every score come from the pure
  core in `lib/skills/catalog/buyer-list.ts`, tested independently of any model.

## How fitScore is decided

`fitScore` (0–100) is the **average of the known signals** for a buyer — a signal
is only counted when the data to assess it exists:

1. **Sector overlap** with `company.sector` → match `100` / mismatch `0`
   (excluded when either side omits sector).
2. **Geography overlap** with `company.geography` → match `100` / mismatch `0`
   (excluded when either side omits geography).
3. **Type bonus** → a `strategic` buyer in the same sector, or a
   `financial` / `sponsor` buyer with disclosed `aum`, contributes a positive
   signal. Otherwise the type signal is excluded rather than penalised.

A buyer with no assessable signals scores `0` and is flagged in `missingContext`
rather than being assigned an invented score. Buyers are ranked by `fitScore`
descending (input order breaks ties); `topBuyers` is the top 5 names; `byType`
counts `strategic` / `financial` / `sponsor` / `unknown`.

## Example

See [`examples/example-1.json`](./examples/example-1.json) — a three-buyer
industrials set where a same-sector strategic ranks top at **fitScore 100**.
