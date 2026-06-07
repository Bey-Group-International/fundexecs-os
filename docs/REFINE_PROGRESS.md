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
| 1   | Earn modal        | `components/shell/earn/*`                                      | ✅ merged  | #107 |
| 2   | Source of Truth   | `/profile`, `/trust`, `components/fund-profile/*`              | ✅ merged  | #108 |
| 3   | Daily Execution   | `/command-center`, `/action-queue`, `/match-inbox`             | ✅ merged  | #110 |
| 4   | Capital Formation | `/pipeline`, `/capital-stack`, `/objections`                   | ✅ merged  | #104 |
| 5   | Deal Execution    | `/deal-desk`, `/ic-memos`, `/governance`                       | ✅ merged  | #103 |
| 6   | Intelligence      | `/inbox-intelligence`, `/knowledge`, `/materials`, `/partners` | ✅ merged  | #105 |
| 7   | Audit             | `/trust`, `/audit`                                             | ✅ merged  | #111 |
| 8   | Profile account   | account menu + `/settings`                                     | ⏳ PR #112 | #112 |
| 9   | Dashboard         | `/command-center` `LifecycleDashboard`                         | ⬜ pending | —    |

---

## Entries (OLD → NEW)

### [5] Profile account — 2026-06-07 — PR #112

**OLD:** The account menu shipped in #101, so the surface here is `/settings`.
Its gamification header showed **hardcoded** `LEVEL = 7` / `XP = 4820` and a
static list of "earned" trust statuses — fake progress on a real account page,
and inconsistent with the dashboard's real gamification.
**NEW (functionality / honesty):** the header now uses the operator's **real**
`level` + `xp` (from `profiles.xp` via `getShellIdentity`, already loaded by the
page) — the level badge, XP figure, and progress bar reflect actual standing,
and the bar uses the same level curve `getShellIdentity` derives `level` from so
badge and bar always agree. Trust-status chips derive from the real
Proof-of-Truth completion (`proofStatus`/`proofPct`); the two milestones with no
signal yet ("Capital Matched", "Institutional Grade") render as honest not-yet
aspirations instead of hardcoded.
**Scope:** additive reads only (reuses `identity` + `memberProfile`, no new
loaders); tokens-only; no auth/migration changes.
**Files:** `app/settings/SettingsView.tsx`, `app/settings/page.tsx`.
**Checks:** tsc/lint/format ✓ · build via CI · CodeRabbit pending.

### [4] Audit — 2026-06-07 — PR #111

**OLD:** `/trust` redirects into the dashboard, so the live Audit surface is
`/audit` (the Memory Audit Trail). Filtering used flat segmented text tabs with
no sense of volume, and the list filtered through a manual `useMemo`.
**NEW (visual, bold not flat):** the flat tabs become a **KPI filter strip** — an
"All events" overview card plus one per kind (Chain of Trust / Admin /
Diligence), each showing its **live count**, a tone icon disc + left accent rail,
and an active inset ring. Overview and filter in one control.
**NEW (perf/correctness):** manual `useMemo` filtering → plain derived state
(React-Compiler preference, matching the swarm PRs); per-kind counts derive from
the full dataset so the strip always reflects everything. Timeline rows, day
grouping, search, and expand behavior unchanged; tone surfaces render via #109.
**Files:** `components/audit/AuditView.tsx`.
**Checks:** tsc/lint/format/build ✓ · CodeRabbit ✓ (no actionable comments).

### [3] Daily Execution — 2026-06-07 — PR #110

**OLD:** `/command-center` is the Dashboard area and `/action-queue` redirects to
`/notifications`, so the live Daily-Execution surface is the **Match Inbox**. Its
triage cards read flat: the 0–100 score sat in a small disc with no plain meaning,
the card had no tonal hierarchy, and the subject showed as a bare truncated UUID
with a trailing ellipsis.
**NEW (visual, bold not flat):** every triage card gains a **score-tone left
accent rail** (green / azure / amber / muted) so the inbox scans by fit at a
glance; the score disc wears the same tone.
**NEW (functionality / clarity):** a single `scoreMeta()` drives the accent, the
kind-badge tone, the disc, and a new plain-language quality word ("Strong fit",
"Solid fit", "Worth a look", "Long shot") — the number finally means something.
The subject reads as a labeled **"Ref &lt;id&gt;"** instead of a bare mono string.
**NEW (correctness):** folded the redundant `scoreTone` helper into `scoreMeta`;
optimistic accept/dismiss + `act_on_match` wiring unchanged.
**Files:** `components/match-inbox/MatchInboxView.tsx`.
**Checks:** tsc/lint/format/build ✓ · CodeRabbit ✓ (no actionable comments).

### Spec sweep: semantic tokens — 2026-06-07 — PR #109 ✅ merged

**OLD:** `--success/-warning/-danger/-info` **soft/line** tokens were referenced
~100× (badges, action buttons, status chips) but **never defined** in
`globals.css` — only gold/azure/accent had them — so those surfaces rendered with
transparent fills/borders (the recurring "flat" defect).
**NEW:** defined all eight at the source (soft 0.12, line 0.30 off each base
tone). Purely additive CSS vars; every existing usage now shows its intended tint.
**Files:** `app/globals.css`.

### [2] Source of Truth — 2026-06-07 — PR #108

**OLD:** `/trust` redirects into the dashboard hero (owned by the Dashboard
area), so the real surface here is the **Fund Profile**. Its six LP-probed
section cards rendered empty fields as **dead text** — an operator looking at the
canonical record couldn't act on a missing thesis / terms / team from the page
itself; only the separate Gaps card linked anywhere. No per-section status, so
the record wasn't scannable.
**NEW (functionality):** every **empty** section card — and the empty team
state — is now a link into the profile builder (`/onboarding`) with a hover
lift, matching the Gaps card. Present sections stay read-mostly.
**NEW (visual, bold not flat):** each section carries an **"On record" / "Add"**
status chip (shared `Badge`) so the Source of Truth is scannable at a glance;
empty cards get a warning-tinted icon disc + an "Add the team" affordance.
**NEW (correctness):** chips use the shared `Badge` instead of the undefined
`--*-soft` CSS vars (those live only in the un-imported design-reference sheet);
empty icon disc uses the defined `--warning` token like the Gaps card. Fixed a
stale "Eleanor" voice reference in the Hero doc comment.
**Files:** `components/fund-profile/FundProfileSections.tsx`,
`components/fund-profile/FundProfileHero.tsx`.
**Checks:** tsc/lint/format/build ✓ · CodeRabbit ✓ (no actionable comments).

### [1] Earn modal — 2026-06-07 — PR #107

**OLD:** The Earn dock's "Here's what I can do right now" quick-action chips and
the specialist rows were **dead** — the dock's own comment promised they
"pre-seed the EarnChat input", but nothing connected them to `EarnChat`, which
owned its input state internally. Tapping a chip did nothing; selecting a
specialist only revealed a one-liner. The dock also read fairly flat.
**NEW (functionality):** `EarnChat` exposes an imperative `seed(text)` handle
(`forwardRef` + `useImperativeHandle`); `EarnDock` holds a chat ref and seeds it
from (a) every quick-action chip and (b) a new **"Ask &lt;name&gt; to step in"**
button on the active specialist. Seeding fills + focuses the input (caret at end)
and does **not** auto-send, so the operator edits before firing. `/api/ask-earn`
chat path untouched.
**NEW (visual, bold not flat):** gold top-accent bar on the dock; chips gain a
gold hover/focus surface, gold icon tint on hover, and a sliding arrow; the
specialist CTA is gold.
**NEW (perf/correctness):** no `setState`-in-effect (React-Compiler lint clean);
seeding runs in the click handler. Standalone `/ask-earn` usage unaffected.
**Files:** `components/shell/earn/EarnDock.tsx`, `app/ask-earn/EarnChat.tsx`.
**Checks:** tsc/lint/format/build ✓ · CodeRabbit ✓ (no actionable comments).

### [0] Rail brand: F → Earn avatar (+ live flags) — 2026-06-07 — PR #106 ✅ merged

**OLD:** The side-rail brand mark was a flat gold rounded-square showing the
letter **"F"**. Rail nav still flagged `/objections` and `/inbox-intelligence`
as "SOON" even though their UIs shipped in the swarm (#104 / #105).
**NEW:** Brand mark is now the real **Earn coin** (`<EarnCoin size={30} />`,
`public/earn-coin.png` on a white disc) — the OS now wears Earn's face, gold
still reserved for Earn. Flipped `/objections` and `/inbox-intelligence` to
`live: true` so the rail no longer shows a "Soon" pill on shipped surfaces;
`/materials` stays SOON (preview only).
**Files:** `components/shell/Wave1SideRail.tsx`, `components/shell/rail-nav.ts`.
**Checks:** tsc/lint/format/build ✓ · CodeRabbit ✓ (no actionable comments).

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
