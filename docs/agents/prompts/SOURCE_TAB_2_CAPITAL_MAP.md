# Agent prompt — Source tab 2: LP & capital targets

Copy-paste prompt for the agent (read `docs/agents/SOURCE_TABS_PLAYBOOK.md`
first — it is binding):

---

You own the **LP & capital targets** tab of the Source hub in
Bey-Group-International/fundexecs-os. Branch: `agent/source-capital-map`
from current main. Your mission: bring
`components/source/CapitalMapFlow.tsx` (+ `lib/pipeline/**`,
`lib/queries/lp-pipeline.ts`, page `app/(shell)/source/capital-map/`) to
full UX/UI parity with the `LpCapitalMap` component in
`docs/agents/prototype/source/source.jsx.txt`, under the rules in
`docs/agents/SOURCE_TABS_PLAYBOOK.md`.

The prototype's element inventory — verify each against the live flow and
close every gap:

1. **Panel framing** — title from `lib/source/vocab.ts` (`SRC_TITLE` — "LP
   Capital Map" for funds, adaptive for other personas), eyebrow
   "Fit-scored & ranked by Sloane · tap an LP to open", landmark icon,
   ghost "Build more targets" action.
2. **The raise thermometer** — committed (success gradient) + soft-circled
   (gold, 0.55 opacity) stacked against the target, with the
   "{committed} committed + {soft} soft-circled / of {target} target" line
   and "{pct}% closed · {pct}% more in pipeline" caption. Target comes from
   the org's real raise target, never a hard-coded `LP_RAISE_TARGET`.
3. **Stage funnel** — four `LP_STAGES` columns (Target, Contacted,
   Soft-circled, Committed) with count + $ per stage and `LP_STAGE_TONE`
   top borders.
4. **LP cards grid** — sorted by stage desc then fit; avatar (gold tone when
   Committed), name + type, stage badge, Check $ / Fit (fit-colored) /
   warmth.
5. **Detail drawer** — header with avatar/name/type/warmth, three stat cards
   (Check / Fit score / Stage badge), the **"Why they fit"** card ("Sloane
   scored this a {fit} on thesis alignment, check size and warmth"),
   Source / Last touch meta, and the gold **"Earn's next move"** block —
   `LP_NEXT[stage]` ("Draft intro" / "Send follow-up" / "Lock allocation")
   with the personalization copy — or, when Committed, the success
   "Committed · ${amt} closed" strip.
6. **Advance choreography** — `runLp`: ActionRunner steps ("Pull
   engagement + fit signals", "Draft the {act}", "Attach your one-pager +
   track record", "Prepare for your approval"), draft copy per the
   prototype ("nothing leaves FundExecs OS until you confirm"), approve →
   server action advances exactly one stage.

Fidelity notes specific to this tab:

- The live LP board persists in `capital_providers` via
  `lib/queries/lp-pipeline.ts` (stage normalization + roll-ups already
  exist); your job is parity on the thermometer, funnel, card grid, drawer
  anatomy and copy.
- This tab's vocabulary adapts per persona — consume `lib/source/vocab.ts`
  (`SRC_NOUN`); never hard-code "LP" in adaptive copy.
- Real data only: `LP_SEED` never appears; an empty map renders an honest
  empty state with a path to add targets.

Definition of done, gates, and PR format: per the playbook. Open a draft PR
titled `Source tab — LP & capital targets: prototype parity`.
