# Capital Call Notice (`capital-call`)

**Prepare** a capital call notice **draft** for an investor. The skill computes
the amount called (from an explicit figure, or derived from commitment ×
percent), assembles a fixed set of notice sections, marks any section it cannot
populate as an **open item**, and returns the draft together with the collected
open items and flagged fields.

This is a **native FundExecs skill**: a versioned, schema-defined,
policy-governed reusable workflow. It runs through the skill runtime
(`lib/skills/runner.ts`), which validates the input, checks that the assigned
executive is permitted to run it, executes the deterministic core, validates the
output, resolves the approval tier, and persists a `skill_runs` record with an
audit event.

## Contract

|                   |                                                                                                                                     |
|-------------------|-------------------------------------------------------------------------------------------------------------------------------------|
| **Approval tier** | 1 — **preparing** the draft is internal, reversible work product                                                                    |
| **Risk**          | moderate                                                                                                                            |
| **Executives**    | Investor Relations                                                                                                                  |
| **Inputs**        | `fundName` (required) + optional `investorName`, `callNumber`, `callPercent`, `totalCommitment`, `callAmount`, `dueDate`, `purpose` |
| **Outputs**       | `callAmount`, `noticeDraft`, `sections`, `missingFields`, `openItems`, `recommendedAction`                                          |
| **Artifacts**     | `memo`                                                                                                                              |
| **Downstream**    | none — this is a leaf preparation step                                                                                              |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## The core guardrail: it PREPARES, it never MOVES or SENDS

`capital-call` assembles a notice **draft** for an operator to review. It does
**not** issue the call, move any capital, or send anything:

- **Issuing a capital call is a Tier-3 action — always the human operator's.**
  Moving capital and issuing the call are compliance-/capital-binding actions
  that a delegated executive can never take. They are listed in
  `prohibitedActions` (`capital_call`, `move_capital`) alongside sending
  (`send_reply`, `distribute_report`) and `sign_document`. This skill only
  produces a draft; `recommendedAction` states plainly that issuing the call
  requires explicit human authorization.
- **Wiring / bank details are NEVER auto-populated.** The **Wiring Instructions**
  section is *always* open, carrying a single fixed placeholder — *"Placeholder —
  wiring details must be supplied by fund admin; never auto-populated."* Bank and
  wiring details are never invented, and the placeholder is never woven into the
  assembled `noticeDraft` body.
- **A missing input becomes an open item — never a fabricated figure.** If the
  amount cannot be formed (no `callAmount`, and not both `totalCommitment` and
  `callPercent`), the Amount Due section is open, the shortfall is added to
  `missingFields`, and `callAmount` is `null`. Due date and purpose behave the
  same way.
- **Epistemics stay separated.** A provided `callAmount` is a `fact`; a derived
  amount is a `calculation` (`totalCommitment × callPercent ÷ 100`); the wiring
  placeholder is `generated`. These are returned in `sources` and never collapsed.
- **Deterministic + testable.** Every section, the amount, and the draft come
  from the pure core in `lib/skills/catalog/capital-call.ts`, tested independently
  of any model.

## Amount logic

```
callAmount = input.callAmount
           ?? (totalCommitment != null && callPercent != null
                 ? round(totalCommitment × callPercent ÷ 100, 2)   // calculation
                 : null)                                            // flagged
```

The skill requires `fundName` **and** (`callAmount` **or** both
`totalCommitment` and `callPercent`). When that is not met, the amount is flagged
in `missingFields` rather than invented.

## Sections (fixed order)

1. **Header** — fund + investor + call number.
2. **Amount Due** — the called amount, or open when it cannot be formed.
3. **Due Date** — from `dueDate`, else open (*"Pending — confirm due date"*).
4. **Purpose** — from `purpose`, else open.
5. **Wiring Instructions** — **always open**; a placeholder the fund admin must
   supply. Never auto-populated, never fabricated.

`noticeDraft = {heading, body}` is assembled **only** from the complete sections,
so the open wiring placeholder never appears in the draft body.

## Example

See [`examples/example-1.json`](./examples/example-1.json) — a draft with an
explicit amount, due date, and purpose. Every section is complete except Wiring
Instructions, which remains an open placeholder. Preparing the notice moves no
capital and sends nothing.
