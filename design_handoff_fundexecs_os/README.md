# Handoff: FundExecs OS — Private-Market Command Center

## Overview
FundExecs OS is an AI-native private-market command center for Bey Group International — a dark, institutional fintech product (peers: Linear, Vercel, Ramp, Carta). This package documents the **design system, web app, mobile apps, investor deck, and LP materials** so a developer can implement them in the production stack (**Next.js + React 19 + Tailwind v4 + Supabase**, per the `fundexecs-os` repo).

## About the Design Files
The files in this bundle are **design references created in HTML/JSX-via-Babel** — prototypes that show intended look, layout, and behavior. They are **not production code to copy verbatim**. The task is to **recreate them in the existing Next.js codebase** using its established patterns (React Server/Client Components, Tailwind v4 tokens, `lucide-react`, Supabase). Lift the exact values (hex, spacing, type, radii) from `colors_and_type.css` and the components; re-implement the structure idiomatically.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, iconography, and interactions are settled. Recreate pixel-faithfully. The single source of truth for tokens is **`colors_and_type.css`** (included here) — port it to Tailwind v4 `@theme` variables.

---

## Design Tokens (port to Tailwind `@theme`)
**Color — base canvas (dark, the default theme)**
- `--bg-0 #070b14` (app base) · `--bg-1 #0a0f1c` (sidebar/panels) · `--bg-2 #0d1424` · `--bg-3 #121a2c`
- Surfaces are **white-alpha**: `--surface-1 rgba(255,255,255,.035)` · `-2 .055` · `-3 .085`
- Borders: `--border rgba(255,255,255,.085)` · `--border-strong .20` · `--border-faint .05`
- Text ramp (slate): `--fg-1 #ffffff` · `--fg-2 #cbd5e1` · `--fg-3 #94a3b8` · `--fg-4 #64748b` · `--fg-5 #475569`

**Accent system (decision: option B)**
- **Primary accent = institutional blue** `--accent #2563EB` (hover `#1D4ED8`); primary CTAs use gradient `linear-gradient(135deg,#3B74F0,#2152D8)` + glow `0 8px 18px -8px rgba(37,99,235,.55)`.
- **Gold is reserved for Earn + gamification only**: `--gold-1 #F7C948` / `--gold-2 #E5A823`.
- Azure (chips/routing) `#5B8DEF`; cyan `#22D3EE`.
- Semantic: success `#34D399` · warning `#FBBF24` · danger `#FB7185` · info `#38BDF8` (each has `-soft` 12% fill + `-line` 30% border).
- Chain-of-Trust layer hues: Truth `#38BDF8` · Concept `#A78BFA` · Execution `#FBBF24` · Work `#34D399`.

**Typography** — **Geist** (sans) + **Geist Mono** (loaded from Google Fonts; confirm licensed/self-hosted in prod). Headings semibold with tight tracking: display 56px/-.025em, h1 30/-.02, h2 20/-.015, h3 16/-.01; body 14/1.62; eyebrow 10.5px 600 uppercase .11em; metrics use `font-feature-settings:'tnum'`.

**Radii** 8 / 12 (xl, inputs/buttons/chips) / 16 (2xl, cards) / pill. **Spacing** 4px grid. **Shadows** soft + low-opacity black with a `inset 0 1px 0 rgba(255,255,255,.05)` top highlight; gold glow for Earn.

**Light/day theme** — `:root[data-theme="light"]` overrides in `colors_and_type.css` (white/slate surfaces, dark text, blue+gold preserved). App toggles via a topbar sun/moon button persisting to `localStorage('fx-theme')`. Note: keep color **transitions instant** (don't transition `color`) or theme flips can stick.

**Icons** — **Lucide** only (outline, ~1.9px stroke, inherit text color). Never emoji/hand-drawn SVG. In prod use `lucide-react`.

**Assets** — `assets/earn-coin.png` is the **Earn** mascot (Earnest Fundmaker), always circular (white disc, `border-radius:50%`, overflow hidden, image at 124%). The wordmark "FundExecs OS" (Geist 600) is the logo.

---

## Voice & naming
Institutional, declarative, sentence-case. Product nouns are Title Case: Command Center, Ask Earn, Chain of Trust, Proof of Truth/Concept/Execution/Work, 100/30/10 Strategy Plan, Synergy alerts. **Earn convention:** first mention "Earnest Fundmaker, your Private Market Assistant," shorthand "Earn" after.

---

## Screens / Views

### Desktop web app — `ui_kits/fundexecs-os/`
App shell = left **sidebar** (244px, brand + org switcher + nav + user footer) · sticky **topbar** (title, search, theme toggle, **Earn coin wallet**, notifications bell) · fluid workspace (`max-width:1180px`). Floating circular **gold Earn orb** (bottom-right) opens the Copilot dock.

- **Auth** (`Auth.jsx`) — two-column split: left value panel (headline, trust metrics $612M/500+/4-layer, Earn footer), right form card (email/password, Google, forgot password, forgot email collecting name+org+phone, sign up). Company-aware: `@beygroupintl.com` → Admin Portal; new user → onboarding. Collapses to single card under 880px.
- **Onboarding** (`Auth.jsx` `OnboardingFlow`) — 4-step stepper (Identity → Role → Socials → Review), gold progress, +150 XP on completion.
- **Command Center** (`Dashboard.jsx`) — **flagship screen**: Earn briefing (glow coin + live status + 3 ranked priorities with impact/brain/action), 4 KPI cards with tone sparklines, deal-flow table, synergy-alerts feed (pulse "Live"), Fund Readiness path, Chain-of-Trust mini, ecosystem panels (LP allocations / capital providers / partnerships).
- **Ask Earn** (`Copilot.jsx`) — Earn presence band + command bar; task manager (open/completed/archived, each task has an Earn AI note, mark-read/archive/delete/complete); side rail: recommended steps, 15 active brains, creative actions. Plus the slide-in **CopilotDock** (orb routes, command layer, conversation, **brain switcher** that consults any of 15 knowledge brains with citations).
- **Strategy** (`Governance.jsx`) — 100/30/10 plan: Earn band, horizon summary (gold/blue/green), notification-style objective cards (tier, priority, objective, timeline/owner/%, AI rec, close/archive/delete/read/complete). Completing fires a Chain-of-Trust toast.
- **Pipeline** (`Pipeline.jsx`) — Earn band + 4 summary stats; tabs: Capital-formation kanban (8 stages, avatar cards), LP Capital Map (relationship + fit scoring), deal flow, partners & capital stack.
- **Notifications** (`Notifications.jsx`) — categorized inbox, mark-read/archive/delete + detail modal.
- **Admin Portal + Knowledge Base** (`Admin.jsx`, Bey Group only) — user approval queue/roles/archive, activity, platform notifications, Chain-of-Trust oversight; Knowledge Base manages **15 AI brains** (pgvector stats, routing rules, upload) + intake→optimize flow.
- **Chain of Trust** (`Trust.jsx`) — **not a page**: an ambient toast layer (`window.emitTrust({layer,title,msg,pct,entity})`) fires on task completion; clicking a toast opens the full slide-over **detail panel** (4-layer pipeline, required docs/tasks, AI validation, human approval, timestamped activity).
- **Profile + Settings** (`Settings.jsx`) — gamification (level/XP/badges using statuses: Verified Operator, Execution Ready, Trust Layer Complete, Capital Matched, Institutional Grade) + account/notifications/security/org/billing.

### Mobile apps — `ui_kits/fundexecs-mobile/` (`index.html` Android, `ios.html` iOS, shared `app.jsx`)
Focused on-the-go subset, same dark system. Bottom tab bar with a center gold **Earn orb**: **Home** (Earn briefing, 2×2 KPIs, priorities, Chain-of-Trust mini) · **Pipeline** (deal flow / LP map toggle) · **Earn** (chat + orb routes + brain switcher + composer) · **Approvals** (approve/decline cards → fires trust toast) · **Alerts** (notifications). Same `app.jsx` mounts inside `AndroidDevice` and `IOSDevice` frames.

### Investor deck — `slides/index.html` (15 slides, `deck-stage.js`)
Cover · Executive Summary · Market · Thesis · Strategy · Platform · Chain of Trust · Track Record · Pipeline · Returns · Team · Fund Terms · Investor Relations · Close · Disclaimer. Dark brand system; gold/blue accents; tweakable (accent / heading font / content alignment / glow) via the panel. 1920×1080, keyboard nav, print-to-PDF, PPTX-export ready.

### LP materials — `materials/` (light/print-ready, `data-theme="light"`)
- `one-pager.html` — Letter tear sheet: stats, strategy & criteria, terms, value creation, Chain of Trust, pipeline.
- `lp-update.html` — quarterly LP letter: Earn "what changed" callout, KPI strip with QoQ deltas, deal-activity table, highlights & next-quarter focus.

---

## Interactions & Behavior
- Transitions ~.2s `cubic-bezier(.22,.61,.36,1)` on background/border/shadow/transform; **never transition `color`** (theme-flip robustness). Cards lift `translateY(-2px)` on hover. Press: subtle, no scale jump. Disabled: `opacity .5`.
- Entrance animations: visible end-state is the base; animate **transform only** (no opacity) so throttled tabs / print / reduced-motion always show content. Gate on `[data-deck-active]` + `prefers-reduced-motion`.
- Synergy "Live" dot and Earn status dot use a 2s opacity pulse.
- Chain-of-Trust toasts auto-dismiss ~6.8s, stack bottom-right above the orb, are clickable → detail drawer.

## State Management (prod mapping)
All prototype state is local React (`useState`). In prod, back with Supabase: route by `auth.users` email domain (`@beygroupintl.com` → `/admin/bey-group`, `fundexecstester@gmail.com` → tester, else onboarding→`/command-center`). Notifications/governance/copilot tasks carry `read_at/archived_at/closed_at/deleted_at` timestamptz states. Chain-of-Trust = event-sourced `proof_layers` rolling up a weighted completion %. Earn brain routing reads role/org/active deal/CoT layer and writes `copilot_tasks`, `synergy_opportunities`, `notifications`.

## Supabase data model
See the full DDL in the root `README.md` (Knowledge Base section) and the project brief: `organizations, users, roles, user_profiles, social_links, deals, allocations, partnerships, service_providers, capital_providers, governance_plans, governance_tasks, chain_of_trust_records, proof_layers, uploaded_evidence, copilot_tasks, synergy_opportunities, notifications, admin_actions` + knowledge layer (`ai_brains, knowledge_documents, knowledge_chunks` w/ `vector(1536)`, `brain_routing_rules, intake_items, copilot_actions, optimization_lessons`). The 15 brain knowledge files are in `knowledge/*.md` — chunk + embed for RAG.

## Files (in the downloadable project)
- `colors_and_type.css` — all tokens (included in this handoff folder too).
- `ui_kits/fundexecs-os/` — desktop app: `index.html` + `Primitives/Shell/Auth/Dashboard/Copilot/Trust/Governance/Pipeline/Notifications/Admin/Settings/Data/App.jsx` + `kit.css`.
- `ui_kits/fundexecs-mobile/` — `index.html` (Android), `ios.html`, `app.jsx`, `mobile.css`, frame components.
- `slides/index.html` (+ `deck-stage.js`, `tweaks-panel.jsx`), `materials/one-pager.html`, `materials/lp-update.html`.
- `knowledge/*.md` (15 brains), `assets/earn-coin.png`, `preview/*` (spec cards), `README.md`, `SKILL.md`.

> Read each referenced file for exact markup/values. Recreate in Next.js with Tailwind tokens and `lucide-react`; keep the dark theme primary, gold reserved for Earn, blue for primary CTAs.

---

## Screenshots (`screenshots/`)
Visual reference for every surface (capture at the design's standard desktop width ~1280px and mobile device frames; the desktop web app is built for ≥1280px and reflows the auth screen below 880px).

**Website — desktop**
- `04-desktop-auth.png` — two-column sign-in (value panel + form)
- `01-command-center.png` — Command Center (flagship, dark theme)
- `05-desktop-ask-earn.png` — Ask Earn task manager + brains + creative actions
- `06-desktop-pipeline.png` — Capital-formation pipeline + summary stats
- `07-desktop-strategy.png` — 100/30/10 Strategy plan
- `08-desktop-chain-of-trust.png` — Chain-of-Trust toast → detail slide-over
- `09-desktop-admin-knowledge.png` — Admin → Knowledge Base (15 brains)

**App — mobile**
- `02-mobile-android.png` — Android home (Command Center)
- `11-mobile-earn.png` — Android Ask Earn (orb routes + brain switcher)
- `12-mobile-approvals.png` — Android approvals
- `10-mobile-ios.png` — iOS home (same app in iOS shell)

**LP materials**
- `03-lp-one-pager.png` — print-ready Fund I tear sheet

Light/day theme: toggle in the topbar (sun/moon). Desktop full-screen (≥1440px) keeps the same 1180px centered content column with wider letterboxing; "minimized"/narrow desktop is not a primary target — the **mobile app** is the small-screen surface.
