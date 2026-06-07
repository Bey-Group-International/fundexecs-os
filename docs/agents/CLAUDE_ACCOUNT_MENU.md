# Claude — Side-rail account menu (pops like Claude's bottom-left menu)

**Goal.** Turn the side rail's bottom **user footer** (`components/shell/Wave1SideRail.tsx`)
into a **popping account menu** — the same feel as Claude Code's bottom-left
account menu: click the identity row → a tasteful popover opens upward with the
account's identity, workspace/role switching, and a full set of entries.

## Menu contents (in order)

1. **Identity header** — avatar, name, email, current workspace + role, level badge.
2. **Workspace + role switcher** ("roles") — list every org the user belongs to
   (from `org_members`) with their **role in each**; selecting one switches the
   **active workspace**. Leave a clearly-labeled, styled slot for **future
   multi-account** (separate logins) so the layout already has room for it.
3. **Settings** → `/settings`
4. **Admin** → `/settings#admin` — **gated to owner/admin only** (reuse the
   existing admin gating; hide for non-admins). This surfaces the admin detail
   already built into Settings.
5. **Integrations** (front-facing apps & extensions) → `/integrations`
6. **View plans** → `/settings#billing` (the billing section already exists; it
   also fronts the Stripe credit top-up just wired)
7. **Gift FundExecs** → new light page/flow (referral/gift) — see "new surfaces"
8. **Get help** → new light help page (support + FAQs) — see "new surfaces"
9. **Learn more** (submenu/group, Claude-grade): **What's new**, **Documentation**,
   **Keyboard shortcuts**, **Terms** (`/terms`), **Privacy** (`/privacy`),
   **System status**.
10. **Log out** → existing Supabase `signOut` (keep current behavior).

## Behavior & placement

- Trigger = the existing footer identity row (avatar + name + role + level). It
  becomes a `<button>` that toggles the popover **above** it (bottom-anchored,
  opens upward), like Claude's menu.
- **Responsive:** popover on desktop; on mobile (`<lg`, inside the off-canvas
  drawer) render as a full-width sheet that fits the viewport.
- **a11y:** `role="menu"`/menuitems (or a labeled dialog), `aria-expanded` on the
  trigger, Esc closes, focus trapped then restored, full keyboard nav, visible
  focus rings. Click-outside closes. Reduced-motion safe (reuse globals pattern).

## Consolidation

- **Remove the separate top-of-rail org switcher** and move workspace/org
  switching into this account menu (single identity hub). Keep the rail's brand
  header. Ensure nothing else depends on the old top switcher.

## Data

- Extend `lib/queries/identity.ts` (`getShellIdentity`) to also return: the user's
  **email**, and a **memberships** array `[{ orgId, orgName, role, tier }]` from
  `org_members` joined to `organizations` (active memberships). Keep existing
  fields (`name, role, orgName, orgTier, level`) stable — additive only.
- **Workspace switch:** reuse the existing active-org mechanism if present
  (`getActiveOrg`); if switching isn't wired, add a minimal cookie-based
  `setActiveWorkspace(orgId)` server action that validates membership and has
  `getActiveOrg` honor the cookie, then `revalidatePath('/')`. **Additive only —
  no middleware/auth/migration changes.** Switching must respect RLS (a user can
  only switch to an org they're an active member of).

## New surfaces (light, real, Claude-grade polish)

- `app/gift/page.tsx` — Gift FundExecs (share/referral; can be a simple shareable
  message + copy-link for now, clearly real not a dead stub).
- `app/help/page.tsx` — Get help (support contact + a few FAQs / links).
- `app/whats-new/page.tsx` — What's new (a simple changelog list; seed with recent
  shipped highlights).
- `app/docs/page.tsx` (or `/learn`) — Documentation hub (links/sections explaining
  the desk, Chain of Trust, the 15 agents). Keep it a real page, not lorem.
- **Keyboard shortcuts** — an overlay/dialog (⌘K-style help). If a shortcuts
  registry doesn't exist, list the real ones already in the app.
- Terms/Privacy already exist (`/terms`, `/privacy`); System status → external
  link (or a tasteful placeholder) — your call, keep honest.

## Guardrails

- **Scope:** `components/shell/Wave1SideRail.tsx` + new account-menu component(s),
  `lib/queries/identity.ts` (additive), an additive `setActiveWorkspace` action +
  `getActiveOrg` honoring it if needed, and the new light pages above. **No**
  migrations, **no** `lib/supabase` client / `proxy.ts` / **middleware** /
  `app/login` / `lib/queries/auth` changes.
- Keep `Wave1SideRail` public props stable; preserve the collapsible
  compartments + `sourceOfTruthSummary` (just shipped). Keep the 15 brain slugs;
  **Admin lives in Settings** (the menu links to it, doesn't re-add it to the rail).
- Tokens-only; solid `bg-bg-1` popover (no bleed-through); gold reserved for
  level/Earn. No `yarn.lock`/`pnpm-lock.yaml`, no auth-bypass files.

## Deliverable

- Refactored footer → account menu, consolidated switcher, extended identity,
  new pages, keyboard-shortcuts overlay.
- Branch `claude/account-menu`, **draft PR**, CI green
  (`format:check && typecheck && lint && build`), a11y + mobile + before/after
  notes. Stop for review.
