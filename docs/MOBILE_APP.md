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
- **Network / CRM and every table-backed module** (`/network`,
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

---

## 12. Approvals — a swipe-to-decide flow

A dedicated on-the-go surface for the "decide & approve" job: **`/approvals`**
(`MobileApprovalsFlow`). Instead of the desktop inbox's list, it's a
one-at-a-time **decision card stack** built for clearing sign-offs between
meetings:

- **Swipe right to approve, left to reject** (with buttons mirroring both for
  accessibility, plus a "request revision" note that sends work back to Earn).
- Each card shows the owning agent, a **risk badge**, what the item does, and a
  preview of **what Earn produced**, with a segmented progress bar (`2 / 5`).
- **High-sensitivity items** (outward-facing / capital-moving — the Execute
  hub) require an explicit **confirm sheet** before approving; a swipe alone
  never clears them.
- **Optimistic**: the decision is captured server-side (via `decideApproval`,
  the same engine entrypoint as the desktop inbox and `/api/approve`) while the
  UI advances, so a stack clears instantly even though approved work executes
  async. Ends on a "Cleared." summary.

Wired in everywhere it belongs: the Earn home's Live Pulse "Approvals" tile,
the home approval cards' "Review & decide", the More menu, and the PWA
"Approvals" app-shortcut all deep-link to `/approvals`. The desktop inbox and
its approval controls are untouched. Verified at a 390px viewport: the card
renders, a full pointer-drag past threshold and the button path both decide and
advance, the high-sensitivity confirm gate fires, no horizontal overflow, no
console errors.

---

## 13. Fortification — connectivity & resilient actions

On-the-go operators move through dead zones constantly, so the app is hardened
to stay honest when the network isn't there:

- **Connectivity awareness** (`useOnline`, `OfflineBanner`): a slim banner above
  the tab bar appears the moment the device goes offline ("You're offline —
  we'll reconnect and sync automatically") and clears on reconnect. `md:hidden`.
- **Mobile toast system** (`MobileToastProvider` / `useMobileToast`): a
  lightweight, stacked, auto-dismissing feedback channel above the tab bar,
  mounted for the whole authed app. Supports an action (e.g. **Retry**). The
  desktop keeps its own CoachingToast; this is mobile-only.
- **Resilient approvals** (`MobileApprovalsFlow`): the swipe-to-decide flow no
  longer silently swallows failures. If the device is **offline**, a decision is
  **blocked** with a clear toast — the operator never thinks they cleared
  something that never reached the server. When online, decisions stay optimistic
  (the stack advances instantly) but a dropped request now surfaces a
  **"Couldn't submit … · Retry"** toast that re-fires the exact decision, so
  nothing is lost on a flaky connection. A brief success toast confirms each
  decision sent.

Verified at a 390px viewport with Playwright offline emulation: the banner shows
on `offline` and hides on `online`; approving while offline is blocked (the card
does not advance) and raises the error toast; no horizontal overflow, no console
errors. Desktop/tablet mount none of it.

---

## 14. Deeper resilience — retry-on-reconnect queue & session guard

Two further fortifications for on-the-go reliability, built in parallel:

- **Durable offline queue** (`offlineQueue.ts`, `MobileSyncRegistrar`): a small
  action queue persisted to `localStorage` so nothing is lost across dead zones
  or reloads. The approvals flow now routes **every** decision through it — the
  queue runs it immediately when online, holds it and **auto-flushes on
  `reconnect`** when offline, and **retries on failure**. The card advances
  instantly either way (no more hard block), and the connectivity banner
  doubles as a **sync indicator**: "… N changes will sync when you reconnect"
  offline, "Syncing N changes…" online. Executors are registered app-wide
  (`MobileSyncRegistrar` in the app shell) so queued work flushes on reconnect
  regardless of the current screen — even after a reload.
- **Session guard** (`SessionGuard` + `GET /api/session/check`): mobile users
  resume the app from the background constantly. The guard re-checks the session
  (cookie-based) on mount, on `visibilitychange`→visible, and on `online`
  (debounced, skipped while offline); if the session has expired it shows a
  blocking **"Session expired · Sign back in"** overlay instead of letting
  actions fail silently. `md:hidden`; the desktop app is unaffected.

Verified at a 390px viewport with Playwright offline emulation: deciding while
offline advances the stack and shows the "will sync" banner, which flips to
"Syncing…" on reconnect; the session-check route returns 401 unauthenticated and
the guard overlay renders. `tsc`/`eslint`/`build` clean; no console errors.

---

## 15. Accessibility & motion hardening

A focused pass on the interactive mobile surfaces (the original spec's
Accessibility section), built in parallel across disjoint files:

- **Screen-reader announcements**: the approvals flow now has an `sr-only`
  `aria-live="polite"` region that announces each decision + remaining count
  ("Approved. 2 of 5 remaining." / "…Cleared."); the current card is a labeled
  `role="group"` with `aria-roledescription="approval card"`; the segmented
  progress is a `role="progressbar"` with `aria-valuenow/min/max`; the
  swipe-intent overlays are `aria-hidden`.
- **Toasts**: the host is `aria-live="polite"`; error toasts escalate to
  `role="alert"` / `aria-live="assertive"` so failures are announced promptly.
- **Landmarks**: the Earn home thread is a labeled `role="region"`
  ("Conversation with Earn").
- **Reduced motion** (`app/globals.css`): under `prefers-reduced-motion: reduce`
  the mobile chrome is quieted — the bottom nav, FAB, and sheet/scrim entrances
  drop their animations/transitions — scoped strictly to the app-shell classes
  so desktop/web motion is unchanged.
- **Touch targets**: a `.fx-min-tap` (44×44px) utility is available for icon
  controls; audit confirmed the existing icon-only buttons already carry
  `aria-label`s, sheets are `role="dialog"`/`aria-modal` with labeled close
  buttons, swipe action strips toggle `tabIndex`, and decorative glyphs are
  `aria-hidden` — so only three components needed changes.

Verified at a 390px viewport: the ARIA roles/live regions render, and with
Playwright `reducedMotion: "reduce"` the nav/FAB transition durations resolve to
`0s`. `tsc`/`eslint`/`build` clean; no console errors. Desktop untouched.

## 16. Perf split + reviewable offline queue

Two more fortifications, built in parallel across disjoint files, then
integrated:

- **Lighter initial bundle** (`AppShellMobile.tsx`): the two slide-up drawers —
  the quick-action FAB sheet (`MobileQuickAction`) and the More menu
  (`MobileMoreMenu`) — are now `next/dynamic({ ssr: false })` imports rendered
  only once opened (`{quickOpen && …}` / `{moreOpen && …}`). Their code is split
  out of the initial mobile JS and fetched on first tap. Props and behavior are
  identical; `ssr: false` is safe because both return `null` while closed.
- **Hardened offline queue** (`offlineQueue.ts`): `enqueue` now **dedupes** by
  `type` + serialized payload (a double-tap on a flaky connection can't
  double-submit), **caps** the buffer at `MAX_ITEMS = 100` (drops oldest), and
  **expires** actions older than `MAX_AGE_MS = 24h` on load, enqueue, and flush —
  replaying a day-old "approve" on reconnect would be surprising, so expiry beats
  blind retry. New API: `getItems()`, `remove(id)`, `useQueueItems()`,
  `registerLabeler(type, fn)`, `labelFor(item)`. All prior exports preserved.
- **Reviewable pending sync** (`MobilePendingSheet.tsx`): a `MobileSheet` listing
  every queued action with a human label, a "Retry all now" button, and per-item
  dismiss. Empty state: "You're all synced." Labels come from `labelFor`; the
  approvals executor registers a labeler in `MobileSyncRegistrar` so a queued
  decision reads as "Approve: Series B — Acme" rather than a raw type string.
- **Tappable banner** (`OfflineBanner.tsx`): when there is queued work the banner
  becomes a button (with a "Review" affordance) that opens the pending-sync
  sheet; with nothing queued it stays a plain `role="status"` notice. Offline vs.
  syncing copy is unchanged.

Verified at a 390px viewport with Playwright under `context.setOffline(true)`:
seeding two unique decisions plus one duplicate yields a "2 changes" banner
(dedupe held), tapping opens the sheet with the humanized "Approve: …" /
"Reject: …" labels, and per-item dismiss drops a row. `tsc`/`eslint`/`build`
clean. All new surfaces are `md:hidden`; desktop/web untouched.

## 17. Hands-free voice + resilient screens

Two more on-the-go fortifications, built in parallel across disjoint new files
and then integrated:

- **Voice dictation to Earn** (`useSpeechInput.ts`, `MicButton.tsx`): the
  "Message Earn" composer on the home screen now has a mic. An exec walking
  between meetings can tap it, speak an ask, and have the transcript land in the
  composer without typing. `useSpeechInput` is a thin, SSR-safe wrapper over the
  Web Speech API's `SpeechRecognition` (`interimResults`, single-shot,
  `en-US`), exposing `{ supported, listening, start, stop, error }` and mapping
  error codes to human copy ("Microphone permission denied", "Didn't catch
  that"). `MicButton` renders **nothing** when the API is unavailable — SSR,
  headless, Firefox, many in-app webviews — so unsupported browsers just see no
  mic rather than a dead control; while listening it shows a pulsing
  `status-danger` affordance and `aria-pressed`. Final transcripts are appended
  to whatever is already typed (`MobileEarnHome`); interim results stream via an
  optional callback.
- **Mobile error boundary** (`MobileErrorBoundary.tsx`): a compact, recoverable
  React error boundary. When a client component in a mobile subtree throws during
  render, the operator sees an inline `role="alert"` card — "This screen hit a
  snag" + a "Try again" button that bumps a key to remount the subtree — instead
  of the heavy full-page route fallback in `app/(app)/error.tsx`. The app shell
  (tab bar, nav) stays intact so a single misbehaving screen can be retried
  without a full reload. The home screen wraps `MobileEarnHome` in it
  (`<MobileErrorBoundary label="home">`). It's safe on desktop: rendering only
  changes when an error is actually thrown, and the styling is neutral/tokenized.

Verified at a 390px viewport with Playwright: with the Speech API stubbed out the
mic is absent; forcing a child render throw shows the "This screen hit a snag"
card and "Try again" recovers the subtree; with the Speech API stubbed in, the
mic renders and a simulated final result lands the dictated text in the composer.
`tsc`/`eslint`/`build` clean. Desktop/web untouched.

## 18. Native gestures — keyboard-aware composer & re-tap-to-top

Two more native-feel touches, built in parallel across disjoint new hook files
and then integrated:

- **Keyboard-aware composer** (`useKeyboardInset.ts`): a small SSR-safe hook that
  reports how many pixels at the bottom of the layout are currently covered by
  the on-screen keyboard, computed from the `visualViewport` (layout height −
  visual height − offset, with sub-24px jitter treated as 0). `MobileEarnHome`
  translates the fixed "Message Earn" composer up by that amount
  (`translateY(-inset)`, `transition-transform`) so on-the-go typing is never
  hidden behind the keys. Returns 0 when the API is unavailable or on the
  server — no lift, i.e. no change from before.
- **Re-tap active tab → scroll to top** (`useTabReselect.ts`): the native iOS/
  Android affordance. `MobileBottomNav` calls the returned handler on every tab
  tap; when the tapped destination is the route you're already on and the page
  is actually scrolled, it smooth-scrolls to the top (instant under
  `prefers-reduced-motion`) with a light haptic. Any other tab is a no-op so
  normal `Link` navigation proceeds untouched.

Verified at a 390px viewport with Playwright: with a stubbed `visualViewport`,
opening a 300px "keyboard" sets the inset to 300 and lifts the composer by
exactly `translateY(-300px)`, resetting to 0 on close; re-tapping the current
route scrolls a scrolled page back to the top while re-tapping a different route
leaves the scroll position untouched. `tsc`/`eslint`/`build` clean. Both hooks
are mobile-only in use; desktop/web untouched.
