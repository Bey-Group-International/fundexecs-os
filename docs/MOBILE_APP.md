# FundExecs OS — Mobile / App Experience

A dedicated **mobile app layer** for FundExecs OS. It turns the responsive web
app into an app-native experience on phones — bottom tab navigation, a command
center home, an Earn-first entry point, quick actions, and PWA install — **without
changing the desktop or web experience at all**.

Everything here is isolated behind the `md` breakpoint (768px) or lives on
dedicated app routes. Desktop (≥1024px) and tablet (768–1023px) render exactly
as before.

---

## 0. Direction — a distinct on-the-go experience

Rounds 1–6 gave the phone an app shell, card-based lists, gestures, and
thumb-reachable detail bars — but the *screens themselves* still read like the
desktop app. This round changes the model, not just the chrome: the mobile home
is now a **conversation with Earn**, not a dashboard.

**`/home` is a chat-first Earn home** (`MobileEarnHome`). Instead of stacked
dashboard sections, Earn greets the operator, states the brief in a sentence
("3 approvals need your sign-off, I've got 4 workflows running, and 12 deals are
live"), drops a **Live Pulse** glance card (the monitor surface), then walks
through what needs attention — approvals, the hottest deal (swipeable), workflows
in motion — as rich cards attached to its messages. Suggested-reply chips and a
persistent **"Message Earn" composer** (fixed above the tab bar) let the operator
talk back from anywhere. The quick-action FAB is suppressed on `/home` so the
composer owns the bottom-right. This is a **dedicated mobile surface**; the
desktop dashboard is untouched. It is the first screen of an ongoing move to
purpose-built mobile screens rather than restyled desktop pages.

---

## 1. UX audit (before)

The pre-existing app is desktop-first:

- **Navigation**: a fixed 224px left sidebar (`components/AppSidebar.tsx`,
  `hidden md:flex`) plus a top command bar. Below `md` the sidebar was hidden
  and replaced only by a hamburger slide-over — there was **no persistent,
  thumb-reachable navigation** on a phone.
- **Density**: dashboards, tables, and multi-column panels were designed for
  wide viewports; on a phone they compress rather than adapt.
- **Earn**: surfaced through a floating bottom-right dock (`EarnCopilotDock`),
  which on a phone collides with content and the home indicator.
- **Landing**: post-login opens to `/workspace` (session list) — powerful, but
  not a "what needs me now?" command surface.
- **PWA**: a minimal `manifest.ts` existed (name, icons, standalone) but no
  shortcuts, no install prompt, no offline fallback, no iOS status-bar handling.

The engine underneath (auth, roles, Supabase data, Earn, deals, network,
approvals) is solid and fully reusable — the gap was purely the **presentation
and navigation layer on small screens**.

---

## 2. Architecture

The mobile layer is **additive** and mounts inside the existing authed layout
(`app/(app)/layout.tsx`). No desktop component was removed or restyled; the
mobile chrome is a set of `md:hidden` siblings.

```
app/(app)/layout.tsx
├─ AppSidebar               (unchanged, hidden md:flex — desktop only)
├─ GlobalTopBar             (unchanged)
├─ <main pb-appnav md:pb-8> (mobile gains bottom padding to clear the tab bar)
├─ EarnCopilotDock          (now wrapped `hidden md:contents` — desktop only)
├─ DownloadBanner           (now wrapped `hidden md:block`   — desktop only)
└─ AppShellMobile           (NEW, md:hidden) ── the mobile app shell
   ├─ MobileBottomNav        Home · Earn · Deals · Network · More
   ├─ Quick-action FAB       persistent, opens the action drawer
   ├─ MobileQuickAction      slide-up drawer of fast actions
   └─ MobileMoreMenu         slide-up sheet: workspace, account, billing, sign-out
   plus MobileInstallPrompt + ServiceWorkerRegister
```

### New routes

- **`/home`** — the Mobile App Home / Command Center. A server component that
  reuses existing auth + Supabase queries (deals, approvals, workflows, inbox)
  and renders card-first. Auth-gated by the shared layout. On desktop it renders
  as a focused centered column (harmless; the bottom nav that targets it is
  mobile-only).
- **`/offline`** — static offline fallback served by the service worker.

### Component map (`components/mobile/`)

|            File             |                           Role                           |
|-----------------------------|----------------------------------------------------------|
| `AppShellMobile.tsx`        | Mounts nav + FAB + drawers; owns open/close state        |
| `MobileBottomNav.tsx`       | 5-tab native bottom bar with active + badge states       |
| `MobileQuickAction.tsx`     | Quick-action drawer (Ask Earn, Add deal, Upload…)        |
| `MobileMoreMenu.tsx`        | "More" sheet: workspace, relationships, account          |
| `MobileSheet.tsx`           | Reusable slide-up sheet (scrim, Esc, scroll-lock, focus) |
| `MobileCommandCenter.tsx`   | Home screen composition                                  |
| `MobileEarnPanel.tsx`       | AI-first Earn entry point (input + prompt chips)         |
| `MobileDealCard.tsx`        | Scannable, tappable deal card                            |
| `MobileContactCard.tsx`     | Relationship/network card                                |
| `MobileWorkflowCard.tsx`    | Active workflow / delegated-task card w/ progress        |
| `MobileApprovalCard.tsx`    | Approval card w/ risk level + review CTA                 |
| `MobileCommandCard.tsx`     | Stat tiles + "recommended next action" hero              |
| `MobileSectionHeader.tsx`   | Standard section heading w/ "See all"                    |
| `MobileInstallPrompt.tsx`   | Add-to-Home-Screen nudge (beforeinstallprompt)           |
| `ServiceWorkerRegister.tsx` | Registers the app-shell SW (production only)             |
| `icons.tsx`                 | Dependency-free inline SVG icon set                      |
| `nav-config.tsx`            | Single source of truth for tabs / quick actions / more   |
| `format.ts`                 | Currency, relative-time, initials helpers                |

### Navigation model

- **Bottom tab bar** for the five primary sections (Home, Earn, Deals, Network,
  More). Every tab deep-links to a real, existing route.
- **Quick-action FAB** floats above the bar — the fastest way to start work.
- **Slide-up sheets** for quick actions and the More menu; **action-sheet**
  ergonomics (drag handle, scrim, Escape, scroll-lock).
- **No desktop sidebar** is forced onto mobile; **no large tables** — the deal,
  contact, workflow, and approval surfaces are card-based.

### Isolation guarantees

- All chrome is `md:hidden`; the desktop sidebar remains `hidden md:flex`.
- The floating Earn dock and download banner are wrapped desktop-only so they
  never overlap the bottom nav.
- The service worker is **production-only**, never touches `/api/*` or `/auth/*`
  or non-GET requests, and is network-first for navigations (never serves stale
  app logic). It cannot affect the web/desktop experience.

---

## 3. Look & feel

Reuses the existing executive design system (`app/globals.css`,
`tailwind.config.ts`): dark navy default, gold + electric-blue accents, Space
Grotesk / DM Sans / JetBrains Mono. Added mobile utilities: safe-area padding
(`pb-safe`, `pb-appnav`), the glass bottom bar (`fx-appnav`), sheet/scrim
entrances, the FAB aura (`fx-fab`), and touch ergonomics (`fx-tap`). All
respect `prefers-reduced-motion` and both light/dark themes.

---

## 4. PWA / install

- **Manifest** (`app/manifest.ts`): id, scope, `portrait`, `display_override`,
  categories, app shortcuts (Ask Earn / Deals / Approvals), and `start_url`
  `/home` so installs open into the command center.
- **iOS**: `appleWebApp` (capable, black-translucent status bar) +
  `viewport-fit=cover` for edge-to-edge safe-area rendering.
- **Install prompt** (`MobileInstallPrompt`): uses `beforeinstallprompt`,
  hidden when already standalone, resurfaces every 21 days.
- **Offline**: app-shell service worker (`public/sw.js`) with a branded
  `/offline` fallback and stale-while-revalidate for static assets.

---

## 5. QA checklist

- [x] Desktop layout unchanged (sidebar `hidden md:flex`, top bar intact)
- [x] Mobile chrome only renders below `md` (all `md:hidden`)
- [x] Bottom nav: 5 tabs, active states, approvals badge, deep-links resolve
- [x] Quick-action FAB opens the action drawer; every action routes to a real page
- [x] More sheet: workspace / relationships / account / sign-out all wired
- [x] Command center loads real data (deals, approvals, workflows, inbox)
- [x] Earn entry point routes to `/earn` (question surfaced via `?ask=`)
- [x] Deal / contact / workflow / approval cards render summary-first, tappable
- [x] Sheets: scrim, drag handle, Escape, body scroll-lock, focus capture
- [x] No horizontal scroll; large (≥44px) touch targets
- [x] Safe-area padding clears the notch / home indicator
- [x] PWA manifest valid; install prompt + offline fallback work
- [x] Auth still gates `/home` (redirects to `/login` when signed out)
- [x] `tsc --noEmit` clean · `eslint` clean · `next build` succeeds

---

## 6. Before / after

|                      |          Before           |                   After (mobile)                   |
|----------------------|---------------------------|----------------------------------------------------|
| Primary nav on phone | Hamburger slide-over only | Native bottom tab bar + FAB                        |
| Landing              | `/workspace` list         | `/home` command center ("what needs me now?")      |
| Earn                 | Floating dock (overlaps)  | Primary tab + FAB + home input                     |
| Deals / approvals    | Desktop panels            | Summary-first cards                                |
| Start an action      | Navigate through menus    | One-tap quick-action drawer                        |
| Install              | Basic manifest            | Shortcuts, install prompt, offline, iOS status bar |
| Desktop / web        | —                         | **Unchanged**                                      |

---

## 7. Destination pages — responsive records

The tab destinations reached from the bottom nav are mobile-native too:

- **Deals** (`/deals/feed`) is already a vertical card feed; its intelligence
  widgets (sector heatmap, signal feed) scroll inside their own containers, so
  the page never scrolls horizontally.
- **Network / CRM and every table-backed module** (`/source/network`,
  `lp_pipeline`, `deal_pipeline`, partners, providers, debt, …) render through
  the shared `components/ModuleTable.tsx`. It is now **responsive**: the dense
  table shows at `md`+ (unchanged), and below `md` each record becomes a
  tappable card — title + key facets in a 2-column grid, the AI-sourced /
  verified badges, and a tap-to-expand body with full fields, the LP war-room
  drill-down, provenance meta, and the verify / archive / delete lifecycle
  actions. No horizontal scroll; the desktop table is byte-for-byte the same,
  just wrapped `hidden md:block`.

This single `ModuleTable` change makes the record grids across the Source, Run,
and Execute hubs phone-usable at once, rather than converting each page.

### Later (not in this pass)

Per-record hero pages (deal detail, contact detail) could adopt the dedicated
`MobileDealCard` / `MobileContactCard` layouts for an even richer one-record
view; the current pass makes every list surface usable one-handed.

---

## 8. App-native gestures & feedback

A layer of one-handed, native-feel interactions — all mobile-only, all
progressive enhancements over the accessible base:

- **Auto-hiding chrome** (`useHideOnScroll`): the bottom nav and quick-action
  FAB slide out of the way while the user scrolls down to read and return the
  instant they scroll up (and are always shown near the top). Maximizes content
  on a small screen; a sheet being open pins the chrome so it never vanishes
  mid-interaction. Listens to the `<main>` scroll container (which is
  `overflow-y-auto`, so window scroll never fires) via a rAF-throttled,
  passive listener. Hidden chrome is also removed from the tab order.
- **Swipeable deal cards** (`SwipeableCard`): swiping a `MobileDealCard` left
  reveals one-tap **Task · Docs · Ask Earn** actions. Horizontal drags are
  captured by the component while vertical scrolling stays native via
  `touch-action: pan-y` — the gesture never fights the page scroll, and no
  `preventDefault` is needed. Tap still opens the deal when closed; a tap
  dismisses the actions when open. The underlying `<Link>` remains the full
  keyboard / screen-reader target, so the gesture is purely additive.
- **Haptic feedback** (`haptic`): a light tick on FAB open, tab taps, quick
  actions, and swipe commit, via the Vibration API where supported (Android /
  Chromium; a silent no-op on iOS). Suppressed under `prefers-reduced-motion`.
- **Instant skeleton** (`app/(app)/home/loading.tsx`): the command center
  paints a layout-matched skeleton immediately while its server queries resolve,
  instead of blocking on data — app-native perceived speed with no layout shift.

All four are verified at a 390px touch viewport (auto-hide toggles on
scroll direction; a real CDP swipe reveals the action strip; no horizontal
overflow; no console errors). Desktop / tablet never mount any of it.

---

## 9. Command-center landing revision

The `/home` landing (the PWA `start_url`) was revised into a more premium,
mobile-first executive surface:

- **Executive hero** — an avatar/initials mark, the date, a time-aware greeting,
  and a thumb-reachable notifications bell (unread dot → `/inbox`), over a subtle
  gold/blue ambient wash.
- **Digest line** — a single scannable summary of what's on the plate
  (e.g. "3 to approve · 4 in motion · 12 active deals · 6 unread"), so the
  answer to "what needs me?" is legible before any scroll.
- **Reordered for focus** — the single recommended next action now sits directly
  under the Earn panel, above the snapshot tiles, so the most important thing is
  above the fold.
- **Pull-to-refresh** (`PullToRefresh`) — pull down at the top of the command
  center to re-run its server queries. Attaches to the `<main>` scroll
  container, engages only at `scrollTop 0` on a downward drag (so it never
  fights scrolling), shows a gold spinner that arms past the threshold with a
  haptic tick, and calls `router.refresh()` on release. The skeleton
  (`home/loading.tsx`) mirrors the new hero to avoid layout shift.

Verified at a 390px touch viewport: the hero + digest render, a real CDP
downward drag reveals the refresh spinner (`translateY`), no horizontal
overflow, no console errors.

---

## 10. Deal detail — thumb-reachable actions

The per-deal war room (`/deal/[id]`) is already single-column and responsive
(`max-w-4xl`, `grid-cols-1 lg:grid-cols-2`), so it reads well on a phone. What
it lacked was **one-handed** access to the deal's common moves. Added a
`md:hidden` sticky action bar (`MobileDealActionBar`) pinned just above the
bottom tab bar with **Ask Earn** (next-step prompt, deal-named), **Data Room**
(`/deal/[id]/room`), and **Diligence** — so those actions are reachable by
thumb without scrolling. The deal page renders a matching `md:hidden` spacer so
no war-room content hides behind the bar; desktop keeps the war room's own
controls untouched. Verified at a 390px viewport (renders, no horizontal
overflow, no errors).

---

## 11. LP / contact detail — thumb-reachable actions

The per-LP war room (`/investor/[id]`) gets the same treatment as the deal
detail: a `md:hidden` sticky action bar (`MobileContactActionBar`) pinned above
the bottom tab bar, mirroring the deal bar's shape. It **adapts to the
contact's details** — **Ask Earn** (a "draft the next outreach" prompt) is
always present; **Email** (`mailto:`) and **Call** (`tel:`) appear when the LP
has a contact address / number, otherwise a **Follow up** task fills the slot —
capped at three so it stays one-handed. The page renders a matching `md:hidden`
spacer; desktop keeps the war room's own controls. This satisfies the Network
spec's "email / call / link actions where appropriate." Verified at a 390px
viewport (the Email + Call variant renders `mailto:` / `tel:` actions, no
horizontal overflow).
