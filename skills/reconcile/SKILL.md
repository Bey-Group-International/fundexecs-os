# Account Reconciliation (`reconcile`)

Prepare a **GL / bank reconciliation** for operator review and return a
structured, provenanced result — the **difference** between the statement balance
and the ledger balance, whether the account **ties**, the transaction-level
**breaks** (unmatched items and amount mismatches) with their variances, the
total that remains **unexplained**, matched/unmatched counts, the material data
that is missing, and the key risks.

This is a **native FundExecs skill**: a versioned, schema-defined, policy-governed
reusable workflow. It runs through the skill runtime (`lib/skills/runner.ts`),
which validates the input, checks that the assigned executive is permitted to run
it, executes the deterministic core, validates the output, resolves the approval
tier, and persists a `skill_runs` record with an audit event.

## Contract

|                   |                                                                                                                        |
|-------------------|------------------------------------------------------------------------------------------------------------------------|
| **Approval tier** | 1 — internal, reversible preparation                                                                                   |
| **Risk**          | moderate                                                                                                               |
| **Executives**    | Fund Administration                                                                                                    |
| **Inputs**        | optional `accountName`, `statementBalance`, `ledgerBalance`, `transactions`                                            |
| **Outputs**       | `difference`, `reconciled`, `breaks`, `totalUnexplained`, `matchedCount`, `unmatchedCount`, `missingFields`, `keyRisks`, `recommendedAction` |
| **Artifacts**     | `analysis`                                                                                                             |
| **Downstream**    | `nav-review`, `close-period`                                                                                           |

Input/output are enforced against [`input.schema.json`](./input.schema.json) and
[`output.schema.json`](./output.schema.json). Governance lives in
[`policy.yaml`](./policy.yaml); acceptance fixtures in
[`evaluation.yaml`](./evaluation.yaml).

## Guardrails (the reason this is a skill, not a prompt)

- **Preparation only — never posts, never closes.** This skill *prepares* a
  reconciliation for operator review. It **never** posts a journal entry and
  **never** closes a period. Those are separate, gated actions
  (`post_journal_entry`, `post_to_closed_period`, `close_period`), prohibited on
  this manifest and cross-checked against the executive's prohibited actions.
- **Never fabricates a balance or an amount.** A missing balance is *flagged* in
  `missingFields` and `difference` is `null` — it is never guessed. The
  reconciliation is only computed when **both** the statement balance and the
  ledger balance are present.
- **Separates epistemics.** Every provided figure is a `fact`; every computed
  number (the difference, each break variance, the total unexplained) is a
  `calculation`. These are returned in `sources` and never collapsed.
- **Deterministic + testable.** The difference, the breaks, and every number come
  from the pure core in `lib/skills/catalog/reconcile.ts`, tested independently of
  any model.

## How the reconciliation is decided

1. **Difference.** Requires **both** balances. `difference = round(statementBalance
   − ledgerBalance, 2)`; when either balance is missing it is `null` and the
   missing balance is flagged. `reconciled` is `true` only when the difference is
   exactly `0`.
2. **Breaks.** A transaction is a **break** when it is an outstanding item
   (`matched === false`) **or** an amount mismatch (both sides present and
   unequal). Each break's `variance = (statementAmount ?? 0) − (ledgerAmount ?? 0)`;
   `totalUnexplained` is the rounded sum of break variances.
3. **Counts.** `matchedCount` / `unmatchedCount` come from the transactions'
   `matched` flag (`matched === false` counts as unmatched).
4. **Key risks.** A non-zero difference raises *"Statement and ledger do not tie"*;
   any breaks raise *"N unexplained break(s)"*.

## Example

See [`examples/example-1.json`](./examples/example-1.json) — a reconciliation that
does **not** tie ($500 difference) with two unexplained breaks (a $25 bank-fee
mismatch and a $100 outstanding check), prepared for operator review only.
