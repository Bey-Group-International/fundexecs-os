# Gamified Capital Market Intelligence Layer — Proposal

> **Status:** Scoping document. Synthesized from 3 web research passes + full
> repo inventory at HEAD = post-Wave-1-finish. UI-only or full-stack scope TBD
> by user. No code written yet. Claude will execute per
> `/app/memory/CLAUDE_INTELLIGENCE_PROMPT.md` after user answers Q1-Q7.

## 1. What this layer is

A real-time intelligence + gamification surface that turns ambient capital-market
signals (Form D filings, fund formations, news, market events) into:

- **Actionable nudges** for each operator (member-type aware)
- **XP / streak / badge / quest progression** for verified actions on those signals
- **Earn / specialist routed insight** (Eleanor for LP signals, Marcus for deal
  signals, Priya for capital-markets signals, Adrian for compliance signals)

It compounds two things FundExecs already does well — the Chain of Trust and the
15-specialist Executive Team — by giving them a constant stream of fresh,
auditable, person-specific input.

## 2. Free / low-cost signal sources (ranked)

| Rank | Source                                            | Cost             | What it gives us                                  | Why it matters here                                                       |
| ---- | ------------------------------------------------- | ---------------- | ------------------------------------------------- | ------------------------------------------------------------------------- |
| 1    | **SEC EDGAR (Form D)**                            | Free             | Private fundraising filings, real-time RSS + JSON | Form D = exempt-offering signal = warm LP/GP intel. Killer for FundExecs. |
| 2    | **SEC EDGAR (Form ADV / Schedule D)**             | Free             | Private fund + adviser structure                  | Identifies private fund universe + manager profiles                       |
| 3    | **SEC EDGAR (13D/13G/13F/Form 4/8-K)**            | Free             | Institutional ownership + insider + events        | Adjacent ownership / event signals for portfolio cos                      |
| 4    | **sec-api.io**                                    | Free tier → paid | Same EDGAR data, better latency + structured      | Use if EDGAR raw becomes too noisy to parse                               |
| 5    | **Firecrawl**                                     | Pay-per-call     | Press releases, job postings, deal-room scraping  | Phase 2 — non-SEC private market signals                                  |
| 6    | **Alpha Vantage / Finnhub / Tiingo**              | Free tier        | Public market quotes, fundamentals, news          | Useful for portfolio cos that IPO'd or comps                              |
| 7    | **OpenBB**                                        | Open source      | Orchestration layer across 1-6                    | Optional — if signal sources sprawl                                       |
| 8    | **S&P Global MI / LSEG / PitchBook / Crunchbase** | Enterprise paid  | Curated private market intel                      | Not for MVP; revisit when revenue justifies                               |

**Recommendation:** Start with **SEC EDGAR (Form D + ADV) only** for the MVP.
It's free, real-time, directly relevant, and the legal framing ("on the record /
audit-ready") aligns perfectly with FundExecs' brand voice.

## 3. Existing app surfaces — what's already wired

### Loaders / data layer (read-only consumption sites)

- `getDashboardData` → callers: `/settings`, `/profile`, `/command-center`, `AuthedShell`, `dashboard-rail-signals`
- `getFundProfile` → callers: same + `lib/lifecycle.ts`
- `getCreditWallet` → callers: same + `CreditWalletGauge`
- 18 `lib/queries/*` files exist (admin, ask-earn, auth, command-center, connections, credit-wallet, dashboard, diligence, fund-profile, identity, integrations, member-profile, notifications, org, pipeline, strategy, trust)

### Signal-adjacent shapes already in place

- `DashboardData.majorAlerts[]` — `{ id, severity: 'critical'|'warning'|'info', title, detail, href }`
- `DashboardData.activityFeed[]` — `{ id, kind: 'trust'|'diligence'|'system', title, at, actor }`
- `DashboardData.stageKpis[]` — `{ key, label, value, format, hint? }`
- `buildRailSignals()` already emits badges on `/profile`, `/command-center`, `/action-queue`, `/pipeline`, `/audit`, `/trust`

### Gamification primitives already shipped

- `ExecutionScore = { score, layers: {truth, concept, execution, work}, xp, level (derived), streak (seam=0) }`
- `profiles.xp integer` column + `trust_xp_award()` RPC (XP by layer kind)
- 4 render sites: `ExecutionScoreCard`, `ChainOfTrustStrip`, `DealTrustChip`, `TrustDrawer`
- `trust_events` append-only audit ledger ({org_id, actor_id, entity_type, entity_id, action, metadata})
- **NOT shipped:** `achievements`, `milestones`, `badges_earned`, `streaks`, `quests`, `market_signals` tables — clean greenfield

### Pre-existing stubs in the 6-area rail (Intelligence group, all stub today)

- `/inbox-intelligence` — primary surface for the new layer
- `/knowledge` — RAG searchable intel
- `/materials` — derived materials
- `/partners` — partner / source registry

Plus adjacent stubs that benefit:

- `/match-inbox` (Daily Execution group) — signal → LP / deal match queue
- `/action-queue` (Daily Execution) — signal-derived todos
- `/audit` (Audit group) — signal-trace audit trail

### Earn AI tooling already in place

- `lib/ai/{brains,earn,profile-suggest,trust-validate,voyage}.ts`
- `knowledge_documents` + `knowledge_chunks` (vector 1024, hnsw cosine, `match_knowledge_chunks()` RPC) — signals can be embedded + RAG-searched
- `brain_routing_rules` table — route signal types to specialists
- `EarnContextKind` already includes `'intelligence'` — no schema change needed for dock context

### 15-specialist roster (canonical names + roles)

1. Earnest Fundmaker · COO
2. Sterling · Chief of Staff
3. Dalia · Head of Data Operations ← **owns signal ingestion**
4. Theodore · Chief Strategy Advisor
5. Vivian · Managing Director, Demand Generation
6. Marcus · Head of Deal Origination ← **owns deal-signals**
7. Priya · Director of Capital Markets ← **owns market-signals**
8. Adrian · General Counsel & Compliance ← **owns SEC filings**
9. Sienna · Director of Communications
10. Noah · Head of Digital Presence ← **owns scraped web signals**
11. Camille · Head of Top-of-Funnel
12. Jasper · Director of Private Events
13. Eleanor · Head of Investor Relations ← **owns Form D / LP signals**
14. Sloane · Managing Director, Capital Formation
15. Felix · Director of Enablement

## 4. New schema (additive migrations only)

```sql
-- Raw + normalized signals
create table market_signals (
  id uuid primary key default gen_random_uuid(),
  source text not null,                     -- 'edgar-form-d' | 'edgar-form-adv' | 'firecrawl' | ...
  source_external_id text,                  -- vendor's id (CIK / accession #)
  kind text not null,                       -- 'private-fundraise' | 'fund-formation' | 'event' | 'news' | ...
  captured_at timestamptz not null default now(),
  occurred_at timestamptz,                  -- when the underlying event happened
  raw_payload jsonb not null,
  normalized jsonb,                         -- cleaned, schema-versioned
  severity text default 'info',             -- 'critical' | 'warning' | 'info' (maps to majorAlerts shape)
  embedding extensions.vector(1024),        -- RAG-searchable
  routed_specialist text                    -- 'eleanor' | 'marcus' | ... (from brain_routing_rules)
);

-- Per-org / per-member match queue
create table signal_matches (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid references market_signals on delete cascade,
  org_id uuid references organizations on delete cascade,
  match_score numeric(5,2),                 -- 0-100
  match_reason jsonb,                       -- which fund-profile fields hit
  routed_to text,                           -- entity_type:entity_id (e.g. 'lp:uuid')
  status text default 'new',                -- 'new' | 'viewed' | 'acted' | 'dismissed' | 'snoozed'
  acted_at timestamptz,
  dismissed_at timestamptz,
  metadata jsonb
);

-- XP events (enables streak derivation + audit)
create table xp_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles on delete cascade,
  event_type text not null,                 -- 'signal_acted' | 'trust_layer_complete' | 'deal_closed' | ...
  points integer not null,
  source_table text,                        -- 'signal_matches' | 'trust_events' | ...
  source_id uuid,
  awarded_at timestamptz not null default now()
);

-- Achievements (milestone badges, not decorative)
create table achievements (
  id text primary key,                      -- 'first-form-d-match', 'signal-driven-intro', ...
  title text not null,
  description text not null,
  rule_json jsonb not null,                 -- SQL-evaluable predicate
  tone text default 'info',                 -- visual tone
  category text                             -- 'intelligence' | 'trust' | 'capital' | ...
);

create table achievements_earned (
  actor_id uuid references profiles on delete cascade,
  achievement_id text references achievements on delete cascade,
  earned_at timestamptz not null default now(),
  evidence jsonb,                           -- which xp_events / signal_matches triggered it
  primary key (actor_id, achievement_id)
);

-- Quests (short missions)
create table quests (
  id text primary key,
  title text not null,
  description text not null,
  steps_json jsonb not null,                -- ordered steps with predicates
  reward_xp integer default 0,
  reward_achievement_id text references achievements
);

create table quests_progress (
  actor_id uuid references profiles on delete cascade,
  quest_id text references quests on delete cascade,
  steps_completed integer default 0,
  completed_at timestamptz,
  primary key (actor_id, quest_id)
);
```

**RLS:** Every new table inherits the existing pattern — actors can only read
their own org's rows; service-role bypasses for ingestion jobs.

## 5. Where the layer plugs in (touchpoint map)

| Surface                | What changes                                                                     | New code                                                    |
| ---------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `/inbox-intelligence`  | New live page; signal feed grouped by kind, scored + routed to specialist        | `app/inbox-intelligence/page.tsx` + view + 4 sub-components |
| `/match-inbox`         | New live page; signal_matches queue with accept/dismiss/snooze                   | `app/match-inbox/page.tsx` + view                           |
| `/knowledge`           | Existing stub → RAG search over `market_signals.embedding` + `knowledge_chunks`  | extend existing `knowledge` route                           |
| `/audit`               | Show xp_events + achievements_earned trace                                       | new view                                                    |
| Rail badges            | New `/inbox-intelligence`, `/match-inbox` badge slots in `buildRailSignals`      | extend `lib/dashboard-rail-signals.ts`                      |
| Dashboard Major Alerts | Top-severity signals promoted into `majorAlerts[]`                               | extend `lib/queries/dashboard/lifecycle.ts`                 |
| Activity Feed          | New `kind: 'signal'` added to existing union                                     | extend `DashboardData.activityFeed[]`                       |
| Earn Dock              | `kind: 'intelligence'` context already exists; populate with active signal queue | no schema change                                            |
| ExecutionScoreCard     | Show streak (currently seam=0); pull from xp_events window                       | extend `lib/queries/dashboard/lifecycle.ts`                 |
| Settings               | New "Intelligence" section (frequency, opt-in sources, mute list)                | extend `SettingsView.tsx`                                   |
| LP Pipeline            | Form D filings overlay on LP cards (last raise, who's in, recency)               | extend existing pipeline view                               |
| Deal Desk (stub today) | Auto-pulled diligence signals when route ships                                   | new                                                         |

## 6. Gamification — what compounds, what to avoid

### Compounds (per 2026 B2B fintech best practice + repo fit)

| Mechanic                       | How it lands in FundExecs                                                                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **XP for verified actions**    | Award via `trust_xp_award()` pattern when a signal is acted on (intro made, doc uploaded, status flipped) — never on view-only                                    |
| **Streaks**                    | Derive from `xp_events.awarded_at` with 7-day rolling window + 1-day grace; surfaces on dashboard ExecutionScoreCard (the existing `streak: 0` seam)              |
| **Milestone badges**           | 5 launch badges: "First Form D Match", "Signal-driven Intro", "Audit-Ready Week" (zero stale signals 7d), "Trust Layer Closed", "Pipeline Coverage 100%"          |
| **Quests**                     | 3 launch quests: "Connect Your First LP from a Signal" (signal → match → intro → reply), "Close a Trust Layer with Signal Evidence", "Build Your Weekly Briefing" |
| **Progress bars**              | Already exist (loopProgress, readinessScore, completenessScore, layer % bars) — extend to per-signal-kind coverage                                                |
| **Chain of Trust integration** | Signal evidence contributes to Concept layer (it's external validation of your thesis) — additive, not replacing                                                  |
| **Specialist routing**         | Each signal kind routes to its owner (Eleanor/Marcus/Priya/Adrian/Dalia/Noah) — reinforces team-of-15 narrative                                                   |

### Anti-patterns (HARD NO)

- Leaderboards that shame low performers
- Streaks without grace periods (creates pressure, not value)
- Hidden reward conditions
- Volume-based badges ("100 signals viewed!") — quality over quantity
- Dark patterns / urgency / scarcity
- Anything that would fail compliance / audit review
- Decorative badges with no operational meaning

## 7. Phased delivery

### Phase 1 (UI + read-only ingestion, ~4-6 hrs)

- New `app/inbox-intelligence/page.tsx` + view + 3 sub-components (FeedList, SignalCard, FilterRail)
- New `lib/queries/intelligence.ts` (`getSignalFeed(orgId)` + `getSignalMatches(orgId)`)
- Vercel cron job → EDGAR Form D RSS ingestion → `market_signals` table
- Simple keyword match against `fund_profile.{thesis, focus_areas}` → `signal_matches`
- Rail badge wiring for `/inbox-intelligence`
- Earn dock `kind: 'intelligence'` populated

### Phase 2 (gamification, ~4-6 hrs)

- Migrations: `xp_events`, `achievements`, `achievements_earned`, `quests`, `quests_progress`
- `lib/actions/xp-events.ts` (extend `xp.ts`)
- 5 launch badges + 3 launch quests seeded
- `ExecutionScoreCard` streak wired up
- Achievement toast + `TrustToaster` extension
- Earn briefing weaves in active quest progress

### Phase 3 (extended sources, ~3-4 hrs)

- Add `edgar-form-adv` + Firecrawl press-release ingestion
- `match_signals_to_lps()` Supabase function (richer scoring)
- `/match-inbox` route ships live (replaces stub)
- Signal → introduction workflow

### Phase 4 (trust integration + analytics, ~2-3 hrs)

- Chain-of-Trust Concept-layer attachment for signal evidence
- `/audit` route shows xp_events + achievements_earned trace
- Eleanor/Marcus/Priya briefing patterns ("3 new Form D matches on your thesis")
- Optional: `/knowledge` route lit up with signal embeddings

## 8. Guardrails (carried from Wave-1)

- UI-only lanes use the existing `app/`, `components/`, `lib/queries/`, `scripts/` boundary; data layer + ingestion uses additive migrations + server actions only
- No `lib/team` / `lib/supabase` / `proxy.ts` / `app/login/*` touches without explicit scope
- 15 brain slugs in `lib/team/roster.ts` stable
- Voice: "Chief Operating Officer · your live AI guide" + "on the record / audit-ready / documented as it forms"
- Tokens-only styling; reuse `--cta-gradient`, `--shadow-cta`; solid `bg-bg-1` overlays
- Do NOT re-add Admin to the rail — lives in Settings
- No auth-bypass files, ever
- All XP / achievement / quest evaluation server-side under RLS; client never grants its own XP

## 9. Open questions (Q1–Q7)

See `/app/memory/CLAUDE_INTELLIGENCE_PROMPT.md` for the user's answers + recommended defaults. Until those are answered, this proposal is reference-only.
