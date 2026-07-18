# Priority-1 Deal Skills + Session-Attached Runner + Evidence UI

**Status:** Landed, additive. Three new governed skills, a safe session-attached
runner that surfaces skill output through the existing artifact system, and a
"Skills at work" evidence panel on the session page.
**Built in parallel** (three backend subagents, one per skill), then integrated +
verified centrally.

---

## 1. Three new deal skills (backend, deterministic)

All follow the `screen-deal` template: a versioned package under `/skills/<id>/`
(SKILL.md, skill.yaml, policy.yaml, evaluation.yaml, JSON schemas, example) + a
TypeScript `SkillDefinition` with a **pure deterministic core**, registered in
`lib/skills/registry.ts`. None invents financial values — missing inputs are
flagged, assumptions/calculations are labelled and separated in `sources`.

| Skill | Executives | What it does | Never |
|---|---|---|---|
| `returns` | Analyst · IC | First-pass LBO: entry/exit EV, equity, MOIC, IRR, bear/base/bull sensitivities | fabricates a figure — MOIC/IRR are null unless `entryEbitda` + `entryMultiple` present; defaults (hold 5y, exit=entry, CAGR 0, flat debt) are labelled assumptions |
| `dd-checklist` | Diligence | 16-workstream diligence request list, rule-tailored by sector / carve-out / regulation | sends anything — it *prepares* the list (Tier-2 send is prohibited) |
| `ic-memo` | IC | Assembles a 12-section IC pre-read from structured deal data (screen + returns) | *decides* — the recommendation is advisory; missing data becomes an open item, not a fabricated fact |

Together with `screen-deal`, these cover the §22 acceptance chain: **teaser →
screen → returns → diligence checklist → IC pre-read**.

## 2. Skill↔engine wiring — the safe realization

The requested wiring is "skills run in a workflow, reuse existing UI." An audit
found a blocker for a naive mid-loop auto-trigger: the `mandates` table stores
`goal`/`auto_approve`, **not** structured screening criteria, and a workflow has
no structured deal fields mid-run — so auto-invoking a skill in
`executeWorkflow` would have to run it on **fabricated input**, violating "never
invent financial values." So instead of a blind edit to the sacred loop:

- **`lib/skills/engine-bridge.ts`** — pure, tested `detectSkillForStep(title,
  description)` maps a planned step to a registered skill id (or null). This is
  the seam the engine will use once steps carry structured input (planner
  step-tagging + mandate-criteria/deal-field plumbing — the documented next
  phase).
- **`lib/skills/session-run.ts` `runSkillAttached`** — runs a skill with
  **explicit structured input** inside a session/workflow and writes its output
  as a normal `artifacts` row (so it renders wherever artifacts already do) plus
  a `skill_runs` row, both linked to the session + workflow, and emits an
  `artifact.created` event. This is the safe, tested "wiring": skills are
  operational inside a workflow and surface through the existing UI, and they
  only ever run on real input.
- **`app/(app)/sessions/skill-actions.ts` `runSkillInSession`** — the server-side
  entry point (org-scoped, executive-permission-checked) a UI form or API can
  call to run a skill in a session.

No `lib/engine.ts` change in this increment — mid-loop auto-invocation is
deferred until it can run on real structured input and be validated against a
live environment.

## 3. Session-evidence UI ("Skills at work")

`components/session/SkillRunFeed.tsx` (mirrors the existing `BrainFeed`), mounted
on `app/(app)/session/[id]/page.tsx`. For each `skill_run` it shows the skill +
executive, status, the **gate tier** its follow-on needs, confidence/completeness,
the **provenance breakdown** (facts vs assumptions vs calculations vs generated),
and any flagged missing data — visible, testable proof that a governed skill ran
and produced a provenanced result, not just text. Read-only; fed by
`listSkillRunsForSession` (best-effort, empty on error).

## 4. Artifact formats — phased (per your call)

- **Phase 1 (this increment):** a skill's output is persisted as a normal
  `artifacts` row (markdown body: narrative + structured JSON + provenance +
  flagged-missing), so it flows through the existing artifact rendering,
  verification, and export paths with no new dependency.
- **Phase 2 (next):** a backend render module (markdown → DOCX for IC memos /
  reports, behind a flag, adding the `docx` dependency), then PDF/PPTX. Kept out
  of this PR to avoid a user-facing dependency change before you've scoped it.

## 5. Verification

62 new tests (returns 8, dd-checklist 13, ic-memo 14, engine-bridge 8, catalog
consistency across all 4 skills, plus store/runner coverage). Full suite **3139
green**, typecheck + eslint clean. The session page + evidence component compile
and lint; the live session render was not exercised (no local Supabase/app), so
that surface is additive-and-typed but not run-verified.
