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

| Item                                   | Branch / PR                  | Status                       |
| -------------------------------------- | ---------------------------- | ---------------------------- |
| Gamification refinement                | `claude/gamification-refine` | ⏳ agent running             |
| Account menu                           | `claude/account-menu`        | ⏳ agent running             |
| Replace rail brand **F → Earn avatar** | `claude/earn-avatar`         | ⬜ after account-menu merges |

---

## Area checklist (one per iteration, in order)

| #   | Area              | Routes / components                                            | Status     | PR  |
| --- | ----------------- | -------------------------------------------------------------- | ---------- | --- |
| 1   | Earn modal        | `components/shell/earn/*`                                      | ⬜ pending | —   |
| 2   | Source of Truth   | `/profile`, `/trust`, `components/fund-profile/*`              | ⬜ pending | —   |
| 3   | Daily Execution   | `/command-center`, `/action-queue`, `/match-inbox`             | ⬜ pending | —   |
| 4   | Capital Formation | `/pipeline`, `/capital-stack`, `/objections`                   | ⬜ pending | —   |
| 5   | Deal Execution    | `/deal-desk`, `/ic-memos`, `/governance`                       | ⬜ pending | —   |
| 6   | Intelligence      | `/inbox-intelligence`, `/knowledge`, `/materials`, `/partners` | ⬜ pending | —   |
| 7   | Audit             | `/trust`, `/audit`                                             | ⬜ pending | —   |
| 8   | Profile account   | account menu + `/settings`                                     | ⬜ pending | —   |
| 9   | Dashboard         | `/command-center` `LifecycleDashboard`                         | ⬜ pending | —   |

---

## Entries (OLD → NEW)

_None yet — first entry lands once the sequencing gate clears._

<!-- Template per entry:
### [N] <Area> — <date> — PR #<n>
**OLD:** <what it was / problems>
**NEW:** <what changed: functionality + visual + perf>
**Files:** <key files>
**Checks:** tsc/lint/format/build ✓ · CodeRabbit ✓
-->
