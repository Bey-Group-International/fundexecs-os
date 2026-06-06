# Emergent Brief — FundExecs OS (Net-New UI Lane)

> Paste this whole file to Emergent as its working prompt. Read
> `FUNDEXECS_BUILD_PLAN.md` first for the full program context. The bundled
> prototype you produced is the **visual reference** — we are porting its ideas
> into the live app's design system, not dropping the bundle in.

## Who you are

You are **Emergent**, owning the **net-new UI lane**. Claude owns
app/Earn/data/auth and reviews+merges your work; Codex owns backend/data. Build
UI against **typed props + placeholder data**; Claude wires the real data.

## Hard rules (non-negotiable)

- Work on branches named `emergent/<feature>`. Open a **draft PR** to `main`.
- CI gate must pass: `npm run format:check`, `typecheck`, `lint`, `build`.
- **Do NOT touch** auth/session (`lib/supabase/*`, `proxy.ts`,
  `app/login/*`, `lib/queries/auth.ts`), middleware, migrations, or the
  integrations OAuth code. UI only.
- Use the **existing design system**: tokens in `app/globals.css` (`--bg-*`,
  `--surface-*`, `--fg-*`, gold/azure), the `@/components/ui` primitives, the
  `AppShell`, `EarnOrb`/`EarnDock`, and `TeamAvatar`/`EarnCoin`. Match the
  current dark/light theming. Overlays/drawers use solid `bg-bg-1` (never the
  translucent surfaces — that was a fixed legibility bug).
- No new heavy deps without flagging in the PR.

## Your tasks (priority order)

### Task A — Demo dashboard + unified side rail

1. **Merge the two side rails into ONE** intentional nav — the current `AppShell`
   rail combined with the demo's rail. Single source of nav items; keep the live
   routes (`/command-center`, `/pipeline`, `/connections`, `/integrations`,
   `/strategy`, `/notifications`, `/settings`).
2. **Per-user-type desks** — extend the existing
   `app/command-center/layouts/*` (InvestmentFirm, ServiceProvider, Startup,
   Student, IndividualInvestor) + `MemberDashboardChrome` so each member type
   gets a purpose-built dashboard adopting the demo's visual language. Keep the
   `ChainOfTrustStrip` + `EarnNextBestActions` already wired in chrome.
3. Bring the demo's polish (cards, spacing, hero) into these via the design
   tokens — no inline hex, no new color system.

### Task B — LP Room / Fund Room (for BGI Fund I)

New route `app/lp-room/` (UI only): fund overview, document vault list, update
feed, commitment tracker, and an **LP Q&A surface** (Earn answers from approved
materials only — render the chat shell; Claude wires the API). Drive everything
from typed props with placeholder fixtures; export the prop types so Claude can
supply real data.

---

## 🛑🛑🛑 STOP-AND-SAVE CHECKPOINT — DO NOT PASS THIS LINE 🛑🛑🛑

**[[EMERGENT: STOP HERE]]**

When **Task A is complete and Task B's LP Room shell renders with placeholder
data**, you are **DONE for this pass**. Do the following and then **STOP**:

1. Ensure CI is green locally (`format:check`, `typecheck`, `lint`, `build`).
2. Commit your work and **push to `emergent/dashboard-lp-room`**.
3. Open a **draft PR** to `main` titled
   `feat(ui): demo dashboard + unified side rail + LP Room shell`.
4. In the PR body, list: the prop/type contracts you need Claude to wire, any
   placeholders/fixtures used, and screenshots.
5. **Do not** wire real data, **do not** touch auth/backend, **do not** merge,
   **do not** start any further modules. Wait for Claude's review.

_Everything below this line is for the NEXT pass, only after Claude reviews and
gives the go._

---

## Next pass (after review — do NOT start yet)

- Wire LP Q&A to the real Earn endpoint (Claude provides it).
- Target Company Scout UI, Business Submission Intake UI, ⌘K command palette.

## Definition of done (this pass)

Unified side rail + per-user-type dashboards adopting the demo look, and an LP
Room shell rendering from placeholder props — all behind a green-CI draft PR on
`emergent/dashboard-lp-room`, stopped at the checkpoint above.
