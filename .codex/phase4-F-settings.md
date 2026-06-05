# Codex Task Spec — Phase 4 Deliverable F (Settings)

## Mission

Wire the Settings screen to real DB writes. Today every "Save changes" button is a no-op (no onClick). After this task, account-level and org-level settings persist via RLS-bounded server actions, fire trust-XP where appropriate, and the UI reflects the saved state immediately.

## Branch + PR

- Branch off: `phase4-core-loop` (NOT `main`).
- Branch name: `phase4-F-settings`.
- PR title: `Phase 4 Deliverable F — Settings persistence`.
- Target: `phase4-core-loop`.
- Commit grain: small, conventional commits.

## Files you OWN (you may create/modify freely)

- `app/settings/page.tsx` (existing — extend, do not rewrite)
- `app/settings/SettingsView.tsx` (existing — extend)
- `lib/actions/settings.ts` (NEW — server actions)
- `lib/queries/settings.ts` (NEW only if needed for read-side helpers)
- `components/settings/*` (NEW — any sub-components specific to settings)
- `.codex/phase4-F-settings.md` (this file)

## Files you MUST NOT touch (owned by parallel work on the same branch)

- `lib/actions/deals.ts`, `lib/actions/allocations.ts` — Deliverable A
- `lib/actions/connections.ts` — Deliverable B
- `lib/actions/strategy.ts` — Deliverable C
- `lib/actions/notifications.ts` — Deliverable D
- `lib/actions/admin.ts` — Deliverable E
- `lib/actions/xp.ts` — shared, EXISTING. Read-only. Import, do not modify.
- `lib/supabase/middleware.ts` — Phase 1/3, frozen.
- `lib/supabase/server.ts`, `lib/supabase/admin.ts`, `lib/supabase/client.ts` — frozen.
- `components/shell/*` — AppShell, EarnDock, EarnOrb, TrustToaster — frozen.
- `components/drawers/Drawer.tsx` (if it exists by the time you start — shared primitive being introduced by Deliverable A). Import and use; do not modify.
- `app/pipeline/*`, `app/connections/*`, `app/strategy/*`, `app/notifications/*`, `app/admin/*` — parallel work.
- `supabase/migrations/*` — DO NOT create new migrations. If you think you need a new column or constraint, STOP and raise it back to the orchestrator. The brief asserts all needed columns exist.
- `lib/ai/brains.ts`, `lib/team/*` — frozen per §3H/Phase 1.
- `app/page.tsx`, `app/login/page.tsx` — frozen per §3H.

## Schema ground truth (run before coding — fill brackets after running)

Connect via `psql` using the env from `/app/.env.local` (`PGHOST=aws-1-us-east-1.pooler.supabase.com`, `PGUSER=postgres.emityvdaeiqxtpxdhyky`, `PGPASSWORD='@1Emergent2026'`, `PGSSLMODE=require`). Run:

- `\d public.profiles` — record column names + types (expect: id, full_name, role, avatar_url, xp, member_type, created_at, updated_at — but verify).
- `\d public.organizations` — record columns (expect: id, name, type [enum], created_at — but verify).
- `\d public.org_members` — record role enum values + status column if present.

Paste the actual column lists into this spec under "Verified schema" before writing code. Codex must NOT guess column names.

### Verified schema (already run by orchestrator on 2026-02-06)

- `profiles` columns: `id uuid` (PK, FK → auth.users.id), `full_name text`, `role text`, `avatar_url text`, `xp integer`, `member_type text`, `created_at timestamptz`, `updated_at timestamptz`. **NO `timezone` column** — drop the `timezone` field from `saveAccountSettings`'s input or add a migration request to the orchestrator (do NOT create the migration yourself).
- `organizations` columns: `id uuid`, `name text`, `type org_type` (enum), `tier text`, `created_at timestamptz`, `updated_at timestamptz`.
- `organizations.type` enum values: `'fund' | 'lp' | 'operator' | 'capital_provider' | 'service_provider' | 'partner'` (the enum is `public.org_type`).
- `org_members` columns: `id uuid`, `org_id uuid`, `user_id uuid`, `role org_member_role` (enum), `created_at timestamptz`, `status text` (default `'active'`, CHECK `status IN ('pending', 'active', 'archived')` — added by Phase 4 migration `20260606130000`).
- `org_members.role` enum values: `'owner' | 'admin' | 'member'` (the enum is `public.org_member_role`).
- `admin_actions` columns: `id uuid`, `org_id uuid`, `admin_user_id uuid`, `action_type text`, `target_type text`, `target_id uuid`, `metadata jsonb`, `created_at timestamptz`. **NOTE: column is `admin_user_id` (not `actor_id`), `action_type` (not `action`), `target_type` (not `target_entity_type`), `target_id` (not `target_entity_id`), and the timestamp column is `created_at` (not `occurred_at`).** Use these exact names when inserting audit rows.

## Server actions to ship (in `lib/actions/settings.ts`)

All actions: `'use server'` at the top of the file. Validate input. Use `import { createClient } from '@/lib/supabase/server'`. Return shape `{ ok: true, data } | { ok: false, error: string, code?: string }`. Wrap supabase calls in try/catch. NEVER reach for the service-role client unless explicitly noted.

1. `saveAccountSettings(input: { full_name?: string; role?: string; avatar_url?: string | null })`
   - UPDATE `public.profiles` WHERE `id = auth.uid()` SET only the provided fields.
   - Validate: `full_name` 1..120 chars; `role` 1..120 chars; `avatar_url` valid URL or null.
   - Return the updated profile row.
   - No XP — settings save is a non-trust-bearing action.
   - **Do NOT include `timezone`** — column does not exist. If you need it later, the orchestrator will add a migration.

2. `saveOrgSettings(input: { org_id: string; name?: string; type?: 'fund' | 'lp' | 'operator' | 'capital_provider' | 'service_provider' | 'partner'; tier?: string | null })`
   - REQUIRES the calling user be `org_members.role IN ('owner', 'admin')` AND `org_members.status = 'active'` for the supplied `org_id`. Enforce server-side via a `select role, status from public.org_members where org_id = $1 and user_id = auth.uid()` lookup BEFORE the UPDATE. If not owner/admin or status != 'active', return `{ ok: false, error: 'forbidden', code: 'NOT_ADMIN' }`.
   - UPDATE `public.organizations` WHERE `id = $1` SET only the provided fields.
   - Validate: `name` 1..120 chars; `type` ∈ `'fund' | 'lp' | 'operator' | 'capital_provider' | 'service_provider' | 'partner'`.
   - INSERT a row into `public.admin_actions` with the verified column names: `org_id`, `admin_user_id` (= auth.uid()), `action_type` (= `'update_organization'`), `target_type` (= `'organization'`), `target_id` (= the org id), `metadata` (jsonb of the changed-field names + values).
   - Return the updated org row.
   - No XP.

3. `changePassword(input: { new_password: string })`
   - Validate: `new_password` ≥ 12 chars, contains at least one lowercase, one uppercase, one digit.
   - Call `supabase.auth.updateUser({ password })` (existing supabase-js).
   - Return `{ ok: true }` with no body, or `{ ok: false, error: string }`.

4. (Optional, nice-to-have if time permits) `signOutEverywhere()`
   - Calls `supabase.auth.signOut({ scope: 'global' })`.

## UI wiring — `app/settings/SettingsView.tsx`

The current view is presentational with no `onClick` handlers on its "Save changes" buttons. Wire them up.

- Each form section ("Account", "Organization", "Security") gets:
  - Controlled `useState` form state, hydrated from server-loaded `profile` / `org` props.
  - A `useTransition`-wrapped submit handler that calls the matching server action with the diff (only changed fields).
  - Submit button: disabled while pending, shows a small loading spinner + label change "Saving…".
  - On success: replace the local state with the returned canonical row + show an inline success affordance (a subtle green checkmark on the button for ~2s, NOT a toast).
  - On error: render an inline error caption under the form (red, calm — NOT a toast).
- The Org section must be hidden / disabled with `aria-disabled` when the current user is NOT owner/admin (read from existing org_members lookup in `app/settings/page.tsx`).
- The Proof-of-Truth status card stays as-is. Do not modify it.
- "Sign out everywhere" button gates behind a confirm modal (use the standard browser `confirm()` is acceptable for V1).

## Loading / empty / error / dead-end rules

- Initial load: SSR'd, no loading spinner needed.
- During submit: button shows pending state; the rest of the page stays interactive.
- On error: inline caption. Do NOT show a toast. Do NOT swallow silently.
- No button on the Settings page may be a no-op after this task. If a control isn't ready, render it `aria-disabled` with a label explaining why.

## Accessibility

- Every form input has a visible `<label>`.
- Submit buttons have an accessible name even in pending state ("Saving account changes…" is fine).
- Inline error captions use `role="alert"` so screen readers announce them.
- Focus management: after a successful save, return focus to the saved section's heading.
- All forms are keyboard-submittable.

## Mobile

- The whole settings page must single-column at `<sm` (likely already does — verify).
- `body { overflow-x: clip }` is set globally; don't introduce wide flex children that would force horizontal scroll.

## Hard rules

- Additive only. No edits to migrations. No edits to RLS policies.
- Service-role key is NOT used in this deliverable. Settings writes are user-scoped under RLS.
- CI must stay green: run all of `npm run format:check && npm run typecheck && npm run lint && npm run build` BEFORE opening the PR. Paste the outputs into the PR description.
- Respect `react-hooks/set-state-in-effect`: no synchronous setState in a useEffect body. Use the async continuation pattern if you need it.
- No new dependencies. The repo already has everything you need (zod is NOT a dep — use inline validation).
- Token economy: keep the diff under ~500 lines. If it balloons, you're probably over-architecting.

## Acceptance criteria (binary, testable)

1. Account save: changing `full_name` in the UI and clicking Save updates `public.profiles.full_name` for the signed-in user. Refresh confirms. Other profile fields untouched.
2. Org save (as owner/admin only): changing the org name updates `public.organizations.name` AND inserts an `admin_actions` row capturing the change. As a non-owner, the Org section is `aria-disabled` and `saveOrgSettings` returns `{ ok: false, code: 'NOT_ADMIN' }` if called directly.
3. Password change: setting a new compliant password lets the user sign back in with it (Supabase auth flow). Non-compliant passwords return `{ ok: false }` with a validation error message; UI shows it inline.
4. No dead ends: every button on `/settings` either fires a server action or is explicitly `aria-disabled` with a label.
5. CI green: format, typecheck, lint, build all pass on the new branch.
6. Mobile (390×844): no horizontal overflow; all sections stack to single column.

## When done

Open a PR from `phase4-F-settings` → `phase4-core-loop` with:

- The 4 CI command outputs pasted into the description.
- A short "before/after" of one account save + one org save against the live DB (paste the SQL `SELECT` results).
- A 1280×800 screenshot of the saved-state UI.
- A 390×844 screenshot of the mobile single-column layout.

The orchestrator (Claude) will review the PR and merge to `phase4-core-loop` once approved.

## Out of scope for Codex

- Any other Phase 4 surface (A–E).
- Chain of Trust (Phase 5).
- Mocked integrations (Phase 6).
- The Settings page's Proof-of-Truth status card (frozen).
- Avatar upload (file storage is Phase 5 work — wire avatar_url as a text input only for this task).
- Two-factor / SSO / org transfer / billing — out of scope.
