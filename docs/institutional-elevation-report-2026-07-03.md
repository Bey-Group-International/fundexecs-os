# Institutional-Grade Elevation Report — FundExecs OS

**Date:** 2026-07-03
**Method:** Five specialized audit agents (QA, UX, Motion, Architecture, Native-First/Integrations) ran parallel deep-dives over the live codebase, followed by an adversarial verification pass that re-read the code behind every P0 claim and tried to refute it. Toolchain baseline (`tsc --noEmit`, `next lint`, `jest`) captured at head.
**Scope:** Next.js 14 (App Router) · React 18 · Tailwind · Supabase (Postgres + RLS) · Stripe · Anthropic SDK · in-repo mediasoup SFU (`server/`) · Phaser virtual office. ~65 app routes, ~296 `lib` modules, 138 migrations, 122 test suites / 1,446 tests.

> **Companion document:** the 2026-06-21 security inspection (`docs/full-stack-inspection-2026-06-21.md`) covers Next.js CVEs, CSPRNG referral codes, RLS defense-in-depth, and CI gaps. This report does **not** repeat those; it covers correctness, UX, motion, architecture, and native-first/integration readiness.

---

## Executive verdict

FundExecs OS is **materially more built than "pre-alpha" implies** and its engineering core is genuinely strong: the finance AR/AP + banking module is transaction-safe (atomic `fin_apply_payment` RPC with `FOR UPDATE` locks, `numeric(20,2)` money, double-entry balance triggers), RLS is enabled on ~70 tables, the prompt→plan→approve engine is coherent and auditable, and the toolchain is clean (tsc 0 errors, 1,446 tests green). The native-first thesis is real: deal pipeline, cap-table/waterfall math, relationship graph, native e-sign, and a self-hosted WebRTC SFU are all in-repo.

The gap to "institutional production-grade" is concentrated in **the edges where trust is made or destroyed**: the LP-facing data room, the integrations layer, real-time money movements, and the collaboration gateway. Eight P0 defects were confirmed on second-pass verification. They share a theme — **surfaces that *report* success while doing nothing, or that *look* protected while being open**. For the persona this product serves (GPs, allocators, IR), silent non-delivery and false protection are worse than honest failure.

**The five highest-value moves, in order:**
1. Make the data room gate **server-side** (today it is client-side theater; all content ships in the page payload).
2. Make integrations **honest** (today "Connect" mints a fake account and dispatches report "queued/sent" while nothing leaves).
3. Make capital calls/distributions **atomic** (today a per-LP loop with zero error checks can half-book money movements).
4. **Verify JWT signatures** on the SFU gateway (today it decodes-and-trusts — any forged token grants a seat + media).
5. Give every navigation and mutation **feedback** (today 52 async pages share one `loading.tsx`; route clicks read as a hang).

This PR **begins the build** by landing a focused, fully-tested first wave of these fixes (see *Blueprint-First Build Initiation* and the changelog at the end).

---

# Full-Stack Inspection Report

### Frontend findings

- **Strong interaction core, fractured shell.** The session Copilot, `EnvelopeWizard`, `CommandPalette`, and the hub/module registry (`lib/hubs.ts`) are reference-quality. But three parallel app shells (`AppSidebar`, `/dashboard/*` tab nav, `/command-center`) compete, and the name "Command Center" resolves to two different pages depending on path.
- **No mobile navigation.** `AppSidebar` is `hidden md:flex` and is the only primary nav; below 768px there is no drawer/hamburger. (Verifier corrected severity to P1 — a sessions/inbox/deals subset stays reachable via `TopNavAlerts`.)
- **Dead entry points.** Execute › Signing links every CTA to `/execute/signing/*` routes that don't exist (wizard lives at `/envelopes/*`); the dashboard command palette hardcodes 6 destinations that 404 against `lib/hubs.ts`.
- **Raw enums leak to users** (`fund_of_funds`, `ic_review`, `co_gp`) in selects and table cells; the same value renders three different ways across surfaces.

### Backend findings

- **Finance is the gold standard** and proves the team's own bar: `fin_apply_payment` RPC, optimistic-locked GL posting with auto-reversal, checksum-deduped bank imports, `fin_reconcile_txns`.
- **Capital events don't meet that bar.** `recordCapitalRun`/`recordSecondaryTransfer`/`recordValuationMark` (`components/execute/actions.ts`) loop unchecked inserts + JS read-modify-write and return `void`.
- **Void-returning, error-swallowing server actions** are a class: deal-lifecycle (`app/(app)/deal/[id]/actions.ts`), portfolio, execute — a failed insert silently re-renders the form unchanged.

### API findings

- **Two divergent response envelopes** (v1 `{data}` vs. internal ad-hoc bodies) and **no shared input-validation layer** (`zod` is not even a dependency; handlers hand-roll `typeof` checks or cast).
- **Public v1 list routes return unbounded full-table selects** with no pagination — while the internal `/api/task` route already implements correct keyset pagination.
- **Anthropic client uses the SDK default ~10-min timeout**, which exceeds the 60–300s serverless function envelope → opaque platform 504s instead of clean fallbacks.

### State-management findings

- Client state is a mix of context + prop drilling + `router.refresh()`; cache invalidation via `revalidatePath` is applied inconsistently. `useTransition` pending states are widely present (59 files) — the gap is in *route-level* and *confirmation* feedback, not per-button busy state.

### Data-flow findings

- `revalidatePath` after mutations is common but not universal; several mutations rely on `router.refresh()` which re-runs `useCountUp` from zero, making KPI numbers visibly reset.
- The "replaces Hebbia" retrieval runs on a 256-dim bag-of-words hash embedder (lexical overlap only) behind a clean `Embedder` seam no real model is plugged into.

### Auth / permissions findings

- **RLS is strong** at the table layer and materially reduces blast radius (confirmed in the prior inspection).
- **`live_meetings` INSERT policy checks only `host_id`**, not org membership → a user can inject a meeting into any org's list.
- **The SFU gateway performs no signature verification** — the one auth surface RLS cannot cover.

### Performance findings

- Data fetching generally batches with `Promise.all` (no obvious N+1). The felt-performance problem is the **absence of route-level loading boundaries**, not query fan-out.
- 30+ infinite CSS animations (KPI shimmer, pulsing dots, flame) run at idle on the dashboard, keeping the compositor active.

### Real-time behavior findings

- The virtual-office socket client is resilient (ping/pong, capped backoff, explicit status states). The **server-side auth is the weak point**, and there is **no inbound ingestion** for any external channel — the Unified Inbox only ever receives demo-seeded or internally-written threads.

### Demo-mode findings

- Demo data is honestly engineered where explicit (`seedDemoData` is org-scoped, tagged, idempotent, reversible; seeded deals carry `source='Demo'`).
- The **dishonest** demo surface is integrations: `mockAccountLabel()` mints `gmail@connected.local`, adapters return `{ok:true, live:false, detail:"Queued …"}` with no queue behind them, and mock booking links are literal `https://mock.fundexecs.local/...` persisted as real `meeting_url`.

---

# QA Findings

### Bugs

- **Approvals have no already-decided guard** (`lib/engine.ts`) — a second "approved" POST re-executed the whole workflow: double Claude spend, double credit debit, duplicate artifacts. **[Fixed in this PR.]**
- **Gift redemption double-credits under concurrency** (`lib/gift-earn.ts`) — credits granted *before* a non-conditional status flip. **[Fixed in this PR.]**
- **Regenerate path null-derefs** when the workflow update returns no row (`lib/engine.ts:155`) → opaque 500 instead of "workflow no longer exists".

### Broken flows

- **Data room NDA/password/email gates are client-side only** — the RSC page ships all content (documents, team emails, track record) before any gate; the doc route checks only token validity. **P0.**
- **Execute › Signing is orphaned** — every CTA 404s; 1,300+ lines of working wizard/detail unreachable. **[Fixed in this PR.]**
- **Capital call/distribution/secondary booking is non-transactional** and returns `void` — partial failures diverge the per-LP ledger from fund aggregates with no signal. **P0.**

### Missing states

- **1 `loading.tsx` and 0 `not-found.tsx`** across ~65 routes; heavy `force-dynamic` pages render nothing during navigation. **[Partially fixed: shared `app/(app)/loading.tsx` added.]**
- **Deal-lifecycle/portfolio actions return `void`** and swallow every DB error — analyst records an IC decision, form resets, nothing saved.

### Incorrect logic

- **Workflows with failed steps are marked `completed` at progress 1** and still seed Deals/Assets from partial output.
- **Artifacts are stamped `verified` + attestation-sealed by an approval given *before* the artifacts existed** — the operator approved the *plan*, not the outputs, yet outputs are marked human-verified. Corrodes the entire attestation/reputation rail.
- **E-sign completion never enforces envelope `sent` status or required fields server-side** — drafts are signable; required fields can be blank.
- **`spendCredits` is a read-then-write debit** whose ledger can diverge from the clamped wallet balance under parallel workflows.

### Demo artifacts

- **Integrations fake connectivity** (see Full-Stack › Demo-mode).
- **LP onboarding "signature" is a single unauthenticated click** recording only a timestamp — no signer identity, no document hash, no IP; `accreditation_verified_at` implies verification that never happened.

### Reliability issues

- **Envelope "send" reports success regardless of email delivery**; the Gmail path uses a static access token that expires in ~1 hour with no refresh.
- **One-click "Clear all" hard-deletes the org's entire real deal book / workflows / artifacts** behind only a browser `confirm()`, and the UI discards the `{ok,error}` result. Cascades to diligence/underwriting/IC decisions.

### Production blockers

Data room gate (P0), integrations honesty (P0), capital-run atomicity (P0), SFU JWT verification (P0), Signing 404 (P0 — fixed), route-loading feedback (P0 — partially fixed).

---

# UX Findings

### Navigation

- Signing CTAs 404 **[fixed]**; dashboard palette ships 6 dead links; three competing app shells with a name collision on "Command Center"; ~54 destinations exposed across five different disclosure mechanisms.

### Layout

- Four floating widgets (`DownloadBanner`, `EarnCopilotDock`, `GuidedTour`, `MatchToast`) stack in the same bottom-right corner at the same z-index — the download banner occludes the flagship Earn dock during a user's first session.

### Workflow clarity

- No bulk import or bulk actions on any record table; `CsvImport` is written and exported but mounted nowhere. Onboarding an 80-relationship LP book means 80 sequential form submits.

### Forms

- `AddRowForm` allows double-submit (no pending/disabled state → duplicate rows), uses `type=text` for email fields, and shows only a single generic error line. `EnvelopeWizard` does all of this correctly and is the pattern to copy.

### Responsiveness

- No mobile nav below `md` (P1). `ModuleTable` clipped instead of scrolling on narrow screens **[fixed: `overflow-x-auto` + `min-w`]**.

### Copy clarity

- Raw DB enums shown to users; module names drift across surfaces ("Materials" vs "Data Room", "LP Report" vs "Reporting", "Sessions" vs "Workspace") — a redirect graveyard in `next.config.mjs` documents how often this has bitten users.

### Visual hierarchy

- Primary destinations (Portfolio, Search) are buried in an unlabeled "More" overflow while the top level shows only three items.

### User friction points

- `ModuleTable` row actions (expand/verify/archive) are mouse-only — no `tabIndex`, `role`, or `onKeyDown` — so the audited verification control is keyboard-inaccessible (a real 508/VPAT problem). Sidebar popouts ignore Escape.

---

# Beautification Recommendations

- **Spacing / alignment:** standardize table wrappers on `overflow-x-auto` + `min-width` (done for `ModuleTable`; audit `CapTableModule` as the reference). Extract the repeated gold-CTA Tailwind into a shared `components/shared/Button.tsx`.
- **Typography:** humanize enum labels everywhere (`ic_review` → "IC Review") via one `humanize()` used by both `AddRowForm` options and `ModuleTable.cell()`.
- **Component consistency:** three app shells → one canonical shell + named sub-sections; one command palette (see Architecture).
- **Dashboard polish:** gate the KPI stat-tile shimmer to hover/one-shot (today it's a perpetual infinite sweep over the exact numbers a principal is reading); tween `useCountUp` from previous→next instead of resetting to zero on refresh.
- **Card / table / list refinements:** checkbox column + "Verify selected" bulk action on `ModuleTable`; wire `CsvImport` next to `AddRowForm`.
- **Mobile refinements:** slide-in sidebar drawer from a `md:hidden` menu button; ensure all record grids scroll rather than clip.
- **Desktop refinements:** stack-manage the four bottom-right widgets (dock `z-50`, banner bottom-left or suppressed during the tour).
- **Premium visual upgrades:** documented motion scale (below) so new surfaces stop guessing durations.

---

# Motion & Animative Upgrade Plan

The token vocabulary is already good — 23 purpose-named `fx*` keyframes sharing one signature curve `cubic-bezier(0.22, 1, 0.36, 1)`, mostly-disciplined 150/200/300ms usage, best-in-repo Copilot streaming affordances. The failures are structural.

- **Micro-interactions:** add `active:scale-[0.98] active:brightness-95 transition duration-150` to primary CTAs (send/pay/approve) — only 8 `active:` usages exist app-wide; the sub-100ms press gap is where double-clicks happen.
- **Hover / press / focus:** ensure `focus-visible` rings on all interactive elements; extract a shared Button that bakes in hover/active/disabled/pending.
- **Loading states:** **the single most-felt defect** — 52 async pages, 1 `loading.tsx`. Add route-level `loading.tsx` boundaries (shared branded skeleton) plus a 2px top progress hairline in the shell. **[Started: `app/(app)/loading.tsx` added.]**
- **Success states:** a full toast system (`CoachingToast`, info/success/warn tones, `aria-live`) exists but has exactly one consumer. Promote it to `useToast`, add an `error` tone, retune entrance to 250ms + a 150ms fade-out, and wire the ~15 mutation call sites currently reinventing confirmation.
- **Error states:** inline field errors for validation; toast for action-level failures.
- **Page / component transitions:** standardize overlays on the `EarnCopilotDock` pattern (persistent mount, `transition-transform duration-200` both directions). `SlidePanel` has no exit; `ArtifactModal`/`StripeCheckoutModal`/`CommandPalette` instant-pop. Extract a shared `<Overlay>`: backdrop fade 150ms ease-out; dialog `opacity 0 + scale(0.98) + translateY(4px)` → identity over 200ms `cubic-bezier(0.22,1,0.36,1)`; exit 120ms ease-in.
- **AI/agent activity animations:** keep — the Copilot streaming caret/orb/aria-busy/cancel is the model to propagate.
- **Timing & easing guidelines (codify in `docs/VISUAL_SYSTEM.md`):**
  - Micro (hover, color, press): **150ms ease-out**
  - Component state (cards, toggles): **200ms ease-out**
  - Panels / drawers / toasts: **enter 250ms `cubic-bezier(0.22,1,0.36,1)`, exit 150ms ease-in**
  - Progress-bar width: **500–700ms ease-out only**
  - The spring `cubic-bezier(0.22,1,0.36,1)` is the ONLY custom curve.
  - Add `transitionDuration: {250}` and `transitionTimingFunction: {fx}` to `tailwind.config.ts` (today `duration-250` is a silent no-op class); rename the duplicated `fxShimmer`/`fxBorderPulse` keyframes that collide between config and `globals.css`.
- **Accessibility:** **[Fixed: global `prefers-reduced-motion` catch-all added to `globals.css`.]** Previously only neural-scoped classes were tamed while 30+ infinite animations ignored the preference.

---

# Architecture Findings

### Structural issues

- `lib/` is a flat **287-file** directory (source + 109 tests intermixed), with two ~1000-line god-modules: `engine.ts` (1,341 — planning + execution + automation + materialization + reputation) and `claude.ts` (1,028 — every Anthropic capability in one file). Group by domain (`lib/finance` already exists), co-locate tests, split the god-modules behind thin barrels.

### Backend improvements

- Move capital-event writes into Postgres RPCs mirroring `fin_apply_payment` (atomic, `FOR UPDATE`, `{ok,error}` return).
- Adopt the finance `{ok, error}` result convention across the void-returning action classes.

### API improvements

- Introduce a shared zod-validated request helper + one response envelope for both app and v1 routes; publish an OpenAPI doc for v1.
- Add `.limit()` + keyset cursors to v1 list routes (reuse `lib/task-cursor.ts`).
- Configure the Anthropic client with explicit `timeout` (45s interactive / 120s cron) and surface a typed timeout error to the existing deterministic fallbacks.

### Data-model improvements

- Finance model is exemplary (numeric money, CHECK constraints, deferred balance trigger, org/FK indexes). Extend the same discipline to capital-event tables (atomic increments, not JS read-add).
- Fix the `live_meetings` INSERT policy to also assert org membership.

### State-management improvements

- Consolidate to one command palette mounted in `app/(app)/layout.tsx` (Cmd+K global), generated from `lib/hubs.ts`; retire the dashboard variant and merge the Copilot composer commands into it.

### Scalability issues

- **Conversational AI routes (`chat`, `chat/followups`, `clarify`, `prompt/stream`, `meetings/analyze`) have zero credit/cost gating** — a single authenticated seat can drive unbounded Anthropic spend. Add a pre-flight `spendCredits`/meter after `requireOrgContext`, returning 402 when insufficient; add per-org rate limiting.
- v1 unbounded selects (above) degrade worst for the largest customers.

### Security / permission issues

- **SFU gateway `jwt.decode`-and-trust** → forged-token impersonation + media eavesdropping. **[Fixed in this PR: `jwt.verify` HS256 + `exp`, fail-closed on missing `SUPABASE_JWT_SECRET`.]** Follow-up: also authorize `roomId` against org membership.
- `live_meetings` cross-tenant injection (above).

### Maintainability concerns

- God-modules + flat `lib/` + two API envelopes are the dominant structural drag as the codebase grows past 300 modules.

---

# Native-First Expansion Plan

**Posture:** The OS genuinely **owns its core** — deal pipeline/graph (DealCloud), fund-admin math (Carta: cap-table, European waterfall, vesting, dilution, convertibles, 409A, GL/banking/AR-AP), relationship intelligence (Affinity), native e-sign envelopes, native WebRTC rooms + in-repo SFU. Where third parties *should* take over, the experience is currently **controlled by theater**.

### Current external dependencies

- **Strategic (keep):** Stripe (model integration — hosted Checkout, signature-verified webhook, idempotent fulfillment, fail-closed), Anthropic (with deterministic fallbacks), Supabase, mediasoup (self-hosted, native-owned).
- **Hybrid (native primary + external extension):** Email (native Resend + per-org Google OAuth), Calendar/scheduling (native rooms default + Calendly), messaging (Slack), CRM/market-data (Apollo — already coded).
- **Rebuild native / retire:** `pdfjs-dist`, `react-pdf`, `react-signature-canvas` are **dead dependencies** (zero imports — signature capture is already native). `xlsx@0.18.5` is the abandoned npm SheetJS (unpatched CVEs) and is the only parser for untrusted uploaded spreadsheets → move to the maintained tarball or a native CSV path.

### Features to rebuild natively

- **Document intelligence / retrieval** ("replaces Hebbia"): implement `voyageEmbedder` behind the existing `Embedder` seam (`lib/brains/embed.ts`), migrate `vector(256)` → `vector(512/1024)` with a re-embed backfill; keep the hash embedder as the keyless fallback (preserves mock-or-real discipline).
- **E-sign dispatch:** create `lib/integrations/adapters/native-signing.ts` mirroring `native-meeting` so the Tier-3 signing family routes to the in-repo `signing_envelopes` system instead of the permanently-queued DocuSign mock.

### Features to keep external

- Payments/settlement (Stripe), identity (Supabase Auth), and eventual market-data feeds — external is the right call; wrap them in native UI + audit.

### Features to make hybrid

- Email, calendar, messaging, CRM — native experience + orchestration, external as a value-add extension resolved **per-org** from the vault.

### Native module definitions

- **Connector spine (exists, needs wiring):** `DispatchAdapter` contract + `ActionKind` routing + tier gates + append-only `dispatch_log` + AES-256-GCM vault (`lib/vault.ts`) + Stripe-style API keys. This is a genuinely good seam.

### Native workflow architecture

- Preserve the gate → dispatch → Outbox loop as the single system of action; make native adapters win their ActionKinds (fix the registry ordering below), so the OS owns the primary experience and integrations only extend it.

### Native data-pipeline plan

- Thread per-org credentials through `DispatchContext` via `getOrgSecret(orgId, channel)` (today the vault has **zero consumers** — every adapter reads `process.env`, making the product architecturally single-tenant on every external channel).

### Native UI-surface plan

- Truth-in-UI: channels without a real credential path render "Coming soon", not a green "Connected" badge; `live:false` dispatch results surface as "not delivered" in the Outbox.

---

# Plug-In / Connector / Integration Blueprint

### Integration opportunity map (by category)

CRM · cloud storage · data rooms · compliance · email · calendar · messaging · e-sign · payments · settlement · investor portals · market data · analytics · automation · AI tools · identity.

### Connector definitions (top 5 to make real, in order)

1. **Email — hybrid.** *Purpose:* send LP/IR correspondence from the org's own identity. *Verdict:* native Resend with per-org verified domains + Google OAuth refresh-token flow. *API surface:* `/api/oauth/google/{start,callback}`, `sendViaGmail` via `getGoogleAccessToken(orgId)`. *Auth:* OAuth authorization-code, refresh token in `org_secrets`. *Permission:* Tier-gate inherited. *Sync:* outbound now; inbound via Resend inbound / Gmail watch. *Audit:* `dispatch_log` (exists).
2. **Calendar / scheduling — hybrid.** Native rooms as default (fix routing collision), Calendly via its token API + `invitee.created` webhook for inbound bookings.
3. **E-sign — native-first.** Register `signing_envelopes` as the Tier-3 dispatch adapter; DocuSign becomes an opt-in channel, and `docusign-issuance` must resolve real investor emails (today it fabricates `investor-${id}@placeholder.internal`).
4. **Messaging (Slack) — external.** Per-org bot-token OAuth; Events API into a new inbound surface.
5. **CRM / market data (Apollo — external).** Key-per-org via vault, feeding the existing verification-engine confidence scoring.

### Plug-in architecture

- Extend `api_keys` with a `scopes text[]` column (`read:deals`, `write:deals`, `events:subscribe`), enforced in `withApiKey` per route. Today an issued key is an all-or-nothing org-wide **read** credential (5 GET endpoints, no writes, no events) — insufficient as an SDK foundation, and a leaked key exposes every investor record with no blast-radius control.

### API-surface design

- Add scoped writes that respect the Tier model (Tier-2/3 API writes create `approvals` rows instead of executing); `POST /api/v1/webhooks` for event subscriptions delivered from `task_events`/`dispatch_log` by the cron sweep, HMAC-signed.

### Authentication model

- Per-provider OAuth (authorization-code + refresh) for user-delegated channels; per-org API key (scrypt+pepper, exists) for programmatic access; HMAC bearer for first-party webhook pushers (reuse `CRON_SECRET`/`BRAIN_INGEST_SECRET` pattern).

### Permission model

- Everything inherits `lib/gates.ts` Tier 1/2/3 — the correct single-source primitive already reused by Capital Map, inbox, engine, and the integration catalog.

### Data-sync model

- **Inbound is entirely missing today** — the only webhook in the app is Stripe's. Build one generic `app/api/webhooks/[channel]/route.ts` with per-channel signature verification, a payload→`{thread, message}` mapper colocated with each adapter, and an append-only ingest log mirroring `dispatch_log`. Ship Calendly + Resend inbound first (signature-verified POSTs, no OAuth prerequisite).

### Audit-trail model

- Strong primitives exist (`dispatch_log`, immutable `attestations` with `evidence_hash`, `task_events`, `operator_feedback`). Gap: **connection connect/disconnect writes nothing** — the upsert destroys history. Add `integration.connected`/`integration.revoked` `task_events` (or a dedicated append-only table).

### Admin controls

- Per-org connection state, vault-stored credentials (masked UI), scoped key management, connection history — all surfaced in Settings.

### User-facing integration surfaces

- Settings › Connections (honest state), the Unified Inbox (bidirectional once ingestion lands), the Outbox (live/not-delivered clarity).

---

# PM Prioritized Plan

## P0 — Critical (before any institutional pilot)

| # |                                    Issue                                     |                                                    Why it matters                                                     |                                                                                      Recommended fix                                                                                      |     Owner     |                      Impact                      |
|---|------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------|--------------------------------------------------|
| 1 | Data room gate is client-side; all content ships in the page payload         | GP believes password+NDA protect a fundraise room; anyone with the link reads every doc/email/figure from view-source | Server-side gate-pass store (signed cookie / `data_room_gate_passes`); render only the gate shell until passed; enforce `password_hash`/`require_nda`/`allowed_sections` in the doc route | QA + Arch     | Closes a product-ending confidentiality hole     |
| 2 | Integrations mint fake "Connected" + report queued/sent while nothing leaves | Silent non-delivery of investor comms; email sends under a shared cross-tenant identity                               | Truth-in-UI ("Coming soon" / `not_delivered`); real per-org OAuth resolving credentials via `getOrgSecret`                                                                                | Native + UX   | Restores trust in the core dispatch loop         |
| 3 | Capital calls/distributions written non-transactionally, `void` return       | Partial booking diverges ledger from fund aggregates with no signal, in a fund-admin product demanding exactness      | Postgres RPC mirroring `fin_apply_payment`; return + render `{ok,error}`                                                                                                                  | Arch + QA     | Prevents silent money-movement corruption        |
| 4 | SFU gateway decodes-and-trusts JWTs                                          | Forged token → impersonation + live audio/video eavesdropping                                                         | `jwt.verify` HS256 + `exp`, fail-closed; authorize `roomId` vs org                                                                                                                        | Arch/Security | **Landed in this PR**                            |
| 5 | Signing module CTAs 404 — native e-sign orphaned                             | Primary gold CTA of a headline flow returns 404                                                                       | Point hrefs at `/envelopes/*` + heal bookmarks with redirects                                                                                                                             | UX            | **Landed in this PR**                            |
| 6 | 52 async pages, 1 `loading.tsx` — navigation reads as a hang                 | Unacknowledged clicks destroy the "OS" feel on data-heavy pages                                                       | Route-level loading boundaries + shell progress hairline                                                                                                                                  | Motion        | **Started in this PR** (`app/(app)/loading.tsx`) |
| 7 | Adapter registry last-wins routes meetings/calendly to a permanent mock      | Fabricated `mock.fundexecs.local` booking links persisted as real `meeting_url`                                       | Make precedence explicit; native meeting/calendly win; only persist `reference` when `live`                                                                                               | Native        | Fixes core scheduling routing                    |

## P1 — Important (institutional usability / reliability)

| #  |                              Issue                               |                          Why it matters                          |                                Recommended fix                                 |  Owner   |                   Impact                   |
|----|------------------------------------------------------------------|------------------------------------------------------------------|--------------------------------------------------------------------------------|----------|--------------------------------------------|
| 8  | Approval double-execute                                          | Double AI spend + duplicate deliverables on the core loop        | Compare-and-set on `decision IS NULL`                                          | QA       | **Landed in this PR**                      |
| 9  | Gift double-redeem                                               | Real credit/revenue leakage                                      | Conditional flip before grant                                                  | QA       | **Landed in this PR**                      |
| 10 | "Clear all" nukes the real deal book                             | One misclick past a `confirm()` is unrecoverable                 | Scope to demo rows / typed confirmation + role; render errors                  | QA + UX  | Prevents catastrophic data loss            |
| 11 | Void, error-swallowing lifecycle actions                         | Dropped IC decisions / risk flags read as saved                  | Adopt finance `{ok,error}` convention                                          | Arch     | Decision-quality integrity                 |
| 12 | Conversational AI routes ungated                                 | Unbounded Anthropic spend per seat                               | Pre-flight meter + rate limit                                                  | Arch     | Cost/abuse control                         |
| 13 | `live_meetings` cross-tenant injection                           | Meeting injected into any org                                    | Add org-membership to INSERT policy                                            | Security | Tenant isolation                           |
| 14 | Vault has zero consumers                                         | Product is single-tenant on every external channel               | Thread `getOrgSecret` through `DispatchContext`                                | Native   | Multi-tenant readiness                     |
| 15 | No inbound ingestion                                             | The core "information arrives → decide" promise is outbound-only | Generic `webhooks/[channel]` surface; Calendly + Resend first                  | Native   | Unlocks the inbox's real value             |
| 16 | Failed workflows read "Completed" + seed deals                   | System of record lies about outcomes                             | Track failures; status `completed_with_errors`/`failed`; skip `persistOutcome` | QA       | Trust in the pipeline                      |
| 17 | Artifacts auto-"verified" by plan approval                       | Attestation rail becomes evidentially meaningless                | Split plan-approval from deliverable sign-off                                  | QA       | Preserves the institutional differentiator |
| 18 | E-sign completion lacks server-side status/required-field checks | Legally shaky signed docs                                        | Enforce `sent` status + required fields server-side                            | QA       | Legal defensibility                        |
| 19 | No mobile nav                                                    | Partners/IR live on phones                                       | `md:hidden` drawer                                                             | UX       | Mobile usability                           |
| 20 | Dashboard palette 6 dead links; enum leakage; `ModuleTable` a11y | Trains users to distrust keyboard nav; unfinished feel; 508 gap  | Generate palette from `lib/hubs.ts`; humanize enums; keyboardable rows         | UX       | Polish + compliance                        |

## P2 — Enhancement (polish, motion, integration depth)

- One command palette (global Cmd+K); one canonical app shell + naming.
- Toast system promoted to `useToast` across ~15 mutation sites; standardized overlay enter/exit; documented motion scale + `tailwind.config` tokens; gated KPI shimmer; `useCountUp` prev→next tween + reduced-motion.
- Bulk import/verify (wire `CsvImport`, add selection column); shared `Button` with press states.
- Remove dead deps (`pdfjs-dist`, `react-pdf`, `react-signature-canvas`); move off abandoned `xlsx`.
- `voyageEmbedder` for semantic retrieval; native-signing adapter; env-var contract fixes (`CALENDLY_API_KEY` vs `_TOKEN`; document `APOLLO_*`/`XERO_*`/`JAX_*`); connection-history audit rows.
- v1 API: scopes, writes-as-approvals, webhooks, request log, pagination; shared response envelope + zod validation; Anthropic client timeouts.

---

# Blueprint-First Build Initiation Steps

### First files/modules to inspect

`app/dataroom/[token]/page.tsx` + `components/dataroom/DataRoomViewer.tsx` + `ViewerGate.tsx` (gate); `lib/integrations/{registry,gateway}.ts` + `adapters/*` (routing + honesty); `components/execute/actions.ts` (capital atomicity); `server/src/{AuthService,gateway}.ts` (SFU auth).

### First components to refactor

Extract a shared `<Overlay>` and `<Button>`; extract the sidebar body for a mobile drawer; promote `CoachingToast` → `useToast`.

### First QA flows to test

Data room open-without-gate; approve-twice idempotency (**test added**); gift double-redeem (**test added**); capital-run partial-failure; envelope send delivery reporting; signing from the module CTA (**route fixed**).

### First native modules to define

`native-signing` adapter; `getOrgSecret` credential threading; `webhooks/[channel]` inbound surface.

### First UI polish pass

Route-level `loading.tsx` per group (**shared root added**); global `prefers-reduced-motion` (**added**); `ModuleTable` overflow (**fixed**) + keyboardable rows + enum humanization.

### First motion upgrades

Shell progress hairline; overlay enter/exit standardization; documented timing scale in `VISUAL_SYSTEM.md`.

### First integration surfaces to prepare

Google OAuth start/callback + vault storage; Calendly webhook receiver; Outbox `live:false` clarity.

### Recommended PR sequence

1. **This PR** — safe, fully-tested first wave (SFU JWT, Signing routes, gift/approval idempotency, route-loading + reduced-motion + table overflow, report).
2. Data room server-side gate (security-critical, isolated).
3. Integrations honesty + registry precedence + `getOrgSecret` threading.
4. Capital-event RPCs + `{ok,error}` convention rollout.
5. Conversational cost gating + `live_meetings` policy + v1 pagination.
6. UX consolidation (one shell, one palette, mobile drawer) + toast rollout.
7. Inbound ingestion + native-signing adapter + OAuth flows.

---

# Final Institutional-Grade Summary

**Current state.** A genuinely capable, native-first foundation with a clean toolchain, strong RLS, an exemplary finance module, and a coherent AI engine — further along than "pre-alpha" suggests. The product's own best code (finance RPCs, `EnvelopeWizard`, `CommandPalette`, Copilot streaming, the connector spine) sets a bar the rest of the surface hasn't uniformly reached.

**Main risks.** Trust-surface theater: a data room that looks protected but isn't; integrations that report success while sending nothing (and, on email, send under a shared identity); money movements that can silently half-book; a collaboration gateway that trusts unsigned tokens. Each is individually product-endangering for the GP/allocator persona.

**Highest-value fixes.** Server-side data room gate, integration honesty + per-org credentials, capital-event atomicity, SFU signature verification, and universal navigation/mutation feedback.

**Native-first opportunities.** Win the ActionKind routing for native meeting/signing; wire the already-built vault so the product is multi-tenant; plug a real embedder into the retrieval seam; retire dead PDF/signature deps.

**Integration readiness.** The spine (adapter contract, tier gates, vault, append-only audit, API keys) is well-designed; the missing layers are real OAuth, vault consumption, an inbound webhook surface, and scoped keys for an SDK.

**What must happen next.** Land the P0 wave (this PR starts it), then the data room gate and integration honesty — after those three, FundExecs OS crosses from "impressive build" to "safe to put in front of an allocator." The architecture already anticipated this work; the seams are in place. This is finishing, not rebuilding.

---

## Changelog — landed in this PR (build initiation)

|        Area         |                                                Change                                                |                                   Files                                   |
|---------------------|------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------|
| Security (P0)       | SFU gateway now `jwt.verify`s HS256 signature + `exp`, fails closed on missing `SUPABASE_JWT_SECRET` | `server/src/AuthService.ts`, `server/src/index.ts`, `server/.env.example` |
| Broken flow (P0)    | Signing module CTAs point at real `/envelopes/*` routes; bookmark-healing redirects added            | `components/execute/SigningModule.tsx`, `next.config.mjs`                 |
| Missing state (P0)  | Shared branded route-loading skeleton for the authed shell                                           | `app/(app)/loading.tsx`                                                   |
| Bug (P1)            | Approval decision is now a compare-and-set — no double-execution / double spend                      | `lib/engine.ts` + `lib/engine-approval-idempotency.test.ts`               |
| Bug (P1)            | Gift redemption claims the row before granting — no double-credit                                    | `lib/gift-earn.ts` + `lib/gift-earn.test.ts`                              |
| Accessibility (P1)  | Global `prefers-reduced-motion` catch-all (was neural-scoped only)                                   | `app/globals.css`                                                         |
| Responsiveness (P1) | `ModuleTable` scrolls instead of clipping on narrow screens                                          | `components/ModuleTable.tsx`                                              |

All changes ship with `tsc --noEmit` clean, `next lint` clean, and the full Jest suite (now 124 suites) green.
