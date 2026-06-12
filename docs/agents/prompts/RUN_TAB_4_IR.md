# Agent prompt — Run tab 4: IR & reporting

Copy-paste prompt for the agent (read `docs/agents/RUN_TABS_PLAYBOOK.md`
first — it is binding, including the **shared-file rule** for
`lib/run-ops/**`):

---

You own the **IR & reporting** tab of the Run hub in
Bey-Group-International/fundexecs-os. Branch: `agent/run-ir` from current
main. Your mission: bring `components/run/IrFlow.tsx` (+ your sections of
`lib/run-ops/**` and `lib/queries/run-ops.ts`, page `app/(shell)/run/ir/`)
to full UX/UI parity with the `IRCenter` component in
`docs/agents/prototype/run/run.jsx.txt` (plus `IR_ITEMS`/`IR_CATS`/
`IR_LPS`/`IR_PERF`), under the rules in `docs/agents/RUN_TABS_PLAYBOOK.md`.

The prototype's element inventory — verify each against the live flow and
close every gap:

1. **The IR posture header** — the left-bordered card: the
   heart-handshake pill ("LPs warm" / "{n} LP needs attention"), champion +
   open-report counts, the "{pct}% reporting on cadence · {sent}/{n} sent"
   progress bar, the "{n} to send"/"All sent" CTA pair and the ghost
   "Reporting calendar" action.
2. **Fund performance snapshot** — "what LPs check first": the metric grid
   (`IR_PERF`-style: e.g. net IRR, TVPI, DPI, NAV). HONESTY: these figures
   must come from real fund data where it exists; absent metrics render an
   honest empty/`Illustrative` state — never the prototype's numbers.
3. **LP engagement roster** — avatar rows with sentiment badges
   (Champion/warm/warning tones). Live LPs come from real committed
   investors (`capital_providers`/lp-room data); sentiment only renders
   where a real signal exists — `IR_LPS` never appears.
4. **Category filter chips** — All + `IR_CATS` (Letters, Statements,
   Events, Portal).
5. **The deliverables list** — left-bordered rows (`RUN_TONE`) with due
   badge, owner, drives-line, per-item action; done rows dimmed.
6. **Deliverable detail drawer** — slide-over with "Why it matters" line,
   the contents checklist (`Contents · {n}`), and the gold "{action} with
   Earn" approve-loop CTA; sent state confirmed.
7. **Send choreography** — ActionRunner steps ("Pull context with {who}",
   the action, "Update the record", "Prepare for your approval"), draft
   copy per the prototype, approve → the existing `markIrSent` server
   action. Sending never emails anyone yet — the action records the send;
   say so honestly in the draft copy.

Fidelity notes specific to this tab:

- The live flow persists IR deliverables via `lib/run-ops` (`IR_BASELINE`
  seeding + `markIrSent`); your job is parity on the posture header,
  performance snapshot, LP roster, filters, list anatomy, drawer and copy.
- `lib/run-ops/**` is shared with Workflows and Compliance — append-only,
  your exports only.
- Keep the `Illustrative` badge on any performance figure that is not yet
  computed from real fund records.

Definition of done, gates, and PR format: per the playbook. Open a draft PR
titled `Run tab — IR & reporting: prototype parity`.
