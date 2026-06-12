# Agent prompt — Build tab 2: Structure & governance

Copy-paste prompt for the agent (read `docs/agents/BUILD_TABS_PLAYBOOK.md`
first — it is binding):

---

You own the **Structure & governance** tab of the Build hub in
Bey-Group-International/fundexecs-os. Branch: `agent/build-governance` from
current main. Your mission: bring `components/governance/GovernanceFlow.tsx`
(+ `lib/governance/**`, `lib/queries/governance-hub.ts`, page
`app/(shell)/build/governance/`) to full UX/UI parity with the prototype
module at `docs/agents/prototype/build/governance.jsx.txt`, under the rules
in `docs/agents/BUILD_TABS_PLAYBOOK.md`.

The prototype's component inventory — verify each against the live flow and
close every gap:

1. **The governance bodies** — Investment Committee, Fund Management,
   Advisory Board, Capital/LPAC, Legal & Counsel rosters (`IC_MEMBERS_0`,
   `FM_0`, `ADV_0`, `CAP_0`, `LEGAL_0`, `LPAC_0`) with their **candidate
   benches** (`*_CANDIDATES`): the add-from-bench interaction, member chips
   with roles, and how a roster reads when empty. Live rosters persist in
   `governance_bodies` (kind + members jsonb) — the prototype's seeded
   people must NOT appear as real data; the candidate bench is presented as
   suggestions, and only operator-confirmed members persist.
2. **GovChip** — the selectable chip primitive used across the builders.
3. **PolicyBuilder** — the policy adoption wizard for the six policies
   (`GOV_POLICIES`: valuation, conflicts, allocation, compliance, ethics,
   cyber): per-policy decision sets, Earn's recommendation copy, the drafted
   policy preview, and the adopt moment (approve loop →
   `governance_policies` row).
4. **The hub view composition** — policy grid with To do/Drafting/Active
   stages and tones (`POL_STAGES`/`POL_TONE`), the bodies section, and the
   per-policy "Draft → Adopt" stage progression.

Fidelity notes specific to this tab:

- The live flow already persists adopted policies and body rosters; your
  job is parity on the builder choreography, decision sets, recommendation
  copy, stage chips and roster interactions.
- The `Illustrative` badge on this surface stays.
- Decision configs and policy vocabulary live in `lib/governance/config.ts`
  (pure, unit-tested) — extend there, not inline.
- Server actions in `lib/governance/actions.ts` enforce adoption; keep new
  mutations behind the ActionRunner approve loop.

Definition of done, gates, and PR format: per the playbook. Open a draft PR
titled `Build tab — Structure & governance: prototype parity`.
