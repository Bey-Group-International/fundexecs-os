# Agent prompt — Build tab 1: Fund formation

Copy-paste prompt for the agent (read `docs/agents/BUILD_TABS_PLAYBOOK.md`
first — it is binding):

---

You own the **Fund formation** tab of the Build hub in
Bey-Group-International/fundexecs-os. Branch: `agent/build-formation` from
current main. Your mission: bring `components/formation/FormationFlow.tsx`
(+ `lib/formation/**`, page `app/(shell)/build/formation/`) to full UX/UI
parity with the prototype module at
`docs/agents/prototype/build/formation.jsx.txt`, under the rules in
`docs/agents/BUILD_TABS_PLAYBOOK.md`.

The prototype's component inventory — verify each against the live flow and
close every gap:

1. **FormationStory** — the narrative intro arc (`FORMATION_ARC`): full-bleed
   staged story with the firm's name woven in, "Begin formation" CTA.
2. **The sequence checklist** — numbered rows, the next item highlighted
   accent-soft with a Continue button, Done rows with success check +
   "Filed" badge, the "Each step is copiloted — you decide, Earn drafts"
   info line.
3. **FormationItem (the copiloted document wizard)** — per-document decision
   panels: radio/multi options (`F_ENTITY_OPTS`, `F_EXEMPTION_OPTS`, edges),
   `FSlider` (carry/term-style sliders with hints), `FToggle` rows, the
   `Undec()` undecided marker, Earn's recommendation copy per decision,
   `resultRows()` document-preview summary, the approve moment, and the
   "next document" handoff (`onOpenNext`).
4. **FormationComplete** — the certificate moment: full summary of what was
   formed, the celebratory framing, "Review" + "Open Source hub" CTAs.

Fidelity notes specific to this tab:

- The live flow already has Story/Checklist/Step/Complete views — your job
  is pixel-and-flow parity inside them: compare decision sets, slider
  hints, recommendation copy, preview rows and transitions against the
  prototype source and close drift.
- Persistence is real (`fund_formations` data jsonb + `formation_steps`
  rows via `lib/formation/actions.ts`); keep every mutation behind the
  ActionRunner approve loop, including any decisions you add.
- The `Illustrative` badge on this surface stays.
- `lib/formation/config.ts` is yours — extend decision configs there (pure,
  unit-tested) rather than inlining options in the component.

Definition of done, gates, and PR format: per the playbook. Open a draft PR
titled `Build tab — Fund formation: prototype parity`.
