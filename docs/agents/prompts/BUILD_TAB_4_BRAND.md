# Agent prompt — Build tab 4: Your profile & brand

Copy-paste prompt for the agent (read `docs/agents/BUILD_TABS_PLAYBOOK.md`
first — it is binding):

---

You own the **Your profile & brand** tab of the Build hub in
Bey-Group-International/fundexecs-os. Branch: `agent/build-brand` from
current main. Your mission: bring
`components/brand-studio/BrandStudioFlow.tsx` (+ `lib/brand-studio/**`,
`lib/queries/brand-studio.ts`, page `app/(shell)/build/brand/`) to full
UX/UI parity with the prototype module at
`docs/agents/prototype/build/brand.jsx.txt`, under the rules in
`docs/agents/BUILD_TABS_PLAYBOOK.md`.

The prototype's component inventory — verify each against the live flow and
close every gap:

1. **BrandHub composition** — the studio overview: `BrandStat` tiles, the
   builder grid with stages, and the public-profile preview framing.
2. **BrandKitBuilder** — identity decisions: tagline options
   (`BK_TAGLINES`), tone/visual choices, Earn recommendations, the drafted
   kit preview, the build moment (approve loop → persisted spec).
3. **BioBuilder** — the principal bio: decision panels feeding
   `composeBio()` (live equivalent in `lib/brand-studio`), drafted bio
   preview, approve to persist.
4. **CredentialsBuilder** — track-record credentials: the deals editor
   (the prototype seeds `TR_REC_DEALS` — live version edits REAL entries,
   never seeded ones), `trAgg()`-style aggregates (count, MOIC, realized),
   recognition chips (`TR_RECOGNITION_OPTS`), preview + approve.
5. **Connections (`CONNECTORS`)** — the integrations strip. Live version is
   already wired to `/api/integrations/{provider}/connect` with real
   status — verify parity of the card states (Connected / Connect / Soon)
   against the prototype's strip.

Fidelity notes specific to this tab:

- This is the largest prototype module (65KB) — work component by
  component; the PR checklist must map all five areas.
- Honest data is the sharpest constraint here: the prototype's recommended
  deals, follower-style stats and recognition examples are presented as
  OPTIONS/suggestions, never as the operator's actual record. Aggregates
  compute from operator-entered rows only; empty states are honest.
- Configs live in `lib/brand-studio/` (pure, unit-tested); keep all
  mutations behind the ActionRunner approve loop.

Definition of done, gates, and PR format: per the playbook. Open a draft PR
titled `Build tab — Your profile & brand: prototype parity`.
