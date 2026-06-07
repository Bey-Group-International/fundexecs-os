# Claude Execution Prompt — Gamified Capital Market Intelligence Layer

> Paste this into Claude's session (or use as a build brief). The full proposal
> is at `/app/memory/INTELLIGENCE_LAYER_PROPOSAL.md`. Read it first.

## Context you already have on `main`

- Wave-1 shell merged at `bf09f1f` (rail / dashboard / fund profile / earn dock / settings)
- Wave-1 finishing pass on `emergent/wave1-finish` @ `a0223b5` (drawer wrap, copy nudge, mobile sweep, a11y axe)
- 15 specialists in `lib/team/roster.ts` stable
- Earn AI tooling: `lib/ai/{brains,earn,profile-suggest,trust-validate,voyage}.ts`
- RAG infra: `knowledge_documents` + `knowledge_chunks` (vector 1024) + `match_knowledge_chunks()` RPC
- Loaders: `getDashboardData`, `getFundProfile`, `getCreditWallet` (read-only contract you defined in PR #81)
- Rail: 6-area logic groups; 11 stubs await UI; `EarnContextKind: 'intelligence'` already wired
- Existing XP: `profiles.xp` + `trust_xp_award()` RPC; streak is a declared seam

## Decisions the user already made

| Q   | Decision                                                   | Implication for build                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | **(b) EDGAR Form D + Form ADV** at launch                  | Two adapters: `lib/ingestion/edgar/form-d.ts` and `lib/ingestion/edgar/form-adv.ts`. Both free. Firecrawl/Finnhub deferred to a later sprint, not in scope.                                                                                                   |
| Q2  | **(c+) firm + individual_investor + service_provider**     | 3 persona-aware copy lanes from launch. Startup + Student get the layer in a follow-up. `signal_matches.match_reason` should encode persona-relevant scoring (e.g. SP gets demand-side fit signals, firm/individual get raise + thesis-fit signals).          |
| Q3  | **(a) Full gamification stack**                            | All migrations land: `xp_events`, `achievements`, `achievements_earned`, `quests`, `quests_progress`. 5 launch badges + 3 launch quests seeded. Streak derivation wired.                                                                                      |
| Q4  | **(a) Vercel Cron, 15-min poll on EDGAR RSS**              | `app/api/cron/edgar-poll/route.ts` with Vercel cron config. No paid webhook dependency.                                                                                                                                                                       |
| Q5  | **(a) Full Wave-2 sprint — all 4 phases**                  | Execute Phases 1→2→3→4 sequentially. Draft PR per phase, STOP for review between phases. ~13–19 hours of work, 4 PRs.                                                                                                                                         |
| Q6  | **(a) Signals contribute to Chain-of-Trust Concept layer** | Acting on a signal writes to `trust_events` AND increments Concept-layer completion on the related `chain_of_trust_records` row. Compounds the moat.                                                                                                          |
| Q7  | **(a) Strict anti-patterns**                               | NO leaderboards. NO pressure streaks (1-day grace minimum). NO hidden rewards (rule_json must be human-readable). NO volume-based badges (every badge tied to a verified outcome). All XP grants server-side under RLS with `source_table`+`source_id` audit. |

## Three implementation notes flagged during scoping (Claude's call to resolve)

1. **Add `org_id` to `xp_events`** — every other XP/audit row in the schema carries `org_id` for direct RLS. Without it, RLS would need to JOIN through `org_members`. Recommendation: add `org_id uuid references organizations on delete cascade` to `xp_events` in the Phase 2 migration. Same for `achievements_earned` if it doesn't already carry it transitively.

2. **`achievements.id text` / `quests.id text` (slug pattern)** — works for seeded items; would block user-defined achievements later. Consistent with `lib/team/roster.ts` slug style. Keep as-is unless user-defined achievements become a near-term feature.

3. **Streak storage strategy** — proposal derives streak from `xp_events.awarded_at` via SQL window function on every dashboard load. Recommended optimization: denormalize onto `profiles.{current_streak integer, streak_updated_at timestamptz}` updated by a trigger or the `award_xp` server action. Saves a window query on every `getDashboardData` call.

## What to build

Per the **phased delivery** in `INTELLIGENCE_LAYER_PROPOSAL.md` §7. Default
sequence (unless user overrides):

### Phase 1 — `/inbox-intelligence` MVP

- Vercel cron job (or Supabase scheduled function) polls SEC EDGAR Form D RSS every 15 min
- `market_signals` migration (see proposal §4) + RLS
- `lib/queries/intelligence.ts` exports `getSignalFeed(orgId)` and `getSignalMatches(orgId)` with the same `.catch(() => null)` resilience pattern as Wave-1 loaders
- `app/inbox-intelligence/page.tsx` — replaces the stub; renders feed grouped by kind, routed-to specialist visible, accept/dismiss/snooze actions
- Sub-components: `InboxIntelligenceFeed`, `SignalCard`, `SignalFilterRail`, `SignalMatchScore`
- Rail badge wiring in `lib/dashboard-rail-signals.ts` — `/inbox-intelligence` gets the `new-signals` count
- Earn dock `kind: 'intelligence'` quick actions pull from active queue ("Triage 3 new Form D matches", "Brief me on this week's filings")
- Specialist routing: Form D → Eleanor; Form ADV → Adrian; press-releases → Noah; ownership → Marcus

### Phase 2 — Gamification

- Migrations: `xp_events`, `achievements`, `achievements_earned`, `quests`, `quests_progress` (proposal §4)
- Seed 5 launch achievements + 3 launch quests
- `lib/actions/xp-events.ts` extends `xp.ts` — server-side XP grants only, every event tied to a `source_table` + `source_id` for audit
- Streak derivation SQL function `derive_streak(actor_id, window_days)` — wired into `ExecutionScore.streak`
- `TrustToaster` extension: achievement-earned toast + Earn briefing weave-in
- Audit trace: every XP grant + achievement earned writes to `trust_events` too

### Phase 3 — Extended sources

- Add Form ADV (Schedule D) ingestion
- Firecrawl integration for press releases (only if user picks "extended sources" in Q1)
- `/match-inbox` route lights up
- Richer match scoring: SQL function `match_signal_to_lp(signal_id, org_id)` returning score 0-100

### Phase 4 — Trust + analytics

- Signal evidence attaches to Chain-of-Trust Concept layer
- `/audit` route shows xp_events + achievements_earned trace
- Optional: light up `/knowledge` for signal embeddings

## Hard guardrails (binding)

- Additive migrations only — never alter or drop existing tables
- RLS on every new table; ingestion uses service role; clients never grant XP
- No touches to `lib/team/roster.ts` (15 brain slugs stable)
- No touches to `lib/supabase/*`, `lib/queries/auth.ts`, `middleware.ts`, `proxy.ts`, `app/login/*`
- Tokens-only styling; reuse `--cta-gradient`, `--shadow-cta`; solid `bg-bg-1` overlays
- Voice: "Chief Operating Officer · your live AI guide" + "on the record / audit-ready / documented as it forms"
- Specialist roster names exact (Eleanor / Marcus / Priya / Adrian / Dalia / Noah for signal-owning roles)
- NO leaderboards-that-shame, NO pressure streaks (always grace periods), NO hidden rewards, NO volume-based badges
- All XP / achievement / quest evaluation server-side; client only reads
- Standard PR discipline: branch off latest `main`, draft PR, CI green (`tsc --noEmit` + `lint` + `format:check` + `build`), screenshots, prop/type contracts in PR body

## Verification before merge

- Manual: log in as `test+investment_firm@fundexecs-staging.dev`, see at least 3 Form D signals in `/inbox-intelligence`, accept one, see XP grant, see badge progress
- Automated: e1_tester binary checks on rail badge, signal feed render, accept action persists, no console errors
- Backend: every XP grant has a matching `trust_events` row; every achievement_earned has `evidence` jsonb populated; no RLS bypass

## File map for new code (proposed)

```
supabase/migrations/2026MMDD_market_signals.sql
supabase/migrations/2026MMDD_xp_events_achievements.sql
supabase/migrations/2026MMDD_quests.sql
lib/queries/intelligence.ts
lib/actions/xp-events.ts
lib/actions/signal-matches.ts
lib/ingestion/edgar/form-d.ts
lib/ingestion/edgar/form-adv.ts
app/api/cron/edgar-poll/route.ts          (Vercel cron)
app/inbox-intelligence/page.tsx
app/inbox-intelligence/InboxIntelligenceView.tsx
components/intelligence/InboxIntelligenceFeed.tsx
components/intelligence/SignalCard.tsx
components/intelligence/SignalFilterRail.tsx
components/intelligence/SignalMatchScore.tsx
components/intelligence/AchievementToast.tsx
components/intelligence/QuestProgressCard.tsx
```

## Stop checkpoint

After Phase 1 ships: open draft PR, do NOT proceed to Phase 2 until user reviews.
Each subsequent phase: same draft-PR-and-stop discipline.
