# Agent prompt — Build tab 1: Materials & data room

Copy-paste prompt for the agent (read `docs/agents/BUILD_TABS_PLAYBOOK.md`
first — it is binding):

---

You own the **Materials & data room** tab of the Build hub in
Bey-Group-International/fundexecs-os. Branch: `agent/build-data-room` from
current main. Your mission: bring `components/dataroom/DataRoomFlow.tsx`
(+ `components/dataroom/PublicRoomView.tsx`, `lib/dataroom/**`,
`lib/queries/data-room.ts`, page `app/(shell)/build/data-room/`, public
route `app/dr/[token]/`) to full UX/UI parity with the prototype module at
`docs/agents/prototype/build/materials.jsx.txt`, under the rules in
`docs/agents/BUILD_TABS_PLAYBOOK.md`.

The prototype's component inventory — verify each against the live flow and
close every gap:

1. **The six investor materials** (`MAT_DOCS`: deck, onepager, ddq, track,
   model, update) with their metadata (`MAT_META`/`MAT_LABEL`), the
   Draft → Ready stages and tones (`MAT_TONE`), the materials grid, the
   readiness header (n/6 LP-ready + progress bar), and the Formation
   callout (`FORM_DOC_META`): the legal set — LPA, PPM, subscription pack,
   Form D — is built in Formation and flows into the room read-only; only
   the investor-facing materials build here.
2. **MaterialBuilder** — the copiloted wizard per material: the decision
   sets from `MATERIAL_BUILD` (radio/multi chip rows), Earn's
   recommendation card (`rec`/`recText` and the apply moment), the build
   choreography (the `buildSteps` progress sequence), and the spec-review
   done state with its "Add to room" moment.
3. **The room view** — the live-room banner, the Documents panel with
   per-document secure links (`linkToken` shape, "Vets: Accredited + NDA",
   viewer rows), the "Who has access" panel, and the room activity feed.
   The prototype's seeded benches (`DR_ACCESS_0`, `DR_ACTIVITY_0`,
   `DR_INVITEES`) must NOT appear as real data — live access and activity
   derive only from persisted rows, and empty states carry the load.
4. **VettingGate** — the recipient gate: identity (name/firm/email) plus
   accredited + NDA attestations → the unlocked, watermarked document, with
   the prospect bench (`DR_PROSPECTS`) cycling the preview persona. In-app
   this is a labelled **Preview** that records nothing; the real gate is
   the public `/dr/[token]` route.

Fidelity notes specific to this tab:

- The live flow already persists: built materials + operator specs in
  `capital_materials` (kinds via `MATERIAL_DB_KIND`), share links in
  `data_room_links` (server-generated token), and real recipient views in
  `data_room_views` — written ONLY by the public route
  (`lib/dataroom/public-actions.ts`). Your job is parity on the builder
  choreography, decision sets, recommendation copy, stage chips, room
  composition and gate ergonomics — never fabricate a view or a viewer.
- The public route is live (`app/dr/[token]`, `PublicRoomView`, covered by
  `e2e/public-data-room.spec.ts`) — keep the in-app gate's `Preview`
  labelling honest against it, and keep that e2e green.
- There is no `Illustrative` badge on this surface — materials, links and
  views are real. What stays illustrative is the drafting choreography and
  the in-app recipient preview, each labelled in place.
- Material vocabulary, decision configs and seeded benches live in
  `lib/dataroom/config.ts` (pure, unit-tested — `config.test.ts`); extend
  there, not inline.
- Server actions in `lib/dataroom/actions.ts` (`buildMaterial`,
  `generateMaterialLink`) own all writes; spec sanitization stays in
  `lib/dataroom/persistence.ts` (unit-tested). Keep new mutations behind
  the same server-action + sanitize path.

Definition of done, gates, and PR format: per the playbook. Open a draft PR
titled `Build tab — Materials & data room: prototype parity`.
