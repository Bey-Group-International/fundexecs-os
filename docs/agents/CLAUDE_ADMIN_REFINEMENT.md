# Claude — Admin portal refinement (functional + visual)

**Goal.** Refine the **Admin portal** (Settings → Admin tab, owner/admin-gated)
functionally and visually in one pass: wire the dead controls, make every panel
honest and (where free) real, add member search/filter + a first-class
invite-by-email flow, and give it the campaign's bold/dynamic treatment.

**Surface today**

- View: `app/admin/AdminView.tsx` (~565 lines) + `app/admin/BetaInvitesPanel.tsx`
- Mounted in `app/settings/SettingsView.tsx` (Admin section, `isAdmin` only) — **Admin stays in Settings; do not add it to the rail.**
- Data: `lib/queries/admin.ts` (`getAdminData` → members, actions, brains, pendingCount), `lib/queries/beta-invites.ts` (`getBetaInvites`).
- Actions (already exist — reuse, don't reinvent):
  - `lib/actions/admin.ts`: `approveMember`, `archiveMember`, `setMemberRole(memberId, role)` — already guards actor=owner/admin and "only owners can grant owner".
  - `lib/actions/beta-invites.ts`: `inviteBetaUser`, `resendBetaInvite`, `revokeBetaInvite` — **already mint an invite + magic link** via `admin.auth.admin.generateLink` and record in `beta_invites`.

Tabs: Users & roles · Beta invites · Activity · Chain of trust · Knowledge base.

---

## What to build

### 1. Role management — inline menu + guards (functional)

- Replace the dead "Assign role" (UserCog) button in `UsersPanel` with an inline
  **role menu** per member (owner / admin / member) wired to the existing
  `setMemberRole` action. Optimistic UI, then `router.refresh()` (mirror the
  approve/archive pattern already in `AdminView`).
- **Guards (UI + action):**
  - Disable choosing `owner` unless the current viewer is an owner (the action
    already enforces this server-side; reflect it in the UI).
  - **Add a "can't demote/archive the last owner" guard** — both in the UI
    (disable) and in `setMemberRole` / `archiveMember` (return a clear error if
    the target is the only `owner`). This is the one server-action edit allowed
    here; keep it additive, no auth/middleware/client changes.
  - Surface action errors inline (don't swallow `{ ok:false, error }`).
- a11y: the menu is a real listbox/menu — keyboard nav, `aria-expanded`, Esc
  closes, focus restore.

### 2. Member search + filter (functional)

- On the Users tab, add a search input (by name) + status/role filter chips.
  Pure client-side derived state over `data.members` (React-Compiler style — no
  manual `useMemo`). Empty/filtered states handled.
- Fix the arbitrary `i % 2` avatar tone — derive tone from **role** instead
  (e.g. owner → gold-free accent, admin → azure, member → neutral). Gold stays
  reserved for Earn; do not introduce new gold.

### 3. Invite a member by email + magic link (functional)

- Add a first-class **"Invite member"** affordance (Users tab header or a small
  dialog): email + role select + optional note → call the **existing**
  `inviteBetaUser` plumbing to mint the magic link, then show a **copy-link**
  state (and the recorded invite row). Reuse `BetaInvitesPanel` semantics;
  resend/revoke already exist.
- **Boundary:** accepting an invite → creating the `org_member` row with the
  chosen role is a **backend concern** (see the Codex brief). For now: capture
  the chosen role in the invite (note/metadata), mint + show the link, and label
  clearly that membership is granted on acceptance. Do **not** fabricate that the
  member is already active.

### 4. Real notifications (functional, no backend)

- Replace the hardcoded `NOTIFICATIONS` array with a panel derived from **real
  signals already on hand**: pending approvals (`pendingCount` / members where
  status==='Pending'), the most recent `admin_actions` (`data.actions`), and any
  open invites. Each item links to the relevant tab. Honest empty state.

### 5. Real platform metrics — consume a typed loader (scaffold → real)

- The Knowledge stats ("15 / 15 embeddings", "pgvector Live"), the 11-step
  pipeline, and the Chain-of-Trust layer values are **fabricated**. Do **not**
  ship fake numbers.
- Introduce a typed loader contract `lib/queries/admin-metrics.ts`:
  `getAdminMetrics(orgId): Promise<AdminMetrics>` returning, e.g.,
  `{ brains: { total, embedded }, vector: { status, chunks }, intake: { queued, processed }, trust: { layerCoverage: Record<layer, number> }, placeholder: boolean }`.
- **Ship an honest placeholder body now** (`placeholder: true`, real values only
  where free — e.g. `brains.total` from `TEAM_ROSTER`/`data.brains`), and render
  panels that read "live" when `placeholder===false` and "reference / coming
  soon" when `true` (the gamification-scaffold pattern). **Codex swaps the body**
  to real metrics later (its brief implements the SQL + loader). Wire the page
  (`app/settings/page.tsx`) to pass `adminMetrics` into `AdminView`.
- Remove the dead Knowledge buttons (Routing rules / Intake knowledge /
  Optimize) **or** make them real links/actions; no inert buttons.

### 6. Visual refine (bold, not flat)

- Apply the campaign's treatment used in #110/#111: KPI **stat strip** with tone
  icon discs + accent rails; tables get clear hierarchy; the active tab/section
  reads bold. Use the now-defined semantic tokens (`--success/-warning/-danger/-info -soft/-line`, shipped in #109) — **tokens only, no inline hex**; prefer
  `cn()` + tokens over the `TONE_HEX` inline-hex map where practical.
- Reduced-motion safe; solid `bg-bg-1` surfaces (no bleed-through); mobile + the
  settings two-column layout both hold.

## Guardrails

- **Scope:** `app/admin/*`, `app/settings/SettingsView.tsx` + `page.tsx` (pass
  the new loader), `lib/queries/admin*.ts` (additive), a new
  `lib/queries/admin-metrics.ts` (placeholder), and a **minimal additive guard**
  in `lib/actions/admin.ts` (last-owner). **No** migrations, **no**
  `lib/supabase` client / `proxy.ts` / middleware / `app/login` / auth changes.
- Reuse existing server actions; don't duplicate invite/role logic.
- Tokens-only; **gold reserved for Earn**; Admin stays in Settings; keep the 15
  brain slugs stable; no `yarn.lock`/`pnpm-lock.yaml`; no auth-bypass files.

## Deliverable

- Branch `claude/refine-admin`, **draft PR**, CI green
  (`format:check && typecheck && lint && build`), CodeRabbit-clean, before/after
  - a11y + mobile notes. OLD→NEW logged in `docs/REFINE_PROGRESS.md`.
