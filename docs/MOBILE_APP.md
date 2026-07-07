# FundExecs OS — Mobile / App Experience

A dedicated **mobile app layer** for FundExecs OS. It turns the responsive web
app into an app-native experience on phones — bottom tab navigation, a command
center home, an Earn-first entry point, quick actions, and PWA install — **without
changing the desktop or web experience at all**.

Everything here is isolated behind the `md` breakpoint (768px) or lives on
dedicated app routes. Desktop (≥1024px) and tablet (768–1023px) render exactly
as before.

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
| File | Role |
|------|------|
| `AppShellMobile.tsx` | Mounts nav + FAB + drawers; owns open/close state |
| `MobileBottomNav.tsx` | 5-tab native bottom bar with active + badge states |
| `MobileQuickAction.tsx` | Quick-action drawer (Ask Earn, Add deal, Upload…) |
| `MobileMoreMenu.tsx` | "More" sheet: workspace, relationships, account |
| `MobileSheet.tsx` | Reusable slide-up sheet (scrim, Esc, scroll-lock, focus) |
| `MobileCommandCenter.tsx` | Home screen composition |
| `MobileEarnPanel.tsx` | AI-first Earn entry point (input + prompt chips) |
| `MobileDealCard.tsx` | Scannable, tappable deal card |
| `MobileContactCard.tsx` | Relationship/network card |
| `MobileWorkflowCard.tsx` | Active workflow / delegated-task card w/ progress |
| `MobileApprovalCard.tsx` | Approval card w/ risk level + review CTA |
| `MobileCommandCard.tsx` | Stat tiles + "recommended next action" hero |
| `MobileSectionHeader.tsx` | Standard section heading w/ "See all" |
| `MobileInstallPrompt.tsx` | Add-to-Home-Screen nudge (beforeinstallprompt) |
| `ServiceWorkerRegister.tsx` | Registers the app-shell SW (production only) |
| `icons.tsx` | Dependency-free inline SVG icon set |
| `nav-config.tsx` | Single source of truth for tabs / quick actions / more |
| `format.ts` | Currency, relative-time, initials helpers |

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

| | Before | After (mobile) |
|---|---|---|
| Primary nav on phone | Hamburger slide-over only | Native bottom tab bar + FAB |
| Landing | `/workspace` list | `/home` command center ("what needs me now?") |
| Earn | Floating dock (overlaps) | Primary tab + FAB + home input |
| Deals / approvals | Desktop panels | Summary-first cards |
| Start an action | Navigate through menus | One-tap quick-action drawer |
| Install | Basic manifest | Shortcuts, install prompt, offline, iOS status bar |
| Desktop / web | — | **Unchanged** |

---

## 7. Follow-ups (not in this pass)

The Deals (`/deals/feed`) and Network (`/source/network`) destination pages
still use their existing responsive layouts. The reusable `MobileDealCard` /
`MobileContactCard` components are ready to be dropped into mobile-specific
renders of those pages when desired — this pass wires navigation and the
command center; converting each destination's internals to cards is a safe,
incremental next step.
