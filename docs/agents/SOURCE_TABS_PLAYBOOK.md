# Source tabs — four-agent playbook

Four agents work **in parallel**, one per Source module tab, each driving
their interior to **full prototype UX/UI fidelity**. This file is the shared
contract; your tab's prompt is in `docs/agents/prompts/`. The conventions
mirror the Build swarm (`BUILD_TABS_PLAYBOOK.md`); territories and spec
references below are Source's.

| #   | Tab                  | Prompt                                | Live surface you own                                                                                                         |
| --- | -------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | Deal pipeline        | `prompts/SOURCE_TAB_1_PIPELINE.md`    | `components/source/DealPipelineFlow.tsx`, `lib/queries/pipeline.ts`, `app/(shell)/source/pipeline/**`                        |
| 2   | LP & capital targets | `prompts/SOURCE_TAB_2_CAPITAL_MAP.md` | `components/source/CapitalMapFlow.tsx`, `lib/pipeline/**`, `lib/queries/lp-pipeline.ts`, `app/(shell)/source/capital-map/**` |
| 3   | Partners & providers | `prompts/SOURCE_TAB_3_PARTNERS.md`    | `components/source/PartnerNetworkFlow.tsx`, `lib/queries/partners.ts`, `app/(shell)/source/partners/**`                      |
| 4   | Lead engine          | `prompts/SOURCE_TAB_4_LEADS.md`       | `components/source/LeadEngineFlow.tsx`, `lib/leads/**`, `lib/queries/leads.ts`, `app/(shell)/source/leads/**`                |

The spec for everyone: `prototype/source/source.jsx.txt` — the prototype's
entire Source module (SourceHub composition + all four tab components with
their configs). Shared references: `prototype/build/data-layer.jsx.txt` and
`prototype/build/ui-kit.jsx.txt`.

The prototype's tab order is LP Capital Map → Deal pipeline → Partner
Network → Lead Engine; the hub shell (already live) follows it and
`/source` deep-links to `/source/capital-map`.

## Branch & PR

- Branch: `agent/source-<tab>` (e.g. `agent/source-pipeline`). Branch from
  current `main` (must include the Source hub shell PR — the tabbed chrome
  your tab renders inside).
- One **draft PR** per agent, titled `Source tab — <name>: prototype parity`.
- PR body: what the prototype shows → what was missing → what you changed,
  with a checklist mapping each prototype element to its live counterpart.
- Never push to another agent's branch or to `claude/*` branches.

## File territories (hard boundary)

Touch **only** the paths in your row above. These are shared and
**off-limits** — if your tab needs a change in one, leave a PR comment
describing it instead of editing:

- `app/(shell)/source/layout.tsx`, `app/(shell)/source/page.tsx`,
  `components/hubs/**` (the hub shell)
- `lib/source/**` (the hub's shared vocab + workspace model)
- `components/shell/**`, `app/(shell)/layout.tsx`
- `lib/hubs/**`, `components/ui/**`, `components/earn/**`
- `lib/supabase/**`, `supabase/migrations/**` of other tabs, `.github/**`,
  `e2e/**`, `playwright.config.ts`

If you genuinely need a migration for your own tab, follow the house pattern:
additive + idempotent (`create table if not exists`, `pg_policies` guards),
org-scoped RLS with member writes (copy `20260611240000_closings_member_writes.sql`),
and hand-patch `lib/supabase/database.types.ts` to match.

## Persona vocabulary

The hub adapts its first-tab vocabulary to the org's type via
`lib/source/vocab.ts` (`SRC_TITLE`/`SRC_NOUN`/`sourceGroupFor` — fund ·
capital · service, matching the prototype). Consume it; never hard-code
"LP" where the noun should adapt. The vocab module itself is shell
territory — comment on the PR if it needs a new export.

## Fidelity rules

1. **The prototype is the spec** for layout, hierarchy, copy tone, motion and
   flow choreography. Port px-level details to the existing Tailwind tokens
   (`fg-1..5`, `surface-1..3`, gold/azure/success/warning/danger/info
   soft+line vars, hairline borders) — never raw hex.
2. **Honest data only.** The prototype seeds fake LPs, deals, providers and
   leads (`*_SEED`). Every row and number on the live surface must come from
   Supabase or be clearly absent (real empty states). Regulated surfaces
   keep their `Illustrative` badges. Nothing fake is ever written to the
   database.
3. **The approve loop is law.** Every mutation — every stage advance — runs
   through `components/earn/ActionRunner` (steps → draft → "Approve &
   execute" → real server action; only success closes) exactly as the
   existing flows do. The prototype's per-row `run` payloads (steps,
   draftTitle, draft copy) are the choreography to match.
4. **Server-enforced transitions.** Stage gates live in the server action,
   not just the UI — a row advances one stage at a time, in order.
5. Pure logic goes in a `lib/<domain>/` vocabulary module with `node:test`
   unit tests (`import { test } from 'node:test'`, `assert/strict`).
6. Client components: `'use client'`, lucide-react icons, `motion/react`
   with `useReducedMotion` for anything animated.

## Gates (all must pass before you push)

```bash
npm run typecheck && npm run lint && npm run format:check \
  && npm run test:unit && npm run build
```

`npx prettier --write <files>` fixes formatting. Commit messages: imperative
summary + body explaining prototype-parity changes.

## Definition of done

- Every element in your tab's prototype component has a live counterpart or
  a written justification in the PR body for divergence (honest-data being
  the usual one).
- Deep link (`/source/<tab>`) renders your tab inside the hub shell with no
  duplicate hub-level hero.
- Gates green; unit tests added for any new pure logic.
- PR opened as draft with the fidelity checklist filled in.
