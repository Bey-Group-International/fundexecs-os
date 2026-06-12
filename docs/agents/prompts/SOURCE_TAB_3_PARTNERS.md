# Agent prompt — Source tab 3: Partners & providers

Copy-paste prompt for the agent (read `docs/agents/SOURCE_TABS_PLAYBOOK.md`
first — it is binding):

---

You own the **Partners & providers** tab of the Source hub in
Bey-Group-International/fundexecs-os. Branch: `agent/source-partners` from
current main. Your mission: bring
`components/source/PartnerNetworkFlow.tsx` (+ `lib/queries/partners.ts`,
page `app/(shell)/source/partners/`) to full UX/UI parity with the
`PartnerNetwork` component in
`docs/agents/prototype/source/source.jsx.txt`, under the rules in
`docs/agents/SOURCE_TABS_PLAYBOOK.md`.

The prototype's element inventory — verify each against the live flow and
close every gap:

1. **Panel framing** — title "Partner Network", eyebrow "Vetted partners &
   providers · tap to open", handshake icon, ghost "Find more partners"
   action.
2. **Coverage summary tiles** — Essential coverage (x/4 engaged, success) ·
   Engaged (count, gold) · On the bench (count, azure), all real.
3. **Essential coverage chips** — the `PROV_ESSENTIAL` strip (Fund counsel,
   Fund administration, Audit & tax, Placement agent): success-soft with a
   check when a provider of that category is Engaged, neutral with the
   category icon (`PROV_CAT_ICON`) otherwise.
4. **Partner cards grid** — sorted Engaged-first then fit; category icon
   (success-toned when Engaged), name + category, `PROV_TONE` stage badge
   (Suggested / Contacted / Engaged), Fit (fit-colored) + note line.
5. **Detail drawer** — header with category icon/name/category, three stat
   cards (Fit / **Terms** as text / Status badge), the **"Why this
   partner"** card ("Vetted by Adrian and scored {fit} on fit, terms and
   references for a fund your size"), Last activity meta, and the gold
   **"Earn's next move"** block — `PROV_NEXT[stage]` ("Request intro" /
   "Engage") with the outreach copy — or, when Engaged, the success
   "Engaged · active relationship" strip.
6. **Advance choreography** — `runProvider`: ActionRunner steps ("Pull
   vetting + fit on {category}", "Draft the {act}", "Check terms &
   references", "Prepare for your approval"), draft copy per the prototype,
   approve → server action advances exactly one stage.

Fidelity notes specific to this tab:

- The live marketplace persists service + capital providers via
  `lib/queries/partners.ts` with intro statuses; your job is parity on the
  coverage tiles, chips, bench grid, drawer anatomy and copy.
- The "vetted bench" framing is honest ONLY for rows that exist in the
  database. `PROVIDER_SEED` never appears; with no providers, render an
  honest empty state explaining how the bench fills.
- Stage vocabulary may need reconciling with the live `status` values — do
  it in your tab's query layer with unit tests and document the mapping in
  the PR body.

Definition of done, gates, and PR format: per the playbook. Open a draft PR
titled `Source tab — Partners & providers: prototype parity`.
