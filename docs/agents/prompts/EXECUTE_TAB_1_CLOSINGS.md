# Agent prompt — Execute tab 1: Closings

Copy-paste prompt for the agent (read `docs/agents/EXECUTE_TABS_PLAYBOOK.md`
first — it is binding, including the Execute honesty contracts):

---

You own the **Closings** tab of the Execute hub in
Bey-Group-International/fundexecs-os. Branch: `agent/execute-closings` from
current main. Your mission: bring `components/execute/ClosingsFlow.tsx`
(+ `lib/closings/**`, `lib/execute-closings/**`, `lib/queries/closings.ts`,
page `app/(shell)/execute/closings/`) to full UX/UI parity with the inline
Closings center in `docs/agents/prototype/execute/execute.jsx.txt` (the
`tab === 'closings'` branch of `ExecuteHub`, plus `EX_CLOSINGS`/
`EX_CLOSE_META`/`EX_STEP_TONE`), under the rules in
`docs/agents/EXECUTE_TABS_PLAYBOOK.md`.

The prototype's element inventory — verify each against the live flow and
close every gap:

1. **Closing switcher chips** — one chip per real open closing (name, kind,
   amount, `done/total` steps), accent-filled when active. Real `closings`
   rows only — never `EX_CLOSE_META` seeds.
2. **The progress header** — the pill ("Closed & funded" success vs
   "{n} steps to close" gold), "{done}/{total} steps executed", the green
   completion ProgressBar, the gold next-action CTA (executes the next
   ready step through the approve loop) and the ghost "Closing binder"
   action (route it to the real documents/data-room surface for this
   closing — never a dead button).
3. **The step ladder** — vertical timeline rows with connector lines
   (success-line when done), per-step status badges (`EX_STEP_TONE`:
   pending / ready / signed / wired), owner + party, drives-line; the NEXT
   step highlighted with its gold action button; rows openable.
4. **Step drawer** — slide-over with the step's detail, who/party meta, and
   the gold "Ready to execute" block ("nothing executes until you approve,
   and it's logged the moment you do") → approve loop; executed steps show
   their logged state.
5. **Execute choreography** — `runStep`: ActionRunner steps ("Pull the
   execution package", the step's action, "Capture signatures /
   confirmations", **"Log to Chain of Trust"** — make that real via
   `chain_of_trust_records`), draft copy per the prototype ("every action
   is recorded to your 4-layer proof"), approve → the existing closing-step
   server action advances pending → ready → signed/wired in order,
   server-enforced.
6. **The closed state** — when every step lands: the success celebration
   strip ("{amount} funded · signed, wired and logged to your Chain of
   Trust. {firm} now owns it." — firm from the real org identity).

Fidelity notes specific to this tab:

- The live flow already persists `closings` + `closing_steps` with member
  writes; your job is parity on the switcher, progress header, ladder
  anatomy, drawer choreography and copy.
- Signature/wire steps follow the Execute honesty contracts: executing a
  signature step records an attestation; the wire step records the wire —
  say so in the copy.
- Pure step vocabulary (status ladder, tones, ordering) belongs in
  `lib/closings/` or `lib/execute-closings/` (unit-tested).

Definition of done, gates, and PR format: per the playbook. Open a draft PR
titled `Execute tab — Closings: prototype parity`.
