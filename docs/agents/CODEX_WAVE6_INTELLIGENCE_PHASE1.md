# Codex — Wave 6 (backend/data): Market-Signal Intelligence, Phase 1 foundation

**Context.** We're building the Gamified Capital Market Intelligence Layer from
`memory/INTELLIGENCE_LAYER_PROPOSAL.md` (read it + `memory/CLAUDE_INTELLIGENCE_PROMPT.md`
first). This brief is **Phase 1, backend/data slice only** — the signal store and
the scorer. Ingestion (EDGAR adapters + Vercel cron) and the `/inbox-intelligence`
UI are handled by Claude + a UI agent in parallel; **stay in your lane.**

## Reconciliation decisions (already made — build to these, not the raw proposal)

The proposal predates a lot of shipped work. Two binding overrides:

1. **Reuse the live `matches` table — do NOT create `signal_matches`.** Signal
   matches are written as `matches` rows with **`kind = 'signal'`**, so they flow
   through the existing `act_on_match(_match_id, _action)` RPC and the live
   `/match-inbox` UI. `subject_id` = the `market_signals.id`.
2. **Audit reuses the live `get_audit_trail` RPC** (Wave-4) — don't build a new
   audit read path. (XP/achievements come in Phase 2, not now.)

Already live you can lean on: `matches` (+ `kind`, `subject_id`, `score`,
`rationale`, `status`, `acted_at`, `acted_by`), `act_on_match`, `generate_lp_matches`
(your scorer to mirror), `fund_profiles`/`member_profiles` (thesis/focus_areas),
`brain_routing_rules`, `match_knowledge_chunks`, `private.is_org_member`. Note the
XP RPC is named **`award_trust_xp`** (not `trust_xp_award`).

## Lane & guardrails

- **Backend/data only.** No UI, no `lib/ingestion/*`, no `app/api/cron/*`, no
  React, no `lib/supabase/*` client, `proxy.ts`, middleware, `app/login/*`,
  `lib/queries/auth`, `lib/ai/*`. Those are Claude/UI lanes.
- Migrations **additive + idempotent**. New `SECURITY DEFINER` funcs pin
  `set search_path = ''`, schema-qualify, and follow the member-read /
  service-role-write RLS pattern. **Don't apply** — Claude applies, runs
  advisors, regenerates types, merges.
- Branch `codex/wave6-intelligence`, **draft PR**, stop for Claude review.

## Deliverables (one additive migration)

### 1. `market_signals` table

Per proposal §4, additive, RLS-on:

```
id uuid pk default gen_random_uuid()
source text not null            -- 'edgar-form-d' | 'edgar-form-adv'
source_external_id text         -- CIK / accession #
kind text not null              -- 'private-fundraise' | 'fund-formation' | 'news' | ...
captured_at timestamptz not null default now()
occurred_at timestamptz
raw_payload jsonb not null
normalized jsonb
severity text default 'info'    -- 'critical' | 'warning' | 'info'
embedding extensions.vector(1024)
routed_specialist text          -- 'eleanor' | 'adrian' | 'marcus' | 'noah' | ...
created_at timestamptz not null default now()
```

- **Unique** `(source, source_external_id)` so the cron is idempotent on re-poll.
- Indexes: `(kind, captured_at desc)`, `(routed_specialist)`, and an hnsw cosine
  index on `embedding` (mirror `knowledge_chunks`).
- RLS: signals are global reference data → `select` to `authenticated`;
  `insert/update` to `service_role` only (ingestion). No `org_id` on the raw
  signal — org targeting lives in the match rows.

### 2. `generate_signal_matches(_org_id uuid)` — the scorer

Mirror `generate_lp_matches` exactly in structure/contract:

- `SECURITY DEFINER`, `set search_path = ''`, **service_role only** (revoke from
  public/anon/authenticated; grant service_role).
- For each `market_signals` row not already matched for this org, score 0–100
  against the org's thesis/focus (`member_profiles.details` thesis/focus_areas +
  `fund_profiles` if present), and **insert one `matches` row**:
  - `kind = 'signal'`, `subject_id = market_signals.id`, `status = 'new'`,
    `score`, `rationale = jsonb array of { factor, weight, detail }` (same shape
    as `generate_lp_matches`), plus a `match_reason` factor naming which
    fund-profile fields hit and the `routed_specialist`.
  - Dedup: `not exists (matches where org_id, kind='signal', subject_id=signal.id)`.
- Returns integer count inserted.
- Persona-aware scoring per Q2 (firm/individual → thesis + raise fit;
  service_provider → demand-side fit). Deterministic, no AI call.

### 3. Indexes for the signal hot paths

`matches(org_id, kind, status)` already exists from Wave-4 — confirm it covers
`kind='signal'` reads; add `market_signals` indexes above.

## Explicitly NOT in this brief (other lanes)

- EDGAR Form D/ADV adapters (`lib/ingestion/edgar/*`) + `app/api/cron/edgar-poll` — **Claude**.
- Embedding signals at ingestion (Voyage) — **Claude** (you just provide the column + hnsw index).
- `/inbox-intelligence` view + `lib/queries/intelligence.ts` + rail badge — **UI agent + Claude**.
- Phase 2 gamification (`xp_events`, `achievements`, `quests`) — a **later** Codex brief.

## Validation before PR

List in the PR: `market_signals` columns + indexes + RLS policies, and the exact
`generate_signal_matches` signature, scoring weights, rationale shape, and grants.
`npm run format:check && typecheck && lint && build` green. Migration `.sql` won't
be flagged by Prettier. **Do not apply; do not merge.**
