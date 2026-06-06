# FundExecs OS — PRD

Next.js 16 App Router + Supabase (Auth/Postgres/pgvector) + Tailwind v4.
A private-markets operating system with a 15-AI specialist team
(Earnest is COO, never called "copilots"). Built on Vercel.

## Current sprint status

| phase | scope | status |
| ----- | ----- | ------ |
| Phase 1 | §3H Team identity carry-over (15 specialists across landing + auth surfaces, `lib/team/*` single source of truth) | ✅ DONE |
| Phase 2 | Deliverable D — 5 member-type dashboard layouts (`app/command-center/layouts/*`) with loading/empty/error states + EarnNextBestActions | ✅ DONE |
| Phase 3 | Foundational: A) bidirectional middleware onboarding gate, B) `/api/ask-earn` never-block (HTTP 200 degraded shape), C) generalized signup seed + per-type top-up migration | ✅ DONE — incl. 2 patches |
| Phase 3 | C-runtime: apply migration to live + provision 5 test users + row-count snapshot | ✅ DONE 2026-02-06 |
| Phase 4 | Core-loop persistence — wire Chain of Trust drawer + Supabase Storage buckets, server actions for Pipeline / Strategy / Notifications / Admin / Settings | ⏳ NOT STARTED (next) |
| Phase 5 | Mocked integrations connect path | ⏳ NOT STARTED |
| Phase 6 | Polish + re-embed brains in `lib/ai/brains.ts` | ⏳ NOT STARTED |
| Emergent UI lane (sprint, 2026-02) | UnifiedSideRail extraction · `/lp-room` shell · flagship `InvestmentFirmLayout` rebuild · live-site voice + 4-step lifecycle · `--cta-gradient` / `--shadow-cta` token promotion | ✅ DONE 2026-02-06 (UI-only, no schema, no `lib/team` touch) |

## Test surface (live `emityvdaeiqxtpxdhyky`)

5 test users provisioned, one per `member_type`, baseline + per-type
seed applied, all left with `member_profiles.status='in_progress'` so the
bidirectional onboarding gate is exercisable. Credentials + row-count
snapshot live in `/app/memory/test_credentials.md`.

## Patches applied on top of base Phase 3 migration

- `supabase/migrations/20260606123000_fix_handle_new_user_org_type.sql` —
  base migration used `'investment'` for `organizations.type`, which is
  not a member of the `org_type` enum. Patch switches to `'operator'`.
- `supabase/migrations/20260606123500_fix_seed_baseline_multi_row_returning.sql` —
  base migration's `seed_demo_baseline_for_org` did a 3-row INSERT
  returning into a single scalar variable, which PL/pgSQL rejects with
  `TOO_MANY_ROWS`. Patch removes the `RETURNING` and relies on the
  existing per-email `SELECT id INTO` lookups.

## Backlog / next

- **P0** Wait on the comprehensive tester sweep against Deliverables A–D
  before starting Phase 4.
- **P0** Backend wiring of the Emergent UI lane: replace
  `components/lp-room/fixtures.ts` with real Supabase queries against the
  `LpRoomData` contract; wire `InvestmentFirmLayout` optional flagship
  props (`briefingPriorities`, `synergyAlerts`,
  `lifecycleActiveIndex/Pct`, `fundReadinessPct`) to live data.
- **P1** Phase 4: Chain of Trust drawer + Supabase Storage buckets +
  server actions across Pipeline, Strategy, Notifications, Admin,
  Settings.
- **P1** Phase 5: Mocked integrations connect path.
- **P2** Phase 6: Polish + re-embed brains.
- **P2** Regenerate `lib/supabase/database.types.ts` after Phase 3 ships
  (deferred per instruction).

## Invariants

- "Copilot" is retired across the UI. Use "specialist" / "executive
  team". Earn is COO.
- `lib/team/*` is the single source of truth for the 15 specialists.
- All Supabase secrets are read from `process.env`, never inlined.
- Keep CI green: `npm run format:check && npm run build && npm run
  typecheck && npm run lint`.
- Migrations are additive + idempotent. No drops.
