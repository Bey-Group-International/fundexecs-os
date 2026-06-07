# Claude — Gamification refinement: bold, dynamic, productively addictive

**North star.** The gamified layer should feel **bold and dimensional, never flat**,
and be **productively addictive** — it pulls the operator back to do real,
on-the-record work, not to chase vanity. Every reward maps to a verified outcome.

**Context.** Live gamification primitives today: `ExecutionScoreCard`
(score, four Chain-of-Trust layers, XP, level, `streak: 0` seam), `ReadinessGauge`
(`readinessScore` + per-dimension `readinessBreakdown`), `ChainOfTrustStrip`,
`AgentTeamStrip` (#95), `MomentumCard`, `Sparkline`. The deeper
`xp_events`/`achievements`/`quests` backend is **Phase 2** (queued for Codex, not
built yet). **Decision:** refine the live surfaces now AND **scaffold the
badges/quests UI against typed placeholder data** so it lights up the instant
Phase 2 lands.

## Design principles (binding)

- **Bold/dynamic, not flat:** depth (gradients, elevation, `--shadow-cta`), glow,
  animated rings/bars, count-up numbers. **Gold is reserved for XP / achievements /
  Earn** — don't spread it.
- **Productively addictive, honestly:** grace-period streaks (never shame), XP only
  for verified actions, transparent rules, milestone moments tied to real progress.
  **Hard NO:** shame-leaderboards, pressure streaks, hidden/volume-based rewards,
  dark patterns, confetti spam.
- **All four "addictive" mechanics + all four visual treatments are in scope**
  (per product call): streaks+daily-loop, drive-to-100% readiness, XP/level
  progression, milestone celebrations × depth+glow, motion+count-ups,
  radar+ring gauges, dynamic exec team.

## Work items

### A. Execution Score — bold ring, not flat bars

- Recast `ExecutionScoreCard` around an **animated ring gauge** for the 0–100
  score (SVG arc, count-up, gold→azure depth), with the four Chain-of-Trust layers
  as **ring segments or mini-rings** rather than flat bars. Elevation + subtle glow.
- Keep the existing data contract (`ExecutionScore`). Reduced-motion: static ring.

### B. Institutional Readiness — "Drive to 100%" graph

- Make `ReadinessGauge` **open a detail view** (drawer or modal on click/Enter)
  showing a **radar/spider chart** over `readinessBreakdown` dimensions
  (profile / proof / materials / pipeline / capital) with each dimension's score
  vs 100, the **gap**, and the **specific next action** to raise it (reuse the
  loader's action heuristics or a per-dimension hint map — UI-side, no schema).
- Headline framing: "**N points to institutional-ready**" with the weakest 1–2
  dimensions called out as the recommended focus. This is the core compounding loop.

### C. XP / Level progression

- Prominent **XP-to-next-level** progress (animated bar/ring) with the level badge;
  a satisfying **level-up moment** when it advances (see E). Derive next-level
  threshold from the existing level/XP (UI-side curve; document it).

### D. Streaks + daily loop — light the seam

- Light the `ExecutionScore.streak` seam **without a migration**: derive a
  consecutive-active-day streak in the dashboard loader from **existing
  `trust_events` activity** (distinct UTC active days, 1-day grace). Surface it
  boldly (flame + count, "personal best"). Keep the change to an **additive read**
  in `lib/queries/dashboard/lifecycle.ts`; **no schema, no Phase 2 tables.**
- Tie the **daily loop**: a completion ring over the Daily Command check-offs
  (the `done` count already shipped in #95).

### E. Milestone celebrations

- Tasteful, reduced-motion-safe celebration moments for level-up, new streak high,
  and badge earned — a refined toast/burst (reuse `TrustToaster` if present;
  otherwise a small shared `CelebrationToast`). No confetti spam; one moment, then
  it settles.

### F. Achievements + Quests UI — scaffold for Phase 2

- Build the components now against a **typed placeholder loader**
  (`lib/queries/gamification.ts` exporting `getAchievements(orgId)` /
  `getQuests(orgId)` that return the proposal's 5 launch badges + 3 launch quests
  shape with a `.catch(() => empty)` fallback — clearly placeholder).
- Components: an **AchievementGrid** (earned vs locked, gold for earned, progress
  for in-flight) and **QuestProgressCard** (ordered steps, reward XP). Mount them on
  a sensible surface (a `/trust` or dashboard "Progress" section — propose the
  cleanest placement). They render an honest empty/placeholder state until Phase 2.
- Document the exact loader contract so the Phase 2 wiring is a drop-in.

### G. Dynamic Executive Team

- Upgrade `AgentTeamStrip` from a flat row into a **living team panel**: per-agent
  **live activity / last action** (derive from the activity feed + routed signals;
  fall back to the stage status), animated **on-point pulse**, richer **animated
  gradient avatars**, and hover/expand for detail. The 15 should feel like a desk
  at work, not a static legend. Keep Earn (gold) leading.

## Guardrails

- **Scope:** UI + **one additive read** in the dashboard loader (streak derivation
  only). **No** migrations, **no** Phase 2 tables, **no** auth/`lib/supabase`/
  `proxy.ts`/middleware/`app/login` changes. Scaffold loaders are placeholder-only
  (no new queries against non-existent tables).
- Tokens-only; solid `bg-bg-1` overlays; reuse `--cta-gradient`/`--shadow-cta`;
  gold reserved. Keep the **15 brain slugs** stable; **Admin in Settings**.
- **a11y:** gauges/rings/radar carry `aria-label` summaries; the readiness detail
  opens via keyboard and traps/restores focus; celebrations respect
  `prefers-reduced-motion`. **Mobile (390×844):** rings/radar/strip reflow, no
  overflow, tap targets ≥44px.
- No `yarn.lock`/`pnpm-lock.yaml`, no auth-bypass files.

## Deliverables

- Refined `ExecutionScoreCard`, `ReadinessGauge` (+ readiness detail view),
  XP/level progression, lit streak, celebration moments, dynamic `AgentTeamStrip`.
- New scaffolds: `lib/queries/gamification.ts` (placeholder), `AchievementGrid`,
  `QuestProgressCard`, shared celebration component, any small SVG ring/radar
  primitives (dependency-free, like `Sparkline`).
- Branch `claude/gamification-refine`, **draft PR**, CI green
  (`format:check && typecheck && lint && build`), before/after notes + a
  reduced-motion + mobile check. Stop for review.
