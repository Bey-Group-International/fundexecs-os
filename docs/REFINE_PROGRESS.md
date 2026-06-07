# Side-Rail Refinement Campaign — Progress & Review Log

> Autonomous campaign: one rail area refined per ~30 min until the user returns.
> Each entry records **what was OLD** (before) and **what is NEW** (after), with
> the PR link. This file is the running record for team review; a polished `.docx`
> can be exported from it on request (`pandoc docs/REFINE_PROGRESS.md -o review.docx`).

**Cadence note:** `CronCreate`/`ScheduleWakeup` aren't available in this
environment, so the 30-min interval is driven by a background timer + PR-event
wakes (self-paced), not a true cron.

**Standing guardrails (every entry):** one branch per area
(`claude/refine-<area>`), draft PR, CI green (format/typecheck/lint/build),
CodeRabbit-clean, then squash-merge (user away). UI + additive reads only — no
migrations, auth, `lib/supabase` client, `proxy.ts`, middleware, or `app/login`
changes. Tokens-only; 15 brain slugs stable; Admin in Settings; no lockfiles.

---

## Sequencing gate (must finish before area work starts)

| Item                                   | Branch / PR                  | Status                   |
| -------------------------------------- | ---------------------------- | ------------------------ |
| Gamification refinement                | `claude/gamification-refine` | ✅ merged (#102)         |
| Account menu                           | `claude/account-menu`        | ✅ merged (#101)         |
| Replace rail brand **F → Earn avatar** | `claude/earn-avatar`         | ⏳ this PR (avatar swap) |

---

## Area checklist (one per iteration, in order)

| #   | Area              | Routes / components                                            | Status     | PR   |
| --- | ----------------- | -------------------------------------------------------------- | ---------- | ---- |
| 1   | Earn modal        | `components/shell/earn/*`                                      | ⬜ pending | —    |
| 2   | Source of Truth   | `/profile`, `/trust`, `components/fund-profile/*`              | ⬜ pending | —    |
| 3   | Daily Execution   | `/command-center`, `/action-queue`, `/match-inbox`             | ⬜ pending | —    |
| 4   | Capital Formation | `/pipeline`, `/capital-stack`, `/objections`                   | ✅ merged  | #104 |
| 5   | Deal Execution    | `/deal-desk`, `/ic-memos`, `/governance`                       | ✅ merged  | #103 |
| 6   | Intelligence      | `/inbox-intelligence`, `/knowledge`, `/materials`, `/partners` | ✅ merged  | #105 |
| 7   | Audit             | `/trust`, `/audit`                                             | ⬜ pending | —    |
| 8   | Profile account   | account menu + `/settings`                                     | ⬜ pending | —    |
| 9   | Dashboard         | `/command-center` `LifecycleDashboard`                         | ⬜ pending | —    |

---

## Entries (OLD → NEW)

### [0] Rail brand: F → Earn avatar (+ live flags) — 2026-06-07 — PR #earn-avatar

**OLD:** The side-rail brand mark was a flat gold rounded-square showing the
letter **"F"**. Rail nav still flagged `/objections` and `/inbox-intelligence`
as "SOON" even though their UIs shipped in the swarm (#104 / #105).
**NEW:** Brand mark is now the real **Earn coin** (`<EarnCoin size={30} />`,
`public/earn-coin.png` on a white disc) — the OS now wears Earn's face, gold
still reserved for Earn. Flipped `/objections` and `/inbox-intelligence` to
`live: true` so the rail no longer shows a "Soon" pill on shipped surfaces;
`/materials` stays SOON (preview only).
**Files:** `components/shell/Wave1SideRail.tsx`, `components/shell/rail-nav.ts`.
**Checks:** tsc/lint/format/build ✓ · CodeRabbit pending.

### Swarm convergence (areas 4–6) — 2026-06-07

The 5-wide refinement swarm landed three area passes ahead of the serial
campaign; logged here for the team record (full OLD→NEW in each PR body):

- **Capital Formation** (#104) — capital-stack tone accents + LP-type donut;
  pipeline `Intl` currency + React-Compiler derived state; **Objections** built
  from a ComingSoon stub into a full triage module over existing RPCs.
- **Deal Execution** (#103) — real `/deal-desk`, `/ic-memos`, `/governance`
  surfaces; tokenized CTA gradient; compact-USD rollover fix; parallel fetches.
- **Intelligence** (#105) — real `/inbox-intelligence`, `/knowledge`,
  `/materials`, `/partners` surfaces; `getMemberByFirstName` roster helper.

<!-- Template per entry:
### [N] <Area> — <date> — PR #<n>
**OLD:** <what it was / problems>
**NEW:** <what changed: functionality + visual + perf>
**Files:** <key files>
**Checks:** tsc/lint/format/build ✓ · CodeRabbit ✓
-->
