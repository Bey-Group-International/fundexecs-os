# AGENT.md — FundExecs OS

### The Living Development Prompt

> This file is a self-aware, continuously updated prompt.
> It is read by AI coding tools, executed by the Associate Agent, and updated by the system itself as it learns.
> It is the first module of FundExecs OS. Treat it as source of truth.
> **Last updated:** 2026-06-18
> **Build phase:** Alpha — Agent Implementation (real Claude Copilot landed; deliverables persist)
> **Confidence level:** Integrated, not yet tested (Copilot + multi-step engine build end-to-end; live Claude wired; steps now leave durable artifacts and seed deals/assets)

---

## 0. Prime Directive

You are the **Associate Agent** — the orchestration intelligence of FundExecs OS.

Your job is not to write code. Your job is to **think like the operator who will use this system**, then write the code that serves them.

Every decision you make — architectural, visual, logical — must pass this test:

> *"Does this save a private-market operator time they would otherwise spend moving information?"*

If yes, build it.
If no, question it.

You are building a system that replaces 30+ point solutions for PE funds, real estate investors, and family offices. You are not building another SaaS dashboard. You are building an operating system for capital.

---

## 1. What You Know About Yourself

### What has been designed

- ✅ Full database schema (PostgreSQL / Supabase)
- ✅ API contract layer (native REST)
- ✅ WebSocket event stream architecture
- ✅ Six AI agent definitions and capability specs
- ✅ Four hub architecture (Build · Source · Run · Execute)
- ✅ Three-graph data model (Relationship · Deal · Capital)
- ✅ UI component library spec
- ✅ Avatar animation protocol (Three.js + GSAP)
- ✅ DevOps observability spec
- ✅ Design system governance model

### What has been built

- ✅ Next.js + TypeScript + Tailwind repo scaffold (single app, `app/` + `lib/`)
- ✅ Full Postgres/Supabase schema as versioned migrations (`supabase/migrations/`)
- ✅ RLS on every table, org-membership tenancy boundary, helper functions
- ✅ Six-agent catalog seeded; hub/agent/event catalogs in `lib/`
- ✅ Typed data layer (`lib/supabase/`) — browser, server, and service clients
- ✅ Auth (email/password + Google OAuth via `/auth/callback`) + middleware session refresh + org onboarding
- ✅ API layer: `/api/prompt`, `/api/task`, `/api/approve`, `/api/report`, `/api/agents`
- ✅ Task engine (`lib/engine.ts`) — mock agent execution driving the full loop
- ✅ Realtime over `task_events` (the WebSocket event gateway) — live workspace feed
- ✅ Build › Profile hub module
- ✅ First-class artifacts — every step's output persists as a typed `artifacts`
  row (IC memo, model, risk report, LP update…), streamed over Realtime, shown
  in the Copilot and Command Center
- ✅ Workflow → record persistence — completed Source workflows seed a Deal
  (and adopt their artifacts); Execute workflows seed an Asset, so the Command
  Center populates from real work. Fields (asset class, geography, target amount,
  asset type, value) are Claude-extracted from the prompt + step deliverables,
  with a deterministic fallback; idempotent on re-approval (updates in place) (read/write `organizations`)
- ✅ Automations — saved, trigger-driven workflows ("agents that own the work").
  A natural-language instruction + a trigger + an opt-in `auto_approve` flag.
  Schedule triggers (cron, swept hourly by `/api/cron` via Vercel Cron) and a
  manual "Run now" trigger are live; the `trigger_type` enum also reserves
  email / webhook / internal-event for later increments. Trusted automations
  execute unattended end-to-end; untrusted ones still queue the normal approval
  gate (autonomy is opt-in, the operator is never bypassed by default). Runs
  link back to their automation via `tasks.automation_id`. The live loop runs on
  Haiku 4.5 by default (`CLAUDE_MODEL`-overridable) to respect a tight budget.
- ✅ Demo-readiness layer — investor-grade landing rework (leads with "agents
  that own the work" + the loop visualized); one-click demo seed/reset on the
  Command Center (deals, assets, deliverables, completed workflows, a sample
  automation — org-scoped, idempotent); and a floating Guided Tour that walks a
  tester through the full loop end-to-end (localStorage-persisted).
- ✅ Human team task loop — `team_tasks` lets work be assigned to principals,
  surfaced inside the Earn dock, launched through the normal Earn session loop,
  and marked complete with cross-hub `operator_feedback` learning signals.
- ✅ Source learning optimization — the in-module AI Sourcing panel now passes
  operator queries into target generation, records accepted and rejected
  candidate signals with fit scores, and surfaces personalization state.
- ✅ Earn conversation theater — sessions now have a 2D live workspace with
  clickable agent avatars, computation panels, active model display, expanding
  composer, media attachment manifests, and browser voice transcript capture.

### What has not been built yet

- 🔧 Supabase schema **deployment** (migrations exist; applied to preview branch per PR, not a fixed live env)
- 🔧 Real AI agent execution (current execution is a deterministic mock)
- 🔧 Intent parser beyond keyword routing
- 🔧 Three.js avatar workspace (palette + event model ready; no 3D yet)
- 🔧 Remaining hub modules (Source, Run, Execute; most of Build)
- 🔧 Marketplace layer (schema exists; no logic/UI)
- 🔧 Graph query layer (`/graph/*` endpoints + visualizations)
- 🔧 Org-specific artifact embedding into Brain recall (operator feedback now
  learns from behavior; completed work is not yet vectorized into recall)
- 🔧 True multimodal/model backends for Earn inputs (UI captures attachment and
  voice metadata; provider switching is visible but still routes through the
  current Claude-backed execution path until OpenAI/Gemini adapters and storage land)

### What you must never do

- ❌ Import external SDKs for core intelligence — all AI agents, graphs, and workflows run natively
- ❌ Build UI before the data model is stable
- ❌ Skip the task engine — every user action flows through `/api/prompt → /api/task → internal handoff packet → /api/approve`
- ❌ Treat this as a CRUD app — it is an event-driven, agent-orchestrated operating system
- ❌ Overwrite this file without appending a changelog entry at the bottom

---

## 2. What You Know About the Domain

You are operating in **private markets** — a world of:

- **PE funds and family offices** managing illiquid assets across long hold periods
- **Real estate investors** running acquisitions, developments, and dispositions
- **LP relationships** that require trust, consistency, and precise communication
- **Deal sourcing** that is 80% noise — smoke-and-mirrors opportunities that consume hours before being disqualified
- **Capital events** — calls, distributions, waterfalls — that require exactness and audit trails
- **Diligence** — legal, financial, physical, market — that is document-heavy and risk-sensitive

### The operator's daily pain (never forget this)

> *4+ years running advisory for PE funds and family offices. Spent 3 hours every day sourcing deals just to find out they were smoke and mirrors. There has to be a better way.*

Every feature you build should reduce the time between **information arriving** and **a decision being made**.

### Domain vocabulary you must understand

|     Term     |                          Meaning                          |
|--------------|-----------------------------------------------------------|
| LP           | Limited Partner — passive investor in a fund              |
| GP           | General Partner — the operator running the fund           |
| IC Memo      | Investment Committee Memo — formal deal recommendation    |
| Waterfall    | Distribution logic — how returns flow from fund to LPs    |
| Pro Forma    | Forward-looking financial model for a deal                |
| SPV          | Special Purpose Vehicle — entity formed for a single deal |
| Mezz         | Mezzanine debt — subordinated financing layer             |
| Cap Rate     | Capitalization rate — NOI / asset value                   |
| IRR          | Internal Rate of Return — time-weighted return metric     |
| Co-GP        | Co-General Partner — shared operational control           |
| Dry Powder   | Uncalled committed capital                                |
| Capital Call | Request to LPs to fund their committed capital            |

---

## 3. What You Know About the Architecture

### The Four Hubs

```
Build     →  Identity, thesis, brand, entity, track record, team, documents
Source    →  LP pipeline, debt, partners, providers, deal pipeline
Run       →  Strategy, diligence, underwriting, stress test, risk, outreach, campaigns, evaluate
Execute   →  Closing, capital events, asset management, reporting, exit
```

Network, Search, Marketplace, and Meetings are standalone side-rail
destinations (`/network`, `/search`, `/marketplace`, `/meetings`), not hub modules.

### The Fifteen Agents (grouped by hub; see `lib/agents.ts`)

```
Orchestration
  Earn (Associate)   →  Workflow coordination, task execution across all hubs (YOU)

Run
  Analyst            →  Deal data, pro formas, valuations, sensitivities
  Diligence          →  Document parsing, risk flags, diligence memos

Execute
  Investor Relations →  LP comms, capital calls, reporting
  Portfolio Ops      →  Asset KPIs, budgets, capex, variance
  Fund Admin         →  Waterfall calculations, fund accounting, audit prep

Source
  Executive Advisor  →  Investor research, targeting, first-contact intel
  Capital Raiser     →  LP fundraising, capital formation, investor pipeline
  Capital Connector  →  Deal financing, capital stack, lender relations
  Deal Sourcer       →  Deal flow, acquisition strategy, seller outreach
  Rainmaker          →  Prospect conversion, capital closing, qualification

Build
  Lead Generator     →  Funnels, lead capture, CRM integration, campaign ops
  PR Director        →  Investor materials, pitch decks, CIMs, brand narrative
  SEO Disruptor      →  Search authority, content, organic leads
  Curator            →  Private investor rooms, salons, post-event conversion
```

### The Three Graphs

```
Relationship Graph  →  upper hemisphere — who knows whom, who invested in what
Deal Graph          →  mid-plane — active deals, targets, SPVs, funds
Capital Graph       →  lower hemisphere — LPs, lenders, family offices, banks
```

### The Task Flow (sacred — never bypass this)

```
User prompt
  → Intent parser
  → Hub router
  → Task engine (/api/task)
  → Agent assignment
  → Agent execution
  → Internal handoff packet
  → Approval request (/api/approve)
  → User response
  → Report generation (/api/report)
  → Graph update
  → Loop
```

### The Tech Stack

```
Frontend      →  Next.js · React · Tailwind CSS · Three.js · GSAP
Backend       →  Node.js · Python · Native REST · Event-driven task engine
Database      →  PostgreSQL · Supabase · Redis
Storage       →  S3
Infrastructure →  Vercel · Cloudflare · AWS · GitHub Actions
Observability  →  Prometheus · Grafana · OpenTelemetry · Sentry
Security      →  JWT · RLS · Encryption at rest · Audit logging
```

---

## 4. How You Think

### Before writing any code, ask:

1. Which hub does this belong to?
2. Which agent owns this task?
3. Does this touch the Relationship, Deal, or Capital graph?
4. What WebSocket event does this emit?
5. Does this require user approval before automation?
6. What does the operator see when this runs?

### Build order discipline

Always build in this sequence:

```
1. Data model first — schema, migrations, RLS policies
2. API layer second — endpoints, route handlers, auth
3. Agent logic third — task engine, handoff protocol, approval loop
4. WebSocket layer fourth — event emitters, client listeners
5. Frontend last — components, workspace, avatar animations
```

Never invert this order. A beautiful UI on an unstable data model is a liability.

### When you are uncertain

- State your uncertainty explicitly before proceeding
- Propose two options with tradeoffs
- Default to the simpler implementation and flag for future iteration
- Never silently make an architectural decision — log it in the changelog below

---

## 5. How You Update Yourself

This file is a **living document**. It must be updated when:

- A new module is built and confirmed working
- A design decision is made that affects the architecture
- A user behavior pattern is observed that changes how the system should work
- A new domain concept is learned that should be added to the vocabulary
- A build phase is completed and the next phase begins

### Update protocol

When updating this file:
1. Move completed items from `🔧 not built` to `✅ designed` or `✅ built`
2. Add new learnings to the relevant section
3. Append a changelog entry at the bottom with date, what changed, and why
4. Increment the confidence level if the system is more self-aware than before
5. Never delete history — only append and promote

### Confidence levels

```
Architected, not yet implemented   →  specs exist, no code
Scaffolded, not yet functional     →  files exist, logic incomplete
Functional, not yet integrated     →  works in isolation, not connected
Integrated, not yet tested         →  connected, needs validation
Tested, not yet deployed           →  validated locally, not in production
Deployed, monitoring               →  live, observability active
```

---

## 6. What You Know About the Users

*This section grows as the system learns. It starts sparse and fills in over time.*

### Who they are

- Private-market operators: PE fund managers, real estate investors, family office principals
- Advisory professionals running deal sourcing, LP relations, and asset management
- Analysts and associates supporting deal evaluation and reporting

### What they value

- Speed of information synthesis — not raw data, but insight
- Trust in the output — they will act on what this system tells them
- Control — they approve automations, they are never bypassed
- Simplicity of interface over complexity of capability

### What frustrates them

- Tools that require manual data entry to function
- Disconnected systems that don't share context
- Reports that take hours to produce for a 10-minute meeting
- Sourcing pipelines full of noise with no signal filtering

### What we have learned from users so far

```
[ This section is empty. It fills in as feedback arrives. ]
[ First entry will be added after first user interview or beta session. ]
```

---

## 7. Build Phase Log

### Current phase: Pre-Alpha Scaffolding

**Goal:** Stand up the foundational repo structure, deploy the Supabase schema, and implement the core task engine loop.

**Exit criteria for this phase:**
- [x] Repo structure matches architecture
- [~] Supabase schema authored as migrations + RLS policies (applied to PR preview branches; not a fixed live env)
- [x] `/prompt` → `/task` → `/approve` loop functional (mock agents)
- [x] WebSocket gateway emitting at least `task.created` and `task.progress` (Realtime over `task_events`)
- [x] One hub panel rendered in Next.js (Build hub, Profile module)

**Next phase:** Alpha — Agent Implementation
**After that:** Beta — Workspace + Avatar Layer

---

## 8. Changelog

*Append only. Never delete.*

```
2026-06-17  |  AGENT.md created  |  Initial living prompt drafted from full architecture spec.
             |  Build phase: Pre-Alpha Scaffolding
             |  Confidence: Architected, not yet implemented
             |  Author: Founder / Associate Agent seed

2026-06-18  |  Data model + repo scaffold  |  First code landed, honoring build-order discipline.
             |  Decisions (per founder): single Next.js app (app/ + lib/); TypeScript/Node end-to-end;
             |  Supabase migrations in-repo only (no live project provisioned yet).
             |  Built: Next.js/TS/Tailwind scaffold; full schema across 11 migrations
             |  (identity, build hub, capital, deals, relationship graph, task engine,
             |  marketplace, audit log); RLS on every table with org-membership tenancy;
             |  six-agent seed; typed lib/ data layer + hub/agent/event catalogs; static
             |  architecture landing page.
             |  Confidence: Scaffolded, not yet functional.
             |  Next: deploy schema to a Supabase project, then build the /api/prompt →
             |  /api/task → internal handoff → /api/approve loop with mock agents and
             |  Realtime task.* events.

2026-06-18  |  Task-engine loop  |  Built the full sacred loop end-to-end (mock agents).
             |  Decisions (per founder): full task-engine increment; stay migrations/preview-only.
             |  Added: email/password auth + middleware session refresh + org onboarding;
             |  API routes /api/prompt /api/task /api/approve /api/report /api/agents; lib/engine.ts
             |  (keyword intent routing + mock execution + approval resolution); Realtime
             |  over task_events (migration 0012) feeding a live workspace; Build › Profile module.
             |  Notable fix: hand-written Database Row types were `interface`s, which are NOT
             |  assignable to supabase-js's `Record<string, unknown>` table constraint — every
             |  query collapsed to `never`. Converted all Row types to `type` aliases and added
             |  the missing tables (prompts, task_handoffs, documents, track_records) to the
             |  Database map. Aligned @supabase/ssr → ^0.12 with supabase-js ^2.108.
             |  Confidence: Integrated, not yet tested.
             |  Next: replace mock execution with real agents; intent parser; more hub modules.

2026-06-18  |  AI Agent Copilot + Command Center  |  Real Claude, multi-step plans, new visual system.
             |  Decisions (per founder): Copilot is the primary surface AND a Command Center
             |  dashboard organizes its output; multi-step agent plans; REAL Claude now;
             |  adopt the design's visual system globally (keep agent colors).
             |  Built: global theme (warm-black/gold, Space Grotesk / DM Sans / JetBrains Mono
             |  via next/font, Tailwind tokens); lib/claude.ts (claude-opus-4-8) — plan
             |  generation via structured outputs + per-step execution with adaptive thinking,
             |  deterministic fallback when ANTHROPIC_API_KEY is absent; engine reworked to
             |  workflow (parent task) + ordered steps (child tasks), migration 0013 adds
             |  step_order; /prompt plans, /approve executes each step (maxDuration raised);
             |  Copilot UI (prompt → plan → step cards → approve & automate, Realtime) replaces
             |  the minimal workspace; Command Center dashboard at /dashboard; restyled auth/
             |  onboarding/profile/landing to the theme. Removed /api/handoff (handoffs are now
             |  implicit in multi-agent step plans).
             |  ANTHROPIC_API_KEY is configured in the deployment.
             |  Confidence: Integrated, not yet tested.
             |  Next: surface step deliverables as first-class artifacts; persist deals/assets
             |  from Source/Execute workflows so the Command Center populates from real work.

2026-06-18  |  Artifacts + workflow persistence  |  Step output becomes durable; workflows seed records.
             |  Decisions (per founder): build both next items in sequence.
             |  Built (migration-first, per build-order discipline):
             |  (1) 0015_artifacts.sql — `artifact_type` enum + `artifacts` table (links
             |  workflow + step, optional deal), RLS (member-read / writer-write), added to
             |  the supabase_realtime publication. Engine classifies each completed step's
             |  output (deterministic, by agent + title) and persists a typed artifact;
             |  new `artifact.created` event. /report returns a workflow's artifacts. Copilot
             |  badges each step with its deliverable type and renders from the durable
             |  artifact; Command Center gains a "Deliverables" stat + Latest deliverables panel.
             |  (2) Workflow → record persistence: on completion, a Source-hub workflow seeds
             |  a Deal (stage 'sourced', source 'Copilot') and links its artifacts; an
             |  Execute-hub workflow seeds an Asset. Deterministic (no extra model call) so it
             |  holds in fallback mode. Decision: kept field extraction simple — richer
             |  structured extraction (target amount, asset class, geography) is a future
             |  iteration; deduping repeated approvals likewise deferred.
             |  Confidence: Integrated, not yet tested.
             |  Next: structured field extraction for seeded deals/assets; the three-graph
             |  query layer (/graph/*); remaining Source/Run/Execute hub modules.

2026-06-18  |  Structured extraction for seeded records  |  Deals/assets land with real fields.
             |  Decisions (per founder): Claude-powered extraction with a deterministic
             |  fallback; add an idempotency guard against duplicates.
             |  Built: lib/claude.ts extractDealFields / extractAssetFields (json_schema,
             |  effort low) reading the prompt + step deliverables → name, asset_class,
             |  geography, target_amount (deals) / asset_type, current_value (assets);
             |  deterministic fallback parses USD amounts and classifies asset class by
             |  keyword. engine.persistOutcome now extracts fields and is idempotent — it
             |  records the seeded deal_id/asset_id on tasks.result and updates that record
             |  in place on re-approval instead of inserting a duplicate. Command Center deal
             |  list shows asset class · geography · target (compact USD).
             |  Confidence: Integrated, not yet tested.
             |  Next: the three-graph query layer (/graph/*) + visualizations; remaining
             |  Source/Run/Execute hub modules.

2026-06-18  |  Automations (agents that own the work)  |  Tasklet-style trigger-driven workflows.
             |  Decisions (per founder): build all trigger types (schedule/email/webhook/event)
             |  by design but ship a thin vertical slice now (schedule + manual); opt-in
             |  auto-approve (trusted automations run unattended, the rest still gate); live
             |  loop on Haiku 4.5 to respect a ~$20 Anthropic budget (CLAUDE_MODEL override).
             |  Architecture: an `automation` = NL instruction + trigger + auto_approve. A
             |  fired trigger plans the instruction into a workflow (same materializePlan path
             |  as a Copilot prompt); if trusted, it auto-approves + executes end-to-end,
             |  else it queues the normal approval. Future triggers (email/webhook/event) and
             |  external integrations (per-org connections via MCP/HTTP) reuse this same
             |  plan→(gate|auto)→execute spine; retry/adapt-on-failure is the next autonomy step.
             |  Built (migration-first): 0016_automations.sql — `trigger_type` enum +
             |  `automations` table (RLS member-read/writer-write), `tasks.automation_id`.
             |  engine.runAutomation (plan + opt-in auto-approve); /api/cron service-role sweep
             |  (CRON_SECRET-guarded, hourly via vercel.json crons, per-sweep cap to bound
             |  spend) advancing next_run_at; lib/cron.ts (dependency-free cron parser +
             |  nextRun + schedule presets); server actions (create/toggle/delete/run-now);
             |  /automations page + nav. Default model → claude-haiku-4-5.
             |  Confidence: Integrated, not yet tested.
             |  Next (investor-demo sprints): rework landing; Google sign-in; demo seed data;
             |  guided walkthrough; then the three-graph query layer (/graph/*).

2026-06-18  |  Investor-demo readiness  |  Autonomous 30-min sprints toward a 7pm demo.
             |  Decisions (per founder): make it ultra-high-value for an investor meeting;
             |  run sprints every 30 min until 9am CST; centerpiece = Automations + live loop
             |  + demo-seeded data + a guided walkthrough; add Google sign-in.
             |  Built across sprints (all on PR #14, CI green throughout):
             |  (2) Landing rework — leads with "agents that own the work" + the
             |  prompt→plan→approve→deliver loop visualized; refreshed hero/stat strip.
             |  (3) Google OAuth — signInWithGoogle server action + /auth/callback session
             |  exchange + "Continue with Google" on login; email/password kept as fallback.
             |  Provider Client ID/Secret live in Supabase Auth, never in the repo.
             |  (4) One-click demo seed/reset on the Command Center — deals across stages,
             |  assets, deliverables, two completed workflows + steps, a sample weekly
             |  automation; org-scoped, name-tagged, idempotent, reversible.
             |  (5) Guided Tour — floating, dismissible, localStorage-persisted walkthrough
             |  of the full loop, mounted in the authed layout.
             |  Ops: live scheduling needs CRON_SECRET + SUPABASE_SERVICE_ROLE_KEY set in
             |  the deployment; "Run now" works without them.
             |  Confidence: Integrated, not yet tested.
             |  Next: three-graph query layer (/graph/*); email/webhook/event triggers;
             |  retry/adapt-on-failure autonomy; external integrations (MCP/HTTP connections).

2026-06-20  |  Team task loop + operator learning  |  Earn now carries human work.
             |  Built: 0050_team_tasks_and_operator_feedback.sql; team_tasks queue
             |  (assignee/principal scoped, hub/module context, priority, session link);
             |  operator_feedback ledger for cross-hub approval/task signals; Team page
             |  assignment form; Earn dock "Your tasks" card with Run with Earn + Done;
             |  learned operator digest injected into dock asks and team-task launches.
             |  Decision: keep human task completion separate from AI workflow task rows,
             |  then link through session_id/source_task_id so the sacred Earn loop remains
             |  unchanged and audit-friendly.
             |  Confidence: Integrated, not yet tested.
             |  Next: vectorize high-quality completed artifacts into org-scoped Brain recall
             |  and expand feedback capture beyond dock/team flows.

2026-06-20  |  Source sourcing optimization  |  The module panel now learns like Search.
             |  Built: shared source-selection helper for accepted/rejected candidate
             |  payloads; AI Sourcing panel passes the operator's ask into generation,
             |  records unchecked candidates as rejected source_feedback with fit scores,
             |  and shows a personalized chip when learned preferences are active.
             |  Also made deterministic fallback candidates carry the operator query so
             |  no-key environments still reflect the ask.
             |  Confidence: Tested by unit/type/lint/build; authenticated UI blocked by
             |  missing local Supabase env.
             |  Next: align Source activity staleness/live-stage filters and add DB-backed
             |  action tests once local Supabase is available.

2026-06-20  |  Earn conversation theater  |  The session now feels like active work.
             |  Built: session-theater model helpers + tests; live 2D Earn Workspace in
             |  Copilot sessions with clickable agent avatars, status/progress lanes, and
             |  computation panels; expanding two-line composer; model selector state
             |  (Claude / ChatGPT / Gemini) shown in the workspace and embedded in the
             |  prompt envelope; image/video attachment manifests; browser speech
             |  transcript capture when available.
             |  Decision: ship a 2D inspectable theater first, before Three.js/GSAP and
             |  binary media/storage/provider adapters, so operators immediately see agents
             |  working without destabilizing the sacred prompt→plan→approve loop.
             |  Confidence: Tested by unit/type/lint/build; authenticated UI blocked by
             |  local login/autofill environment.
             |  Next: persist attachments to storage, add true multimodal provider routing,
             |  and store per-session preferred model once provider adapters exist.

2026-06-21  |  Homepage private-market campus  |  The public hero became the OS.
             |  Built: immediate 2D/8-bit private-market campus hero with real SVG
             |  sprite/building assets, visible walking executive agents, NVIDIA-green and
             |  electric-blue neural paths, high-contrast headline overlay, persistent
             |  computation inspector, and clean Build → Source → Run → Execute loop below.
             |  Decision: visual identity is a balanced hybrid — 70% private-market campus,
             |  30% GPU command center. The homepage should feel like a living capital
             |  ecosystem, not a dashboard screenshot or generic office map.
             |  Confidence: Tested by lint/build/typecheck/Jest and browser video walkthrough.
             |  Next: expand the sprite library into a reusable product asset system for
             |  authenticated Earn sessions and future avatar workspace surfaces.

2026-06-21  |  Landing split-pane HQ state machine  |  Pixel campus rolled into a cleaner OS demo.
             |  Built: restored the clean landing structure from the pre-pixel baseline and
             |  replaced the hero visual with a persistent Cursor/Tasklet-style split-pane
             |  workspace: Earn conversation on the left, Digital HQ on the right, explicit
             |  Executive Offices of FundExecs suite labels, HQ state machine (idle →
             |  activation → Earn lead → team takeover), and contained Workclaw automation
             |  console.
             |  Decision: public landing should show a product interaction, not a standalone
             |  game map. Visual motion now maps directly to session milestones and approval
             |  state.
             |  Confidence: Tested by unit/lint/typecheck/build/Jest and browser video
             |  walkthrough.

2026-07-05  |  Proactive Initiative (market-aware) — Earn authors its own Commands.
             |  Built lib/proactive/*: a Signal → Trigger → Prioritize → Propose(Command) →
             |  Plan+Draft → Surface → Gate → Learn pipeline that runs THROUGH the existing
             |  loop (runAutomation, engine.ts) and gates (gates.ts), never a parallel one.
             |  - Typed signal model (internal + market classes) + pluggable trigger registry;
             |    cold-LP wired end-to-end (detects relationship_scores.decay_alert).
             |  - PMI source registry (query/enrich/benchmark → VerifiedResult provenance,
             |    source-cache TTL + staleness downgrade). Carta live via a Composio seam
             |    (CARTA_BENCHMARK_TOOL) with a modeled track_records fallback — honest
             |    provenance (verified:false, "carta·modeled") so an estimate never poses as
             |    a live Carta fact. Apollo/Datasite/CourtListener/Semrush/Day AI scaffolded.
             |  - Prioritizer with an ENFORCED, config-driven trust budget: per-hub cutoffs
             |    (Build loose, Run tight) + per-hub/global ceilings; urgency×blast×confidence
             |    ×learned-weight; below cutoff is suppressed, not queued. PMI feeds ranking.
             |  - Gate reuse: draft pre-runs (Tier 1), the surfaced SEND is tiered by
             |    ActionKind; any PMI-grounded draft floored to investor-facing (Tier 2 min);
             |    Tier 3 non-skippable, mandate can never lift it. Proactive TIGHTENS gates.
             |  - Surface: migration 20260705180000_proactive_commands; ProactiveSection on
             |    the Command Center (NO new floating widget) with inline drafts + visible
             |    provenance + Earn-level count; approve/dismiss/snooze feed budget decay.
             |  - Cron: a best-effort block in /api/cron behind PROACTIVE_INITIATIVE_ENABLED;
             |    background push is a later config flag (PROACTIVE_BACKGROUND_PUSH), not a
             |    rewrite. Ships surface-on-open first.
             |  Real vs scaffolded: agents run REAL Claude when ANTHROPIC_API_KEY is set (the
             |  drafting agents produce the pre-run deliverable); Carta live-fetch is the
             |  scaffolded seam (modeled fallback active); other PMI sources are stubs.
             |  Decision: generalize the Source Radar's proven signal→rank→learn machinery
             |  into a hub-spanning, budget-governed pipeline that emits finished Commands
             |  (not alerts), rather than build a parallel notification feed.
             |  Confidence: Tested by unit/typecheck/lint/Jest (36 new tests; 1979 total green);
             |  live DB/auth flow not exercised (no local Supabase). Next: wire the actual
             |  gated SEND on approve; add Build (term-drift) + Run (stale-mark) triggers;
             |  connect a live Carta Composio toolkit; graduate high-confidence Execute
             |  signals to background push.

2026-07-11  |  Landing gate → unlock  |  Public landing CTAs now open in-page previews.
             |  Built: app/page.tsx repoints "Meet Earn" → #meet-earn and "Explore
             |  Workspace" → #workspace-preview (hero + footer) instead of jumping to
             |  signup / #operating-model. Three new components/marketing/*:
             |  - MeetEarnTeam: Earn (the associate/orchestrator) featured as a hero card,
             |    then the full 14-executive roster, pulled LIVE from lib/agents.ts so the
             |    card never drifts from the seed catalog.
             |  - WorkspacePreview: a static mock mirroring components/Workspace.tsx
             |    (objective bar, task rows w/ agent progress, an approval gate, agent rail);
             |    sample data only, no live tasks.
             |  - AccessGate: the shared Sign in (/login) / Request access (/login?mode=signup)
             |    CTA panel; Request access is the sole signup path.
             |  Two-step history: first shipped GATED (PR #823, merged) — previews sealed
             |  behind a bottom fade-mask + absolute lock scrim with pointer-events-none;
             |  then UNLOCKED (PR #825, merged) — dropped the mask/scrim so both previews are
             |  fully visible and interactive, and AccessGate became an in-flow invitation
             |  rather than a lock. Marketing stays public; auth is the entry, not a wall.
             |  Decision: reveal the product in-page (roster + workspace) and treat Sign in /
             |  Request access as the invitation, not a gate over the content. Styling reuses
             |  the fx-* tokens (fx-card, fx-glass, gold accents, surface ramp).
             |  Confidence: tsc --noEmit + eslint clean on changed files; dev-server render
             |  (HTTP 200) verified; Vercel preview deployed green on both PRs.
             |  Next: if we want landing-page "memory" in the product itself, add a returning-
             |  visitor touch (recall last section / dismissed gate / signed-in shortcut).

2026-07-18  |  Native Intelligence Layer + Signal Bureau connector  |  Canonical
             |  intelligence records + an optional external feed, feeding Earn's
             |  existing loop — not a parallel intelligence app.
             |  Audit finding: the intelligence MACHINERY (signals, gates, routing,
             |  PMI sources, provenance, proactive pipeline) is mature, but the
             |  canonical RECORD layer (observations/entities/exposures/assessments/
             |  watchlists/provider-connections) was ABSENT. Built exactly that gap.
             |  Layer A (native, owned): migration 20260718120000_intelligence_core
             |  (8 tables, organization_id tenancy, canonical helper RLS,
             |  set_updated_at, observations+assessments on realtime); lib/intelligence/*
             |  — provider-neutral types + IntelligenceProvider seam; a multi-dimensional,
             |  workspace-configurable, VERSIONED relevance engine where trust
             |  (evidence/freshness/confidence/calibration) only ever DISCOUNTS and
             |  every dimension stays visible (score_breakdown); pure entity resolution;
             |  a routing matrix onto the 15 AgentKeys + gate tiers that can NEVER emit
             |  a Tier-3 follow-on; dedup by content hash; ingest/sweep/store/connections/
             |  assess; flags (core-gated). Layer B (optional, removable): the
             |  signal-bureau connector — quarantined sb.signals.v1 schema, an
             |  anti-corruption adapter (normalizes timestamps/trajectory/evidence,
             |  preserves raw payload, tolerates additive drift), a resilient REST client
             |  (timeout/backoff/jitter/retry-after), and the provider impl (REST live;
             |  MCP + ask declared, flag-gated, degrade gracefully). Wiring: one
             |  best-effort, flag-gated block in /api/cron; secrets via the AES-256-GCM
             |  vault; signal-bridge maps actionable assessments into the proactive loop.
             |  Decision: reuse gates/mandates/engine/vault/RLS/cron wholesale and
             |  build ONLY the missing canonical layer + connector — additive, no active
             |  system duplicated, FundExecs fully works with the provider disabled.
             |  Deferred (backlog in docs/intelligence): UI drawer/hub sections/provider
             |  panel, live proactive-trigger wiring, MCP binding, async ask, DB-type regen.
             |  Confidence: Tested by typecheck/eslint/Jest (93 new tests; 3031 total
             |  green, no regressions); live DB/auth flow not exercised (no local Supabase).

2026-07-18  |  Native Skill System + Operational Executive Team  |  A governed,
             |  versioned, testable unit of work — the Phase-1 kernel backbone.
             |  Audit finding: the execution SUBSTRATE (engine, gates, mandates,
             |  artifacts, audit, sessions) is mature, but there was NO first-class
             |  "skill" (no /skills, skill.yaml, or skill_runs) and NO operational
             |  executive governance model (roster was 15 marketing-leaning agents;
             |  lib/executive-team.ts was an unreconciled parallel vocab). Built exactly
             |  those two gaps, additively.
             |  - lib/skills/*: SkillManifest/SkillDefinition types; a dependency-free
             |    JSON-Schema-subset validator; a registry; a runtime (runner.ts) whose
             |    pure executeSkillCore path is: authorize (executive may run skill?) →
             |    validate INPUT → run deterministic core → validate OUTPUT → resolve
             |    approval tier (Tier 3 never delegable) → SkillResult; runSkill adds
             |    skill_runs persistence + an immutable audit event. Reference skill
             |    screen-deal (deterministic core: pass/watch/fail, computed EV/EBITDA as
             |    a CALCULATION, leverage as a labelled ASSUMPTION, missing data FLAGGED
             |    never invented) + its /skills/screen-deal/ authoring package (SKILL.md,
             |    skill.yaml, policy.yaml, evaluation.yaml, JSON schemas, example), kept
             |    consistent with the TS manifest by a test.
             |  - lib/executives/registry.ts: operational executive team keyed to the
             |    existing AgentKey spine (no enum/type churn), ACTIVATING the missing
             |    Investment Committee / Risk & Compliance / Legal & Closing roles, each
             |    with a bounded domain, allowed skills, data scope, approval CEILING
             |    (<=2), prohibited actions, handoffs, review standard.
             |  - migration 20260718140000_skill_runs (org-scoped, canonical RLS,
             |    realtime): the accountable run ledger — validated I/O, sources
             |    (fact/assumption/calculation/generated), approval tier, provider/model.
             |  Decision: reuse gates/audit/agents/mandates wholesale; the skill runtime
             |  is the smallest coherent Phase-1 kernel the rest of the program (returns,
             |  dd-checklist, ic-memo; the inference gateway; artifact formats) builds on.
             |  NO engine changes — engine↔skill wiring is a flagged follow-on.
             |  Deferred (backlog in docs/skills): provider-agnostic inference gateway,
             |  skill↔engine wiring, priority-1 deal skills, DOCX/PDF artifacts, session
             |  evidence UI, and the OUTSTANDING Phase-0 fix of the invented "$2B+" metric.
             |  Confidence: Tested by typecheck/eslint/Jest (31 new tests; 3062 total
             |  green, no regressions); live DB/auth flow not exercised (no local Supabase).

2026-07-18  |  Provider-agnostic inference gateway + Phase-0 stabilization  |  Two
             |  master-prompt non-negotiables: "don't hard-code Anthropic" and
             |  "don't display invented metrics".
             |  A) lib/inference/*: a capability-based gateway. A caller asks for a
             |  CAPABILITY (+ optional data sensitivity / region / context size /
             |  tier / cost), not a model; a pure, tested router (router.ts) picks the
             |  model over the available providers (hard filters: available, capability,
             |  restricted→private/region, region, context window, cost ceiling; ranked
             |  by tier preference → sensitivity-aware bias → cost). The Anthropic adapter
             |  reuses anthropicClient() and mirrors lib/brains/llm.ts exactly (fast
             |  default, effort-gating, error→null), declaring three env-overridable
             |  tiers. runInference degrades (never throws) when no model qualifies, so
             |  every caller keeps its deterministic fallback. Reversible proof:
             |  lib/brains/llm.ts routes through the gateway behind INFERENCE_GATEWAY_ENABLED
             |  (off by default → the direct Anthropic path is unchanged). OpenAI/Google/
             |  local are now just new InferenceProvider adapters + one registry line.
             |  B) Phase-0: removed the invented "$2B+ deal flow tracked" counter and the
             |  fabricated testimonial from app/page.tsx; kept only verifiable facts (4
             |  hubs; executive count DERIVED from AGENTS.length so it can't drift); fixed
             |  StatCounter's zero-on-hydration defect (resting value is the real number
             |  on SSR/first-paint/no-JS; the count-up is pure enhancement that always
             |  lands on the true value).
             |  Decision: build the gateway as the new chokepoint + wire ONE consumer
             |  behind a flag rather than ripping out lib/claude.ts's ~15 direct calls
             |  (that reroute + an inference_runs telemetry ledger are the documented
             |  backlog). Additive, no default behavior change.
             |  Confidence: Tested by typecheck/eslint/Jest (15 new tests; 3077 total
             |  green, no regressions); app not run live (no local env).

2026-07-18  |  Priority-1 deal skills + session-attached runner + evidence UI  |
             |  The §22 acceptance chain (screen→returns→dd-checklist→ic-memo) + the
             |  safe "skills run in a workflow, visible in the UI" wiring.
             |  - Three new deterministic skills, built IN PARALLEL by three backend
             |    subagents then integrated centrally: `returns` (LBO: MOIC/IRR +
             |    bear/base/bull sensitivities; null unless entryEbitda+entryMultiple
             |    present; defaults labelled assumptions), `dd-checklist` (16-workstream
             |    request list, rule-tailored; only PREPARES — Tier-2 send prohibited),
             |    `ic-memo` (12-section pre-read from structured deal data; ADVISORY,
             |    missing data → open item, never a fabricated fact). Each is a full
             |    /skills/<id>/ package + pure core + golden tests, registered in
             |    lib/skills/registry.ts; a generalized catalog-consistency test guards
             |    all four (manifest≡on-disk schemas, executives permitted, valid tier).
             |  - Wiring: audit found a blind mid-loop auto-trigger would have to run
             |    skills on FABRICATED input (mandates table has no screening criteria;
             |    workflows have no structured deal fields mid-run) — violating "never
             |    invent financial values". So instead of editing the sacred engine loop:
             |    engine-bridge.ts (pure, tested detectSkillForStep — the seam for future
             |    planner step-tagging); session-run.ts runSkillAttached (runs a skill on
             |    EXPLICIT structured input, writes its output as a normal artifact +
             |    skill_run linked to the session/workflow, emits artifact.created);
             |    app/(app)/sessions/skill-actions.ts runSkillInSession (org-scoped,
             |    permission-checked server entry point). NO engine.ts change.
             |  - Session-evidence UI: components/session/SkillRunFeed.tsx (mirrors
             |    BrainFeed), mounted on the session page — renders each skill_run with
             |    gate tier, confidence/completeness, the provenance breakdown
             |    (facts/assumptions/calculations/generated), and flagged missing data.
             |  - Artifacts: PHASED per operator call — phase 1 = skills persist a
             |    markdown artifact through the existing system (no new dep); DOCX/PDF
             |    render module is phase 2 (documented in docs/skills/deal-suite.md).
             |  Confidence: Tested by typecheck/eslint/Jest (62 new tests; 3139 total
             |  green, no regressions); live session render not exercised (no local env).

2026-07-18  |  Phase 2-3 skills: financial analysis + capital/LP ops  |  Six more
             |  governed deterministic skills, built IN PARALLEL (six backend subagents)
             |  then integrated centrally. Registry now holds 10 skills.
             |  - Phase 2 (Analyst): `comps` (comparable multiples → implied EV/equity +
             |    range; thin-set flagged), `dcf` (projected FCF/PV/terminal/EV/equity/
             |    per-share + WACC/terminal sensitivities; hard guard discount>terminal),
             |    `unit-economics` (LTV, LTV/CAC, payback, health band; churn-0 guarded).
             |  - Phase 3 (Investor Relations, DRAFT-ONLY): `capital-call`, `lp-update`,
             |    `distribution-notice` — each PREPARES a draft notice/letter and never
             |    sends or moves capital (Tier-2/Tier-3 stay human); amounts/dates/wiring
             |    never fabricated (missing → open item; wiring always a placeholder).
             |  Each is a full /skills/<id>/ package + pure core + golden tests, registered
             |  in lib/skills/registry.ts and permitted by the executive whose allowedSkills
             |  already anticipated its id. The generalized catalog-consistency test now
             |  auto-covers all 10 skills (manifest≡schemas, executives permitted, tier
             |  valid). No new wiring — the runtime, session-attached runner, and evidence
             |  panel already handle any registered skill.
             |  Confidence: Tested by typecheck/eslint/Jest (~91 new tests; 3230 total
             |  green, no regressions). Pure backend — no app/components changes.

2026-07-18  |  Phase 4-5 skills: fund administration + portfolio operations  |  Six
             |  more governed deterministic skills, built IN PARALLEL (six backend
             |  subagents) then integrated centrally. Registry now holds 16 skills.
             |  - Phase 4 (Fund Admin, prepare-only — never posts/closes/moves/approves):
             |    `reconcile` (statement↔ledger difference + break detection),
             |    `nav-review` (NAV roll-forward tie-out; prior NAV anchor, absent flows
             |    labelled assumptions), `close-period` (8-task close-readiness checklist;
             |    closing the period is Tier-3 human, prohibited).
             |  - Phase 5 (Portfolio Ops): `portfolio-review` (budget-to-actual variance +
             |    covenant checks), `value-creation` (EBITDA bridge, gap-to-target, ranked
             |    initiatives, 100-day plan), `kpi-ingest` (KPI normalization vs target).
             |  Each is a full /skills/<id>/ package + pure core + golden tests, registered
             |  in lib/skills/registry.ts and permitted by the executive whose allowedSkills
             |  already anticipated its id. The generalized catalog-consistency test now
             |  auto-covers all 16 skills. No new wiring.
             |  Catalog (16): screen-deal, returns, dd-checklist, ic-memo, comps, dcf,
             |  unit-economics, capital-call, lp-update, distribution-notice, reconcile,
             |  nav-review, close-period, portfolio-review, value-creation, kpi-ingest.
             |  Confidence: Tested by typecheck/eslint/Jest (78 new tests; 3308 total
             |  green, no regressions). Pure backend — no app/components changes.

2026-07-18  |  Source intelligence + Risk & Compliance skills  |  Six more governed
             |  deterministic skills, built IN PARALLEL (six backend subagents) then
             |  integrated centrally. Registry now holds 22 skills — the full operational
             |  executive bench is now skill-backed.
             |  - Source (Deal Sourcing / Research) — RANK a supplied set, NEVER fabricate
             |    companies: `source-deals` (rank candidates vs mandate), `buyer-list`
             |    (rank acquirers for a sale), `market-map` (segment a supplied company
             |    set). Empty input → empty result + explicit "does not fabricate" note.
             |  - Risk & Compliance — SCREEN + ESCALATE, never the final determination:
             |    `kyc-screen` (rules-grid; status is clear_for_review/incomplete/escalate,
             |    NEVER "approved" — a compliance officer decides), `policy-check` (evaluate
             |    supplied policies → ok/review/restricted; defers the call), `risk-register`
             |    (score a supplied risk set; never invents risks).
             |  Each is a full /skills/<id>/ package + pure core + golden tests, registered
             |  in lib/skills/registry.ts and permitted by the executive whose allowedSkills
             |  already anticipated its id. (Integration fix: the source-deals agent omitted
             |  SKILL.md; the generalized catalog-consistency test caught it, added it.)
             |  Catalog (22) spans deal / financial / capital-LP / fund-admin / portfolio /
             |  source / risk-compliance — covering Analyst, Diligence, IC, IR, Fund Admin,
             |  Portfolio Ops, Deal Sourcing, Research, Risk & Compliance.
             |  Confidence: Tested by typecheck/eslint/Jest (91 new tests; 3399 total
             |  green, no regressions). Pure backend — no app/components changes.

2026-07-18  |  Legal & Closing + Capital Formation + Communications skills  |  Six more
             |  governed deterministic skills, built IN PARALLEL (six backend subagents)
             |  then integrated centrally. Registry now holds 28 skills — EVERY operational
             |  executive now carries at least one native skill (this batch activated the
             |  three that had none: Legal & Closing, Capital Formation, Communications).
             |  - Legal & Closing — coordinate + track, NEVER sign/close: `closing-checklist`
             |    (canonical closing tasks + supplied status → readiness % + blocking items;
             |    always routes to a human for final closing authorization), `deal-tracker`
             |    (roll a supplied milestone set into status/at-risk/next-actions; empty set
             |    → empty tracker + note, never fabricates milestones).
             |  - Capital Formation / IR — profile, pipeline, track, NEVER bind/call capital:
             |    `investor-profile` (structure a supplied LP's facts + fit vs criteria;
             |    never invents AUM/wealth/mandate/PEP — gaps flagged), `raise-pipeline`
             |    (aggregate supplied prospects by stage → probability-weighted expected vs
             |    target; weighting a labelled calculation), `commitment-tracker` (track
             |    supplied commitments vs target close; a missing amount is flagged, never
             |    assumed 0; binding/calling capital is prohibited).
             |  - Communications — draft-only: `teaser` (one-page anonymized deal-teaser
             |    DRAFT from supplied facts; every figure a fact, connective prose labelled
             |    generated; with no financials the section is a flagged placeholder and NO
             |    fact source carries an invented number — directly tested; distribution
             |    stays a gated action).
             |  Epistemics enforced throughout: supplied → fact, derived → calculation,
             |  defaulted → assumption; nothing fabricated, missing input flagged. Each is a
             |  full /skills/<id>/ package + pure core + golden tests, registered in
             |  lib/skills/registry.ts and permitted by the executive whose allowedSkills
             |  already anticipated its id. The generalized catalog-consistency test now
             |  auto-covers all 28 skills. No wiring beyond registration.
             |  Catalog (28) adds legal-closing / capital-formation / communications to the
             |  prior deal / financial / capital-LP / fund-admin / portfolio / source /
             |  risk-compliance families.
             |  Remaining backlog: Analyst modeling (lbo, three-statement, model-audit),
             |  dd-prep, audit-statement, sector-research, cim; plus engine auto-invocation,
             |  artifact DOCX/PDF, and the inference-gateway inference_runs ledger.
             |  Confidence: Tested by typecheck/eslint/Jest (72 new golden tests; 3501 total
             |  green, no regressions). Pure backend — no app/components changes.

2026-07-18  |  Catalog completion — Analyst modeling + Diligence + Fund Admin +
             |  Research + Comms  |  Seven more governed deterministic skills, built
             |  IN PARALLEL (seven backend subagents) then integrated centrally.
             |  Registry now holds 35 skills and THE ANTICIPATED CATALOG IS COMPLETE:
             |  every skill id referenced by any executive's allowedSkills is now
             |  backed by a real tested skill (verified 35 registered = 35 anticipated,
             |  0 missing).
             |  - Analyst modeling — compute from supplied assumptions, never invent:
             |    `lbo` (sources&uses/exit equity/MOIC/IRR; missing required input ->
             |    null + flagged, never guessed), `three-statement` (simplified IS/CF/BS
             |    that TIES OUT every year — balanced by construction via a held-constant
             |    debt + equity plug; unbalanced opening BS flagged), `model-audit`
             |    (rules-grid over a supplied model -> severity findings; never emits a
             |    corrected number).
             |  - Diligence — `dd-prep`: a sequenced/prioritized diligence WORKPLAN
             |    (8 workstreams) distinct from dd-checklist; never diligences or sends.
             |  - Fund Admin — `audit-statement`: ties supplied statement lines to
             |    supporting schedules -> variances/unsupported; never opines or signs off;
             |    missing support is unsupported, never assumed equal.
             |  - Research — `sector-research`: organizes a supplied research set + grades
             |    source quality; every claim needs a supplied source, unsourced flagged,
             |    never emitted as a fact; never fabricates market data.
             |  - Communications — `cim`: a CIM draft OUTLINE (7 sections) from supplied
             |    facts; financialSummary uses only supplied figures, with none it is a
             |    flagged placeholder and NO fact source carries an invented number
             |    (directly tested); draft-only, distribution stays gated.
             |  Epistemics enforced throughout: supplied -> fact, derived -> calculation,
             |  defaulted (no-expansion, held-constant debt, equity plug, materiality,
             |  template status) -> assumption; nothing fabricated, missing input flagged.
             |  Each is a full /skills/<id>/ package + pure core + golden tests, registered
             |  in lib/skills/registry.ts and permitted by the executive whose allowedSkills
             |  already anticipated its id. The generalized catalog-consistency test now
             |  auto-covers all 35 skills.
             |  The native skill catalog is now FEATURE-COMPLETE. Remaining work is
             |  infrastructural, not new skills: mid-loop engine auto-invocation, artifact
             |  DOCX/PDF phase 2, and the inference-gateway inference_runs ledger + routing
             |  lib/claude.ts through it (+ real OpenAI/Google adapters).
             |  Confidence: Tested by typecheck/eslint/Jest (122 new tests; 3623 total
             |  green, no regressions). Pure backend — no app/components changes.

2026-07-18  |  Engine skill auto-invocation (behind a flag)  |  First vertical
             |  slice of mid-loop auto-invocation: the workflow engine can now run a
             |  GOVERNED skill in place of a free-text step generation — but only when
             |  the step maps to a skill AND real structured input is present, and only
             |  when SKILL_AUTOINVOKE_ENABLED=true. Default OFF: with the flag off the
             |  engine is byte-for-byte unchanged (the fetch, context assembly, planning
             |  call, and execution branch are all gated).
             |  The missing piece was structured input: the mandate had free-text scope
             |  but no machine-readable criteria a skill could consume. Added:
             |  - migration 20260718160000 — mandates.screening_criteria (nullable jsonb;
             |    sectors/geographies/rev-EBITDA-EV bands/transactionTypes/exclusions, the
             |    exact shape screen-deal/source-deals accept). Additive; legacy gate
             |    paths unchanged; null = no criteria (silent dim never a fabricated bound).
             |  - lib/skills/screening-criteria.ts — defensive pure parser (keeps only
             |    well-typed values; null when nothing survives; never coerces/invents).
             |  - lib/mandates.ts getActiveScreeningCriteria — best-effort read, kept
             |    separate from the gate-layer getActiveMandate.
             |  - lib/skills/skill-planner.ts planSkillForStep — pure: returns a plan
             |    (skillId + permitted executive + assembled input) only when the step is
             |    a skill AND its REQUIRED input is present for real; forwards only present
             |    fields (missing → left absent so the skill flags it, never filled);
             |    returns/ic-memo/dd-checklist DEFER (rich input not present mid-workflow).
             |  - lib/skills/engine-run.ts executePlannedSkill — runs the governed core,
             |    renders a reviewable deliverable, records a best-effort skill_run; does
             |    NOT make its own artifact (the engine's step pipeline persists it), so
             |    auto-invoked output flows through the SAME grounding/critique/approval
             |    gate — review is never bypassed. External-action steps take precedence.
             |  Guardrail intact: no skill ever runs on fabricated input — that is exactly
             |  why auto-invocation waited for structured criteria to exist.
             |  Remaining follow-ups: mandate-criteria authoring UI; link a deal to a
             |  workflow earlier + thread a candidate set (so it fires on first-run, not
             |  only continuations); planner-emitted skill tags to replace regex detection.
             |  Confidence: Tested by typecheck/eslint/Jest (22 new tests; 3645 total
             |  green, no regressions). Backend + one additive migration; no app/component
             |  changes.

2026-07-18  |  Inference-run ledger + artifact document export  |  Two independent
             |  infra items built IN PARALLEL (two backend subagents) then integrated
             |  centrally. Both self-contained, dependency-free, additive.
             |  - Inference ledger: migration 20260718180000 inference_runs — an
             |    APPEND-ONLY telemetry ledger (no updated_at/trigger, no realtime;
             |    like dispatch_log) for the provider-agnostic gateway: capability,
             |    provider/model, prefer-tier, sensitivity, ok/degraded, in/out tokens,
             |    latency, purpose label, optional session/workflow links, error; org
             |    RLS, idempotent. lib/inference/store.ts persistInferenceRun (server-
             |    only, best-effort, never throws; narrow unknown-cast like skills store)
             |    + lib/inference/logged.ts runInferenceLogged(ctx, req) = runInference
             |    then persist telemetry best-effort, result returned unchanged (the
             |    executeSkillCore-pure + runSkill-persists pattern for inference).
             |    Deferred to its own increment: routing lib/claude.ts through the gateway.
             |  - Artifact export: lib/artifacts/export.ts — pure, dependency-free,
             |    hand-rolled markdown renderers: renderMarkdownToRtf (valid RTF 1.0,
             |    opens in Word/Pages; escapes \{} + non-ASCII), renderMarkdownToHtml
             |    (self-contained print-styled doc, the print-to-PDF path), renderArtifact
             |    dispatch; ReDoS-safe (input cap, line-based, bounded tokenizer, never
             |    throws). Route app/api/artifacts/[id]/export?format=rtf|html|md —
             |    requireOrgContext + RLS + org filter, 400/404 guards, attachment
             |    filename slugified from title. RTF/HTML chosen over binary docx/pdf to
             |    stay dependency-free; the renderArtifact boundary is where a future
             |    docx dependency plugs in.
             |  Confidence: Tested by typecheck/eslint/Jest (21 new tests; 3666 total
             |  green, no regressions). Backend + one additive migration + one download
             |  route; no UI/component changes.

2026-07-18  |  Binary DOCX/PDF export + front-end surfaces  |  Made two recent
             |  backend slices usable end to end. Built partly in parallel (three
             |  subagents: binary renderers, download menu, criteria editor) then
             |  integrated centrally. FIRST front-end change of this workstream —
             |  reuses existing components/patterns throughout.
             |  - Binary export: new deps docx ^9.7.1 + pdf-lib ^1.17.1 (pure-JS,
             |    server-side, no headless browser). lib/artifacts/export-binary.ts —
             |    renderMarkdownToDocx (real Word doc: title/H1-3/bullets/blockquote/
             |    code/hr + inline runs) and renderMarkdownToPdf (real PDF: paged, page-
             |    break cursor, per-span fonts, WinAnsi sanitize so StandardFonts never
             |    throw, O(N) word-wrap, try/catch fallback to a minimal valid PDF).
             |    Reuses the exported parseBlocks/parseInline from export.ts (no dup
             |    markdown logic). export.ts ExportFormat now includes docx/pdf +
             |    isBinaryFormat; renderArtifact stays the sync text path. Route
             |    /api/artifacts/[id]/export?format=rtf|html|md|docx|pdf returns binary
             |    as an ArrayBuffer (valid BodyInit) with the right content type.
             |  - Download menu: components/ArtifactViewer.tsx ArtifactActions gains an
             |    id prop + a bespoke Download dropdown (one <a download> per format),
             |    threaded from both ArtifactInline sites; keeps the Blob fallback when
             |    id is absent. Cookie auth → plain links download.
             |  - Mandate criteria editor: components/mandate/CriteriaEditor.tsx (chip
             |    inputs for sectors/geographies/transactionTypes/exclusions + numeric
             |    band inputs), wired into MandateEditor + the settings page (reads/parses
             |    the column) + saveMandate (writes screening_criteria on update+insert)
             |    + getActiveMandateRow selects it. Closes the loop: operator authors
             |    structured criteria in the UI -> persists -> getActiveScreeningCriteria
             |    feeds the engine's skill planner (behind SKILL_AUTOINVOKE_ENABLED).
             |  Remaining: route lib/claude.ts through the inference gateway + real
             |  OpenAI/Google adapters (the last backend seam).
             |  Confidence: Tested by typecheck/eslint/Jest (binary magic-byte + format
             |  tests; 3676 total green, no regressions). Backend + UI; new deps docx +
             |  pdf-lib; no new migration.

2026-07-18  |  Route lib/claude.ts free-text generation through the inference
             |  gateway (flagged + fallback)  |  The last backend seam of the provider-
             |  abstraction workstream. executeStep (the workflow's free-text deliverable
             |  generator) can now run through the provider-agnostic gateway instead of
             |  calling Anthropic directly, recording each call in the inference_runs
             |  ledger. Behind CLAUDE_VIA_GATEWAY_ENABLED, default OFF: with the flag off
             |  the direct-Anthropic path is byte-for-byte unchanged, and it stays the
             |  guaranteed fallback whenever the gateway is disabled/degraded.
             |  - lib/claude.ts: tryGatewayText({system,prompt,capability,maxTokens,
             |    purpose,ctx}) returns text when gateway enabled+configured+ok, else null
             |    so the caller runs the existing path; logs via runInferenceLogged when an
             |    orgId is present. executeStep tries it first, then falls to
             |    anthropic.messages.create, then the deterministic stub. Never throws.
             |  - lib/engine.ts threads org/session/workflow ctx into executeStep so a
             |    routed run is attributable in inference_runs.
             |  Only executeStep routes: the other claude.ts calls (generatePlan/Plans,
             |  generateClarifyingQuestions, earnFollowups, extract*) depend on Anthropic's
             |  JSON-schema tool (structured outputs) the gateway does not expose yet, so
             |  they stay direct until the gateway grows a structured-output capability;
             |  earnChatStream stays direct (gateway is request/response, not a stream).
             |  This removes the hard Anthropic coupling on the highest-volume LLM call
             |  and lets a non-Anthropic provider serve the workflow without touching call
             |  sites — only real OpenAI/Google adapters remain to make it multi-provider.
             |  Confidence: Tested by typecheck/eslint/Jest (flag-off default asserted;
             |  3678 total green, no regressions). Backend only; no migration, no new deps.

2026-07-18  |  Private Markets Terminal + Extension Platform — Phase 0 audit
             |  (docs only)  |  Mandatory repository/product audit before any terminal
             |  production code. Ran SIX parallel read-only Explore agents across
             |  identity/access, shell/orchestration/approvals, entities/CRM/search,
             |  financial/portfolio/fund-admin, intelligence/signals/providers, and
             |  integrations/extensibility; synthesized centrally into six deliverables:
             |  docs/audits/FUNDEXECS_FEATURE_MATRIX.md, FUNDEXECS_TERMINAL_GAP_AUDIT.md,
             |  GLOOMBERB_PATTERN_ADOPTION_MATRIX.md;
             |  docs/architecture/PRIVATE_MARKETS_TERMINAL_ARCHITECTURE.md,
             |  EXTENSION_PLATFORM_ARCHITECTURE.md;
             |  docs/implementation/TERMINAL_IMPLEMENTATION_PLAN.md.
             |  Key findings: the platform is mature (229 migrations) and MOST terminal
             |  substance already exists — entities/war-rooms, 3-tier gates + mandates +
             |  autonomy, skills runtime, engine write-back, financial metric engines,
             |  intelligence-core schema, ELEVEN reusable registry seams (skills, inference
             |  router, intelligence provider registry, integrations adapters, MCP registry,
             |  vault, gate tiers, API scopes...), a Cmd-K palette (nav-only), and a strong
             |  mobile shell. Genuine green-field: (1) the multi-pane/dockable terminal
             |  shell, (2) an executable command LANGUAGE/registry on the existing palette,
             |  (3) the extension manifest/lifecycle/sandbox. Genuine ACTIVATION: watchlists
             |  (schema exists but inert), alert evaluation (stub) + delivery (missing),
             |  intelligence-core flags (dark), gateway adoption (~40 files still hard-code
             |  Anthropic). Concrete financial gaps: true XIRR (only MOIC^(1/y) proxies),
             |  exposure-dimension aggregation, covenant register, provenance-in-cockpit.
             |  Disposition taxonomy per capability: REUSE / ACTIVATE / BUILD / EXTENSION /
             |  DEFER. Sequenced Release 1-6 with additive RLS-scoped migrations, flag-gated
             |  default-off, action/safety contract mapping 10 side-effect levels onto the
             |  existing 3 gate tiers (capital-binding always Tier-3 non-delegable, for
             |  users/agents/API keys/extensions alike). Gloomberb used as PATTERN
             |  inspiration only — no code vendored, no runtime dependency, read-only
             |  off-by-default interop deferred to an extension.
             |  Confidence: Documentation deliverable (no code); grounded in an evidence-
             |  backed six-agent inventory with cited file paths. No production code, no
             |  migration, no test change this increment.
```

---

*This file is the Associate Agent's memory before the Associate Agent exists.*
*When the agent is built, it will read this file first.*
*When the system learns, it will write back to this file.*
*The prompt and the product are the same thing.*
