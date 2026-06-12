# Run tabs — four-agent playbook

Four agents work **in parallel**, one per Run module tab, each driving their
interior to **full prototype UX/UI fidelity**. This file is the shared
contract; your tab's prompt is in `docs/agents/prompts/`. The conventions
mirror the Build and Source swarms; territories and spec references below
are Run's.

| #   | Tab            | Prompt                            | Live surface you own                                                                                                                                                                                                                          |
| --- | -------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Diligence      | `prompts/RUN_TAB_1_DILIGENCE.md`  | `components/run/StartDiligence.tsx`, `components/run/DiligenceDocumentsPanel.tsx`, `lib/diligence/**`, `lib/diligence-desk/**`, `lib/diligence-ui.ts`, `lib/queries/diligence.ts`, `lib/actions/diligence.ts`, `app/(shell)/run/diligence/**` |
| 2   | Workflows      | `prompts/RUN_TAB_2_WORKFLOWS.md`  | `components/run/WorkflowsFlow.tsx`, `lib/workflows/**`, `app/(shell)/run/workflows/**` (+ your sections of `lib/run-ops/**`, `lib/queries/run-ops.ts` — see shared-file rule)                                                                 |
| 3   | Compliance     | `prompts/RUN_TAB_3_COMPLIANCE.md` | `components/run/ComplianceFlow.tsx`, `lib/queries/compliance.ts`, `app/(shell)/run/compliance/**` (+ your sections of `lib/run-ops/**`, `lib/queries/run-ops.ts`)                                                                             |
| 4   | IR & reporting | `prompts/RUN_TAB_4_IR.md`         | `components/run/IrFlow.tsx`, `app/(shell)/run/ir/**` (+ your sections of `lib/run-ops/**`, `lib/queries/run-ops.ts`)                                                                                                                          |

The spec for everyone: `prototype/run/run.jsx.txt` — the prototype's entire
Run module (RunHub composition, the inline Diligence center, WorkflowsBoard,
ComplianceCenter, IRCenter, the shared RunSection primitive, and ALL seeds:
`DD_*`, `WF_*`, `CO_*`, `IR_*`, `AUTOMATIONS`, `RUN_TONE`). Shared
references: `prototype/build/data-layer.jsx.txt` and
`prototype/build/ui-kit.jsx.txt`.

The prototype's tab order is Diligence → Workflows → Compliance →
IR & reporting; the hub shell (already live) follows it and `/run`
deep-links to `/run/diligence`.

## Branch & PR

- Branch: `agent/run-<tab>` (e.g. `agent/run-diligence`), from current
  `main` (must include the Run hub shell PR — the tabbed chrome your tab
  renders inside).
- One **draft PR** per agent, titled `Run tab — <name>: prototype parity`.
- PR body: what the prototype shows → what was missing → what you changed,
  with a checklist mapping each prototype element to its live counterpart.
- Never push to another agent's branch or to `claude/*` branches.

## File territories (hard boundary)

Touch **only** the paths in your row above. These are shared and
**off-limits** — if your tab needs a change in one, leave a PR comment
describing it instead of editing:

- `app/(shell)/run/layout.tsx`, `app/(shell)/run/page.tsx`,
  `components/hubs/**` (the hub shell)
- `lib/run/**` (the hub's shared workspace model)
- `components/shell/**`, `app/(shell)/layout.tsx`
- `lib/hubs/**`, `components/ui/**`, `components/earn/**`
- `lib/supabase/**`, `supabase/migrations/**` of other tabs, `.github/**`,
  `e2e/**`, `playwright.config.ts`

**Shared-file rule for tabs 2–4**: `lib/run-ops/{actions,vocabulary}.ts` and
`lib/queries/run-ops.ts` serve Workflows, Compliance AND IR. Edits there are
**append-only and scoped to your own tab's exports** — extend your tab's
vocabulary/actions/views; never modify or move another tab's functions. If a
truly shared change is needed, leave a PR comment instead.

If you genuinely need a migration for your own tab, follow the house pattern:
additive + idempotent (`create table if not exists`, `pg_policies` guards),
org-scoped RLS with member writes (copy `20260611240000_closings_member_writes.sql`),
and hand-patch `lib/supabase/database.types.ts` to match.

## Fidelity rules

1. **The prototype is the spec** for layout, hierarchy, copy tone, motion and
   flow choreography. Port px-level details to the existing Tailwind tokens
   (`fg-1..5`, `surface-1..3`, gold/azure/success/warning/danger/info
   soft+line vars, hairline borders) — never raw hex.
2. **Honest data only.** The prototype seeds fake deals, findings, tasks,
   filings, deliverables and LP rosters. Every row and number on the live
   surface must come from Supabase or be clearly absent (real empty states).
   Regulated surfaces keep their `Illustrative` badges. Nothing fake is ever
   written to the database.
3. **The approve loop is law.** Every mutation — clearing a finding,
   advancing a task, resolving a filing, sending a report — runs through
   `components/earn/ActionRunner` (steps → draft → "Approve & execute" →
   real server action; only success closes). The prototype's per-row `run`
   payloads (steps, draftTitle, draft copy) are the choreography to match.
4. **Server-enforced transitions.** Status gates live in the server action,
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

- Every element in your tab's prototype component has a live counterpart or
  a written justification in the PR body for divergence (honest-data being
  the usual one).
- Deep link (`/run/<tab>`) renders your tab inside the hub shell with no
  duplicate hub-level hero.
- Gates green; unit tests added for any new pure logic.
- PR opened as draft with the fidelity checklist filled in.
