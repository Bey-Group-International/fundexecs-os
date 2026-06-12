# Agent prompt — Execute tab 2: Signatures & wires

Copy-paste prompt for the agent (read `docs/agents/EXECUTE_TABS_PLAYBOOK.md`
first — it is binding, including the Execute honesty contracts: wires are
record-keeping + attestation; signatures are attestations with the DocuSign
hook documented, never wired in this pass):

---

You own the **Signatures & wires** tab of the Execute hub in
Bey-Group-International/fundexecs-os. Branch: `agent/execute-wires` from
current main. Your mission: bring `components/execute/WiresFlow.tsx`
(+ `lib/wires/**`, `lib/queries/wires.ts`, page
`app/(shell)/execute/wires/`) to full UX/UI parity with the
`SignaturesWires` component in
`docs/agents/prototype/execute/execute.jsx.txt` (plus `SIG_SEED`/
`SIG_STATUS`, `WIRE_SEED`/`WIRE_STATUS`, `EX_ACCOUNTS`), under the rules in
`docs/agents/EXECUTE_TABS_PLAYBOOK.md`.

The prototype's element inventory — verify each against the live flow and
close every gap:

1. **The inner view tabs** — Signatures (pen-line) · Wire transfers
   (banknote) · Accounts (landmark), the prototype's nested SegTabs.
2. **The signature room** — document rows with `SIG_STATUS` badges
   (Signed / Partial / Awaiting), signer meta, and the per-state actions:
   gold **Sign** on pending (records the operator's attestation — copy
   notes the document was executed outside FundExecs OS; leave the
   DocuSign hook point documented), secondary **Chase** on partial (drafts
   the reminder through the approve loop).
3. **The wire board** — wire rows with `WIRE_STATUS` badges (Cleared /
   Staged / Expected), direction (in/out), amount, counterparty,
   drives-line; gold **Release** on staged and secondary **Confirm** on
   expected — both through the approve loop with the prototype's dual-
   control choreography ("Verify account & amount", "Dual-control
   approval", release/match, **"Log to Chain of Trust"** — make it real).
   Honesty contract: the copy states this RECORDS the wire; no money moves
   through FundExecs OS.
4. **The accounts strip** — "Total fund cash" + per-account rows. Balances
   render ONLY from real connected data; with none, the honest
   empty/`Illustrative` state explains that balances sync once banking is
   connected — never `EX_ACCOUNTS` seeds.
5. **Record choreography** — per the prototype's `run` payloads: draft copy
   "{Outbound/Inbound} wire of {amt} — {to}. Approve to {release/confirm}
   under dual control.", approve → real server action, status transitions
   server-enforced (expected → cleared, staged → cleared).

Fidelity notes specific to this tab:

- The live flow persists via `lib/wires/**` + `lib/queries/wires.ts`; your
  job is parity on the three inner views, status boards, action states and
  copy — under the honesty contracts.
- Status vocabulary (tones, labels, transitions) belongs in `lib/wires/`
  (pure, unit-tested).

Definition of done, gates, and PR format: per the playbook. Open a draft PR
titled `Execute tab — Signatures & wires: prototype parity`.
