# Agent prompt — Execute tab 4: Chain of Trust

Copy-paste prompt for the agent (read `docs/agents/EXECUTE_TABS_PLAYBOOK.md`
first — it is binding):

---

You own the **Chain of Trust** tab of the Execute hub in
Bey-Group-International/fundexecs-os. Branch: `agent/execute-trust` from
current main. Your mission: bring
`components/execute/ChainOfTrustFlow.tsx` (+ `lib/queries/trust.ts`,
`lib/queries/trust-center.ts`, page
`app/(shell)/execute/chain-of-trust/`) to full UX/UI parity with the
`ChainOfTrust` component in
`docs/agents/prototype/execute/execute.jsx.txt` (plus `COT_LAYERS`/
`COT_RECORDS`), under the rules in `docs/agents/EXECUTE_TABS_PLAYBOOK.md`.

This tab is a LEDGER — it reads what the rest of the OS has logged
(formation filings, diligence resolutions, closing steps, wires, calls all
write `chain_of_trust_records`). You render the record; you never invent
or rewrite it. `lib/actions/trust.ts` is off-limits (shared writes).

The prototype's element inventory — verify each against the live flow and
close every gap:

1. **The 4 proof layers** — the `COT_LAYERS` strip (Proof of Truth →
   Proof of Concept → Proof of Execution → Proof of Work) with per-layer
   record counts from the REAL ledger, and layer filtering of the list.
2. **The chain-intact strip** — "Chain intact. {n} records sealed…" with
   the **Verify chain** action. Honesty: real records aren't yet
   cryptographically hashed — Verify must do something real (re-query and
   cross-check record counts/continuity server-side) and the copy must
   claim only what's true; keep an `Illustrative` badge on any
   cryptographic framing until hashing exists.
3. **The record ledger** — filterable rows from real
   `chain_of_trust_records` (+ `proof_layers` / `evidence` where present):
   entity type, recorded-by, timestamp, layer chip. Empty layers render
   honestly.
4. **Record drawer** — slide-over with Recorded by / Timestamp / Proof
   layer / Block # meta. The prototype shows a cryptographic hash — render
   the record's real id/lineage instead, and the "Open source document"
   action deep-links to the REAL originating surface (the formation step,
   diligence run, closing, etc.) — never a dead button.
5. **Export ledger** — the prototype's download action becomes real: a
   server-generated export (CSV/JSON) of the org's ledger rows.

Fidelity notes specific to this tab:

- Read-side only against the shared trust tables; if a write-side change
  seems needed, leave a PR comment instead of editing
  `lib/actions/trust.ts`.
- Layer vocabulary/counting is pure — put it in a small lib module under
  your territory with unit tests.
- This surface earns the strictest honesty: every count, timestamp and
  attribution must be real; the `Illustrative` badge stays on anything
  aspirational.

Definition of done, gates, and PR format: per the playbook. Open a draft PR
titled `Execute tab — Chain of Trust: prototype parity`.
