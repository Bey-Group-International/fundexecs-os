# Agent prompt — Build tab 3: Materials & data room

Copy-paste prompt for the agent (read `docs/agents/BUILD_TABS_PLAYBOOK.md`
first — it is binding):

---

You own the **Materials & data room** tab of the Build hub in
Bey-Group-International/fundexecs-os. Branch: `agent/build-data-room` from
current main. Your mission: bring `components/dataroom/DataRoomFlow.tsx`
(+ `lib/dataroom/**` EXCEPT `public.ts`/`public-actions.ts`,
`lib/queries/data-room.ts`, page `app/(shell)/build/data-room/`) to full
UX/UI parity with the prototype module at
`docs/agents/prototype/build/data-room.jsx.txt`, under the rules in
`docs/agents/BUILD_TABS_PLAYBOOK.md`.

Do NOT touch the public share surface (`app/dr/**`,
`components/dataroom/PublicRoomView.tsx`, `lib/dataroom/public*.ts`) — it
is live and outward-facing.

The prototype's component inventory — verify each against the live flow and
close every gap:

1. **MaterialBuilder** — the copiloted builder per material (deck, one-pager,
   DDQ, track record, model, LP update): decision panels (`RadioRow`,
   multi-chips), Earn's per-material recommendation (`rec`/`recText` in the
   config), the drafted preview, and the build moment (approve loop →
   `capital_materials` row with `spec`).
2. **MaterialsRoom composition** — the Missing/Drafted/Ready stage grid
   (`MAT_STAGES`/`MAT_TONE`), the **folder structure** (`DR_FOLDERS`: Fund
   Overview, Legal & Terms, Diligence, Track Record) showing where formation
   docs and materials file themselves, the **access bench** and **activity
   feed** — live from `data_room_links` + `data_room_views`, never seeded
   (`DR_ACCESS_0`/`DR_ACTIVITY_0`/`DR_INVITEES`/`DR_PROSPECTS` are
   prototype mocks; surface real rows or honest empty states).
3. **VettingGate** — the recipient-vetting preview modal. The REAL gate now
   lives on the public `/dr/[token]` route; the in-hub version is a
   preview/explanation of what recipients see (label it as preview — do not
   write fake `data_room_views`).
4. **Share links** — token generation per material (`generateMaterialLink`),
   the `fundexecs.com/dr/{token}` display with copy affordance, vetting
   level shown, and the live viewers list under each link.

Fidelity notes specific to this tab:

- Config and persistence are split (`lib/dataroom/config.ts` pure +
  `lib/dataroom/{persistence,actions}.ts`); extend configs there with unit
  tests, never inline.
- Every count (materials ready, views, links) must be real; the prototype's
  seeded prospects/invitees become honest empty-state copy or real rows.
- Keep all mutations behind the ActionRunner approve loop.

Definition of done, gates, and PR format: per the playbook. Open a draft PR
titled `Build tab — Materials & data room: prototype parity`.
