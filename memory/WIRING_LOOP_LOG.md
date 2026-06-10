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
- [x] **Siderail — Execute** is now a click-to-Earn action (was a 3-row "soon"
      sub-group that did nothing and was dropped entirely by the inline rail).
      Collapsed to one Earn action spanning pre-acquisition → exit, matching
      Formation. Stage-specific split (3 distinct Earn actions) would need
      `RailSubItem.earnPrompt` + renderer support — deferred as optional polish.
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
- **2026-06-10 ~03:30 CDT** — Siderail "Execute" wired as a click-to-Earn action.
  It was an expandable sub-group of three dead "soon" rows (Pre-/Post-Acquisition,
  Exit) that the focused/inline rail dropped entirely (only the collapsed popover
  showed them, non-functional). Collapsed to a single Earn action spanning the
  deal lifecycle, mirroring Formation — zero renderer risk (both renderers already
  handle earnPrompt). No "soon" rows remain in the rail registry. Gate: ✅ tsc
  ✅ lint ✅ format ✅ build.
- **2026-06-10 ~04:05 CDT** — Polish/QA: unified the sync-frequency source of
  truth. Extracted `lib/integrations/sync-frequency.ts` (pure, icon-free:
  `SYNC_FREQUENCIES`, `SYNC_FREQUENCY_OPTIONS`, `DEFAULT_SYNC_FREQUENCY`,
  `isSyncFrequency`, `toSyncFrequency`) so the route validation, the card
  selector, and the DB check constraint can't drift; route + card now import it
  (removed their duplicate local copies). Added `sync-frequency.test.ts`
  (155 unit tests pass). NB: tried a catalog merge-logic test first but
  `catalog.ts` imports lucide-react, which breaks under the `--conditions=
react-server` test runner (`react.createContext`), so catalog isn't unit-
  testable without splitting UI-icon metadata from pure logic — logged as
  optional future refactor. Gate: ✅ tsc ✅ lint ✅ format ✅ build ✅ unit(155).

## Note for the user (remaining backlog needs a product call)

The two items left are full feature builds, not wiring gaps, and are
architecturally significant — flagging rather than barreling through unattended:

- **Gamification (dashboard)** — needs the Phase-2 backend (achievements,
  achievements_earned, quests, quests_progress, xp_events tables + a rules
  engine), then flip `GAMIFICATION_IS_PLACEHOLDER`. The UI is honest "not
  started" today. Want this built for real, or left as scaffold?
- **Multi-account "Add account" (account menu)** — needs secondary-login auth
  linking + an account switcher + per-account workspace persistence. Scope/UX
  decision needed before building.

- **2026-06-10 ~04:40 CDT** — Refactor for testability: split the integrations
  catalog into a pure, icon-free core (`lib/integrations/providers.ts`:
  `PROVIDER_ORDER`, `PROVIDER_COMING_SOON` as the single availability source,
  `providerAvailable`, `mergeConnections`, `IntegrationView`/`ConnectionStatus`).
  `catalog.ts` re-exports them so every import site is unchanged; removed the
  per-entry `comingSoon` flags (now derived from the pure map) and the
  request-access route now uses `providerAvailable`. Added `providers.test.ts`
  (8 cases; 163 unit tests total). This unblocks unit-testing the core wiring
  that `catalog.ts` couldn't (lucide-react trips react.createContext under the
  react-server test runner). Also formatted the prior log note (the iter-5 commit
  appended it after its format check, so that commit's CI format:check would have
  failed; PR head is clean again here). Gate: ✅ tsc ✅ lint ✅ format ✅ build
  ✅ unit(163).
