# Dashboard v2 — the Compounding Command Center

How the command center is optimized so **every session builds on the last**. Per
decisions: combine **continuity + lifecycle progression + live automation**, in a
**focused resume-hero atop a dense panel grid**, **stage- + behavior-aware**, with
the AI team's autonomous work surfaced **prominently**.

## The compounding thesis

A command center compounds when it (1) **resumes** context instead of starting
cold, (2) makes the **AI team's between-session work visible** (leverage you
didn't spend effort on), (3) pushes a **decisive next move** (execution compounds,
browsing doesn't), and (4) shows **deltas** so progress is _felt_, not just
displayed. Momentum (streaks, readiness↑) + lifecycle gates turn that into a loop.

## Layout (top → bottom)

### 1. Resume Hero — focused zone (continuity + momentum + next move)

- **Greeting + state:** "Welcome back, {name}" · current **lifecycle stage** chip
  · **Day {streak}** · "Last here {relative time}".
- **"Since you were away"** (PROMINENT band): what the 15-agent team advanced
  autonomously — diligence runs completed, drafts/memos ready, new matches,
  ingested docs — each with a count + deep link. Leverage made felt.
- **Momentum deltas:** Readiness {score} **(+Δ this week)** · Execution **(+Δ)** ·
  Raise progress **(+Δ)**. Always show the _change_, not just the value.
- **The next move:** one prominent next-best-action CTA + 2 alternates
  (behavior-aware — see Adaptivity). Acting advances the lifecycle.

### 2. Lifecycle progression strip

The 7-stage loop (Establish Truth → … → Prove) with current stage lit, the **gate
to the next stage**, and **what unlocks it** ("Proof of Concept complete → LP
outreach unlocks"). Gamified — compounds the journey.

### 3. Dense command grid (BlackRock-style panels, drill-in)

Below the hero — scan-at-a-glance, each panel a real surface: **Major Alerts** ·
**Capital/raise** (RaiseProgressBar) · **LP Pipeline** · **Deal/Diligence** ·
**Live Automation Feed** (the team working, streaming) · **Knowledge/Intelligence**.
Panels reorder by engagement (Adaptivity).

## Adaptivity (stage + behavior aware)

- **Stage-aware:** hero KPIs + which panels lead change by lifecycle stage + member type.
- **Behavior-aware (the compounding part):** dismissed actions stop resurfacing;
  acted-on action _types_ get prioritized; panels the operator opens float up.
  Requires lightweight interaction tracking (see data needs).

## Data needs (what compounding requires that we don't have yet)

- **Momentum deltas** → periodic **dashboard snapshots** (readiness/execution/
  raise per org per day) to diff against. _(Codex: `dashboard_snapshots` + daily
  upsert; Claude reads + diffs.)_
- **"Since you were away"** → a **last-seen** timestamp per user
  (`profiles.dashboard_seen_at` or a cookie seam) + filter `activityFeed` to
  changes since. _(Claude: cookie seam now; Codex: column for durability.)_
- **Behavior-aware ranking** → an **action-interaction log** (dismissed/acted, by
  action type). _(Codex: `dashboard_action_events`; Claude: rank/filter in
  `getDashboardData`.)_

## Agent split

- **Codex (data):** `dashboard_snapshots` (+ daily upsert RPC),
  `dashboard_action_events`, `profiles.dashboard_seen_at`. RLS org/member-scoped.
- **Claude (logic):** extend `getDashboardData` → `momentumDeltas`,
  `sinceYouWereAway[]`, behavior-aware `nextBestAction`/panel order; the last-seen
  + interaction write hooks (server actions).
- **Emergent (UI):** resume hero, "since you were away" band, lifecycle strip,
  dense panel grid + drill-ins, behavior-aware reordering. Tokens-only; solid
  `bg-bg-1`; voice "Chief Operating Officer · your live AI guide".

## Build order

1. **Claude-now (no new tables):** `sinceYouWereAway` (cookie last-seen +
   activityFeed) + a momentum-delta seam (degrades to no-Δ until snapshots exist).
2. **Codex:** snapshots + action-events + `dashboard_seen_at`.
3. **Claude:** wire deltas + behavior-aware ranking onto Codex's data.
4. **Emergent:** Dashboard v2 UI binding the extended loader.

_Encodes the Jun-7 dashboard-optimization decisions._
