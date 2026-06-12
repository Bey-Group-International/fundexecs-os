# Build tabs — four-agent playbook

Four agents work **in parallel**, one per Build module tab, each driving their
interior to **full prototype UX/UI fidelity**. This file is the shared
contract; your tab's prompt is in `docs/agents/prompts/`.

| #   | Tab                    | Prompt                              | Prototype source (reference)         | Live surface you own                                                                                                                                          |
| --- | ---------------------- | ----------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Fund formation         | `prompts/BUILD_TAB_1_FORMATION.md`  | `prototype/build/formation.jsx.txt`  | `components/formation/**`, `lib/formation/**`, `app/(shell)/build/formation/**`                                                                               |
| 2   | Structure & governance | `prompts/BUILD_TAB_2_GOVERNANCE.md` | `prototype/build/governance.jsx.txt` | `components/governance/**`, `lib/governance/**`, `lib/queries/governance-hub.ts`, `app/(shell)/build/governance/**`                                           |
| 3   | Materials & data room  | `prompts/BUILD_TAB_3_DATA_ROOM.md`  | `prototype/build/data-room.jsx.txt`  | `components/dataroom/**` (except `PublicRoomView.tsx`), `lib/dataroom/**` (except `public*.ts`), `lib/queries/data-room.ts`, `app/(shell)/build/data-room/**` |
| 4   | Your profile & brand   | `prompts/BUILD_TAB_4_BRAND.md`      | `prototype/build/brand.jsx.txt`      | `components/brand-studio/**`, `lib/brand-studio/**`, `lib/queries/brand-studio.ts`, `app/(shell)/build/brand/**`                                              |

Shared references for everyone: `prototype/build/data-layer.jsx.txt` (the
prototype's seeds, options and copy) and `prototype/build/ui-kit.jsx.txt`
(its visual primitives — match them with our `components/ui/*` equivalents).

**Follow-on agents** (run AFTER their tab's parity PR merges, same rules,
same territory as the parity agent):

| #   | Pass                           | Prompt                                       | Prerequisite        |
| --- | ------------------------------ | -------------------------------------------- | ------------------- |
| 1B  | Formation checklist — buildout | `prompts/BUILD_TAB_1B_FORMATION_BUILDOUT.md` | Tab 1 parity merged |

## Branch & PR

- Branch: `agent/build-<tab>` (e.g. `agent/build-formation`). Branch from
  current `main` (must include PR #352 — the tabbed hub shell your tab
  renders inside).
- One **draft PR** per agent, titled `Build tab — <name>: prototype parity`.
- PR body: what the prototype shows → what was missing → what you changed,
  with a checklist mapping each prototype component to its live counterpart.
- Never push to another agent's branch or to `claude/*` branches.

## File territories (hard boundary)

Touch **only** the paths in your row above. These are shared and
**off-limits** — if your tab needs a change in one, leave a PR comment
describing it instead of editing:

- `app/(shell)/build/layout.tsx`, `components/hubs/**` (the hub shell)
- `components/shell/**`, `app/(shell)/layout.tsx`
- `lib/hubs/**`, `components/ui/**`, `components/earn/**`
- `lib/supabase/**`, `supabase/migrations/**` of other tabs, `.github/**`,
  `e2e/**`, `playwright.config.ts`

If you genuinely need a migration for your own tab, follow the house pattern:
additive + idempotent (`create table if not exists`, `pg_policies` guards),
org-scoped RLS with member writes (copy `20260611240000_closings_member_writes.sql`),
and hand-patch `lib/supabase/database.types.ts` to match.

## Fidelity rules

1. **The prototype is the spec** for layout, hierarchy, copy tone, motion and
   flow choreography. Port px-level details to the existing Tailwind tokens
   (`fg-1..5`, `surface-1..3`, gold/azure/success/warning/danger soft+line
   vars, hairline borders) — never raw hex.
2. **Honest data only.** The prototype seeds fake rosters, counts and
   activity. Every number on the live surface must come from Supabase or be
   clearly absent (real empty states). Regulated surfaces keep their
   `Illustrative` badges. Nothing fake is ever written to the database.
3. **The approve loop is law.** Every mutation runs through
   `components/earn/ActionRunner` (steps → draft → "Approve & execute" →
   real server action; only success closes) exactly as the existing flows do.
4. **Server-enforced transitions.** Stage gates live in the server action,
   not just the UI.
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

- Every component in your prototype source has a live counterpart or a
  written justification in the PR body for divergence (honest-data being the
  usual one).
- Deep link (`/build/<tab>`) renders your tab inside the hub shell with no
  duplicate hub-level hero.
- Gates green; unit tests added for any new pure logic.
- PR opened as draft with the fidelity checklist filled in.
