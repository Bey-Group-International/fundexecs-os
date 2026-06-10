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
- [ ] **User portal — Integration sync-frequency** is device-local
      (`localStorage`). Add `sync_frequency` to `integration_connections`, persist
      it server-side (extend the manage panel / a small route), read it back into
      `IntegrationView`. `components/integrations/IntegrationCard.tsx:86`.
- [ ] **Dashboard — Gamification** achievements/quests return hardcoded
      placeholders (`GAMIFICATION_IS_PLACEHOLDER = true`).
      `lib/queries/gamification.ts`. Wire to real `xp_events` aggregation +
      achievement/quest tables; flip the flag once live. Components:
      `components/dashboard/AchievementGrid.tsx`, `QuestProgressCard.tsx`.
- [ ] **Admin portal — Platform metrics** show placeholder zeros when
      `get_admin_metrics` RPC is missing. `lib/queries/admin-metrics.ts` (returns
      `placeholder: true` on error). Verify/implement the RPC migration so
      knowledge-embedding coverage + pgvector status render live.
      `app/admin/AdminView.tsx:850-909`.
- [ ] **Siderail — Formation route.** `components/shell/rail-nav.ts:160`
      (`live: false`, no href). Build `/formation` (entity & fund formation) +
      loader, flip `live: true`.
- [ ] **Siderail — Execute sub-items** (Pre-Acquisition / Post-Acquisition /
      Exit). `components/shell/rail-nav.ts:235-237`. Build routes + loaders.
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
