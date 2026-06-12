# Agent prompt — Source tab 4: Lead engine

Copy-paste prompt for the agent (read `docs/agents/SOURCE_TABS_PLAYBOOK.md`
first — it is binding):

---

You own the **Lead engine** tab of the Source hub in
Bey-Group-International/fundexecs-os. Branch: `agent/source-leads` from
current main. Your mission: bring
`components/source/LeadEngineFlow.tsx` (+ `lib/leads/**`,
`lib/queries/leads.ts`, page `app/(shell)/source/leads/`) to full UX/UI
parity with the `LeadEngine` component in
`docs/agents/prototype/source/source.jsx.txt`, under the rules in
`docs/agents/SOURCE_TABS_PLAYBOOK.md`.

The prototype's element inventory — verify each against the live flow and
close every gap:

1. **Panel framing** — title "Lead Engine", eyebrow "Demand generation by
   Vivian & Camille · tap a lead to open", megaphone icon, ghost "Generate
   leads" action.
2. **The portfolio-company banner** — the gold strip explaining WHOSE
   customers are being sourced ("Sourcing customers for {company} — Earn
   spins up a Lead Engine for every acquisition you close"). The prototype
   hard-codes "Atlas Manufacturing"; live, the company comes from a real
   portfolio/deal record — with none, the banner becomes the honest
   explanation of when a Lead Engine spins up.
3. **Funnel summary tiles** — Live leads (count, azure) · Pipeline value
   (weighted ARR $, gold) · Meetings booked (count, success), all real.
4. **Stage funnel** — four `LEAD_STAGES` columns (New, Qualified, Contacted,
   Meeting) with counts and `LEAD_TONE` top borders.
5. **Lead cards grid** — sorted by stage desc then intent; building icon,
   name + segment, stage badge, Intent (fit-colored) / Value $K.
6. **Detail drawer** — header with icon/name/segment, three stat cards
   (Intent / Value / Stage badge), the **"Intent signal"** card ("Scored
   {intent} on buying intent and fit to {company}'s ICP"), Last activity
   meta, and the gold **"Earn's next move"** block — `LEAD_NEXT[stage]`
   ("Qualify" / "Reach out" / "Book meeting") with segment-personalized
   copy — or, at Meeting, the success "Meeting booked · sales-ready" strip
   (calendar-check icon).
7. **Advance choreography** — `runLead`: ActionRunner steps ("Pull intent +
   firmographics", "Draft the {act}", "Personalize to their segment",
   "Prepare for your approval"), draft copy per the prototype, approve →
   server action advances exactly one stage.

Fidelity notes specific to this tab:

- Lead persistence + scoring lives in `lib/leads/` (`engine.ts` is pure and
  unit-tested) and `lib/queries/leads.ts`; extend there, never inline.
- Honest data is the sharpest constraint here: `LEAD_SEED` rows and the
  hard-coded portfolio company never appear. Intent scores shown must come
  from the real scoring path; absent leads render the honest empty state
  with the path to generate/import them.
- Stage vocabulary may need reconciling with live lead statuses — map in
  your query/config layer with unit tests and document it in the PR body.

Definition of done, gates, and PR format: per the playbook. Open a draft PR
titled `Source tab — Lead engine: prototype parity`.
