# Full-Wiring Loop — Backlog & Log

> Autonomous timed loop (one focused, CI-verified change per ~30 min) wiring the
> last UI-only / placeholder surfaces to real backends. Cadence + gate mirror the
> 2026-06-06 overnight sweep: **format → typecheck → lint → build green before
> every commit**. Branch: `claude/full-wiring-portal-features-wybfvl` → one
> accumulating draft PR. Window: from 2026-06-10 ~01:30 CDT to 09:00 CST.
>
> **Each iteration:** read this file → pick the top unchecked backlog item →
> implement a complete vertical slice (UI ↔ server action/route ↔ table) →
> verify green → commit → push → check the item off + append a log line. Keep
> migrations additive + idempotent; keep `lib/supabase/database.types.ts` in
> sync with any new table; keep secrets server-side.

## Scope (the 6 areas requested)

dashboard · siderail · earn modal · executive team · admin portal · user portal

Recon (2026-06-10) found Earn modal and Executive team **already fully wired**.
Real gaps below.

## Backlog (priority order)

- [x] **User portal — Integrations "Request access"** persists. Button now POSTs
      to `/api/integrations/request-access`, upserts `integration_access_requests`,
      and the card shows a durable "Requested" state across reloads.
- [x] **User portal — Integration sync-frequency** persists server-side. Added
      `integration_connections.sync_frequency` (+ check constraint),
      `POST /api/integrations/:provider/frequency`, threaded through the query →
      `IntegrationView` → card (seeded from server, optimistic save w/ revert).
- [x] **Siderail — Formation** is now a click-to-Earn action (was a dead "soon"
      row). Added `earnPrompt` to the Build cluster's Formation item; both rail
      renderers already handle Earn items. `components/shell/rail-nav.ts:160`.
- [ ] **Admin metrics** — NOT a gap. The `get_admin_metrics` RPC exists
      (migration `20260607110000`) and is fully wired; `placeholder:true` is only
      a defensive fallback on RPC error. Left as-is.
- [ ] **Dashboard — Gamification** achievements/quests return hardcoded
      placeholders (`GAMIFICATION_IS_PLACEHOLDER = true`).
      `lib/queries/gamification.ts`. Wire to real `xp_events` aggregation +
      achievement/quest tables; flip the flag once live. Components:
      `components/dashboard/AchievementGrid.tsx`, `QuestProgressCard.tsx`.
- [ ] **Siderail — Execute sub-items** (Pre-Acquisition / Post-Acquisition /
      Exit). `RailSubItem` only supports `href` today; wiring these to Earn needs
      `earnPrompt` on `RailSubItem` + handling in both renderers (note: the inline
      rail drops `children` entirely — pre-existing inconsistency to resolve too).
- [ ] **Admin/account — Multi-account "Add account"** disabled.
      `components/shell/account/AccountMenu.tsx:420-442`. Larger (auth linking +
      workspace switcher) — scope before building; split if needed.

## Log

- **2026-06-10 ~01:45 CDT** — Integrations "Request access" wired end-to-end.
  Added migration `20260610140000_integration_access_requests.sql` (org+user+
  provider, RLS read for members, service-role writes), `getIntegrationAccessRequests`
  query, `POST /api/integrations/request-access` (idempotent upsert, validates
  comingSoon), `IntegrationView.requested` + `mergeConnections(rows, requested)`,
  and seeded the card from server state. Gate: ✅ tsc ✅ lint ✅ format ✅ build.
  CI on #301: all checks green (typecheck/lint/build, Playwright, CodeQL).
- **2026-06-10 ~02:20 CDT** — Integration sync-frequency now persists to the
  connection row instead of localStorage. Migration
  `20260610150000_integration_sync_frequency.sql` (column + check constraint),
  `POST /api/integrations/:provider/frequency` (auth + connected check, validates
  cadence), `ProviderConnection.sync_frequency` + `IntegrationView.sync_frequency`
  threaded through `mergeConnections`, card seeds from server and saves
  optimistically with revert-on-failure. Gate: ✅ tsc ✅ lint ✅ format ✅ build.
- **2026-06-10 ~02:55 CDT** — Siderail "Formation" wired as a click-to-Earn
  action (was a dead "soon" row with no behavior). Added an `earnPrompt` to the
  Build cluster's Formation item — both rail renderers (`InlineNavItem`,
  `ClusterMenuEntry`) already handle Earn items, so it lights up in expanded and
  collapsed rail. Verified `get_admin_metrics` RPC already exists/wired (not a
  gap; recon overcounted). Gate: ✅ tsc ✅ lint ✅ format ✅ build.
