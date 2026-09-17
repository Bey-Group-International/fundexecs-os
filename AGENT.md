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
- ✅ Live meetings — a browser WebRTC mesh at `/meetings/[roomId]`, with the
  waiting room, backgrounds and device picking a call needs to be usable by a
  guest who has never seen the product. The rules the call runs on are pure and
  tested in `lib/meetings/` rather than buried in the component, because none of
  them can be exercised by a browser in CI: negotiation and link policy
  (`connection.ts`), waiting-room admission (`admission-session.ts`,
  `admission-poll.ts`), segmentation (`backgrounds.ts`) and host alerting
  (`knock-notice.ts`). What that layer has had to learn, so far:
  - A mesh has no server to absorb a bad uplink, so every sender is capped
    against a shared upstream budget and steps DOWN and back UP on measured loss.
    Adaptation that only ever steps down is a ratchet: a room that drops to
    audio-only can no longer produce the bitrate its own recovery test demands,
    and stays there for the rest of the call.
  - An external guest is the participant most likely to be behind a NAT that a
    direct path never traverses, and the least able to do anything about it. They
    are sent straight to the relay when one is available; the host and teammates
    are not, because a relay they did not need is a hop they pay for.
  - The host is the only person who can let a guest in, and is usually in another
    tab when the guest knocks. A browser notification is the only channel that
    reaches them there — and `Notification.requestPermission()` needs a live user
    activation, which does not survive an `await`, so it is asked for on the same
    tick as the click and never on page load.
  - Person segmentation trained on faces treats headwear as background. The
    confidence mask plus a small dilation of the person region keeps caps, hats
    and headscarves, and is cheap enough to be free when the dilation runs on the
    downscaled mask grid rather than the full frame.
- ✅ Meeting recording — the host's browser composites the mesh to a canvas,
  mixes every participant's audio, and encodes one watchable file. Active
  speaker with a grid fallback; a shared screen takes the frame. Uploaded in
  five-second parts during the call and served back through a Range-aware route
  that stitches them, so a recording survives the laptop that made it and can
  still be seeked. 720p, 90-day retention, swept by the hourly cron. Every
  participant sees the same recording badge, from the same broadcast.
  - A record only exists if something reads it. The transcript table was
    written by every call for months and restored by nothing, so the real
    durability of a meeting was one browser tab. A write path with no read path
    is not a backup; it is a habit.
  - Who owns a piece of data has to be decided once, explicitly. Everyone
    holding the whole transcript and everyone saving it are different things,
    and conflating them cost one stored copy per participant.
  - Progress through a list that other people can insert into cannot be a
    position. It has to be identity, or the mark moves under you.
  - A guest has no session, so anything behind `auth.uid()` silently excludes
    exactly the person the feature is for. RLS cannot fail loudly; a route can.
  - A mesh has no server in the middle, so it has no place to record from. Any
    feature needing every stream at once has to run in a participant's browser,
    which makes that participant's laptop a single point of failure — and the
    fix is always the same one phase 1 found: send the work somewhere durable as
    it is produced, not when it is finished.
  - Auto-directed video needs hysteresis or it is unwatchable. Cutting to
    whoever is loudest right now produces a frame that flicks at every "mm-hm".
  - Consent is a property of the room, not a setting on the recorder. If only
    the person recording can see that a recording is happening, notice has not
    been given — so it rides a broadcast every participant renders, and it is
    re-sent whenever somebody joins.

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

2026-07-18  |  Terminal Release 1 — spine (contracts + persistence, flag-off)  |
             |  First production slice of the Private Markets Terminal: the pure, tested
             |  contracts + the persistence foundation the shell/command-bar build on. No
             |  UI yet. Behind TERMINAL_ENABLED, default OFF.
             |  - lib/terminal/action-contract.ts: the unified action & safety contract
             |    (System 9) — projects the spec's 10 side-effect levels onto the existing
             |    3 gate tiers (lib/gates.ts), NOT a fork. read-only/draft/internal/
             |    capital-analysis -> Tier 1; external/compliance/destructive -> Tier 2
             |    operator; capital-binding/transaction-execution -> Tier 3 human
             |    NON-DELEGABLE, re-asserted in code so no table/mandate/manifest can lower
             |    it for any actor (users/agents/API keys/extensions). Pure + tested.
             |  - lib/terminal/{types,commands/registry,parse}.ts: a typed CommandDefinition
             |    (mirrors SkillManifest) + an initial ~40-command catalog (navigation
             |    DEAL/FUND/LP/PIPE/WATCH; analysis LBO/VAL/WATERFALL/CAPTABLE/EXPOSURE;
             |    workflow SOURCE/OUTREACH/CAPCALL/REPORT/ASK EARN) each declaring its
             |    side-effect level (CAPCALL/DISTRIBUTE = capital-binding Tier-3), + a pure
             |    parser with longest-verb-prefix matching (ASK EARN, CREATE DEAL),
             |    case-insensitive verbs/aliases, null for non-commands (NL fallback).
             |  - migration 20260718200000_terminal_core.sql: terminal_workspaces,
             |    terminal_layouts (versioned jsonb pane tree), saved_commands, and an
             |    append-only command_runs ledger (verb + resolved side-effect + gate tier
             |    + status) — the terminal observability spine, mirroring skill_runs/
             |    inference_runs. Org RLS member-read/writer-write, idempotent, additive.
             |  - lib/terminal/config.ts TERMINAL_ENABLED (default off).
             |  Reuse-not-fork throughout: wraps gates.ts, mirrors the skills registry,
             |  extends the API-scope vocabulary. Capital-binding stays human, tested.
             |  Confidence: Tested by typecheck/eslint/Jest (18 new tests; 3696 total
             |  green, no regressions). Backend contracts + one additive migration; no UI,
             |  no engine change, no new deps.

2026-07-18  |  Terminal Release 1 — shell (multi-pane workspace + command bar)  |
             |  The surface on top of the spine: the configurable multi-pane workspace
             |  (System 1) + the command bar that parses -> previews -> dispatches through
             |  the action contract, writing command_runs (System 2 + 9). Behind
             |  TERMINAL_ENABLED, default OFF; /terminal redirects home when off, no nav
             |  entry.
             |  - lib/terminal/layout.ts: pure pane-tree model (LeafPane/SplitPane) with
             |    open/split/close/update/resize/focus as pure (layout,..)->layout
             |    transforms, deterministic preset layouts, and a version-guarded, totally
             |    tolerant serialize/deserialize (garbage/unknown-type/dangling-focus/
             |    single-child-split/bad-version all handled). Resize honors a per-pane
             |    floor EVEN after renormalization (clampSizes) so a pane can't be dragged
             |    to zero. Pure + tested.
             |  - lib/terminal/dispatch.ts: planCommand(raw) -> CommandPlan (pane, tier,
             |    approval, non-delegable, summary) via classifySideEffect; the SAME
             |    decision the client previews and the server records, so they can't
             |    disagree. Pure + tested.
             |  - lib/terminal/store.ts: logCommandRun + loadTerminalWorkspace/
             |    saveTerminalLayout, user-cookie client (RLS enforces tenancy), narrow
             |    unknown-cast like inference/store, best-effort (never throws).
             |  - app/(app)/terminal/{page,actions}.ts: flag-guarded authed route +
             |    server actions. Authorization RE-DERIVED server-side from the raw text —
             |    client-claimed tier never trusted; an approval-required command is
             |    clamped to pending_approval (a gated action is never recorded executed).
             |  - components/terminal/{TerminalShell,CommandBar,PaneView}.tsx: reducer over
             |    the pane tree, resizable splits, live tier-chip preview, honest panes
             |    (deep-link out; never show invented figures; analysis pane states the
             |    live model wires in later).
             |  Scope: executes read-only navigation + opens analysis/Copilot workspaces;
             |  every workflow command (writes, capital events, outreach) is recorded as
             |  pending_approval intent awaiting execution wiring + human approval —
             |  nothing fabricated or bound-executed. Capital-binding stays Tier-3 human.
             |  Follow-up 2 (2026-09-07): /request-access becomes a real sign-up form.
             |  Migration 20260907120000 adds applicant_type + the onboarding-shaped
             |  columns (organization_name, hq_location, aum_range, fund_count,
             |  primary_strategy, website, phone) + details jsonb.
             |  Six applicant types: gp, family_office, advisory, operator, lp,
             |  service_provider. Decision: applicant_type is its OWN vocabulary, not
             |  organizations.operator_role — four map 1:1 and prefill the wizard's role;
             |  lp/service_provider have no operator_role and would have meant widening
             |  the ecosystem matcher's lane matrix, so they pick their role in
             |  onboarding instead. Captured and approved like anyone else.
             |  Decision: two column shapes. Answers ONBOARDING also asks for get typed
             |  columns (prefill is then a straight copy, reusing the same aum_range
             |  buckets and strategy slugs organizations constrains); reviewer-only
             |  answers that vary per type (service line, ticket size, sector) go in
             |  details jsonb rather than a wide sparse table that grows a column per
             |  question.
             |  lib/access-request-fields.ts is the single schema: the form, its
             |  validation, the alert email, the admin card and the decision page all
             |  render from it. A select value the form never offered is refused; a field
             |  the chosen type wasn't asked is dropped, not stored.
             |  Prefill: app/onboarding reads the approved request by email and seeds the
             |  wizard — prefilled and EDITABLE, since a request-time answer is often
             |  approximate and shouldn't silently become the org record.
             |  In-app notice: countPendingAccessRequests badges the sidebar's Admin
             |  console link, computed only for platform admins (it is a cross-org
             |  service-role read).
             |  Still no password at request time: an account exists only after approval.
             |  Confidence: typecheck/eslint clean, production build passes, Jest +40 new
             |  (3724 total green, no regressions). Additive UI + two lib modules + one
             |  route; no migration, no engine change, no new deps.
2026-08-28  |  session_shares scoped uniqueness  |  One share row per session per scope.
             |  Decision: a session has at most one share link per scope, and where
             |  duplicates exist the EARLIEST row is the one kept and handed out — its
             |  token is the one most likely already circulating, so rotating to a newer
             |  row would silently break a link someone holds.
             |  Context: session_shares only ever enforced token uniqueness, and
             |  createSessionShare inserted unconditionally from migration 0018 — a new
             |  row and a new live token on every click, none ever shown to the operator.
             |  Measured before acting: session_shares is empty in production (0 rows
             |  against 12 orgs / 17 sessions), so nobody had ever created a share and no
             |  live link is revoked by the dedup. The dedup ships anyway, defensively,
             |  for environments that may not be empty.
             |  Built: migration 20260828193000 (dedup keeping earliest per triple, then a
             |  unique index on (session_id, organization_id, scope)); lib/share-links.ts
             |  as the single minting path for both writers, upserting with
             |  ignoreDuplicates so an existing token is reused rather than rotated;
             |  createSessionShare now returns its URL instead of discarding it.
             |  Rejected: adding the unique index alone. It cannot build while duplicates
             |  exist, and the writer producing them had to be fixed first or the table
             |  would simply refill between backfill and index.
             |  Confidence: typecheck/eslint clean, production build passes, Jest +6 new
             |  (4328 total green). One migration, one new lib module, no new deps.
2026-09-04  |  Meeting attendees are emailed, by name  |  Scheduling a meeting
             |  notifies everyone on it, and says who it could not reach.
             |  Decision: an attendee entered as a bare name is looked up in the
             |  organization's own member directory and emailed at the address found
             |  there. The match must be unique — a name two members answer to resolves
             |  to neither of them, because emailing a meeting to the wrong colleague is
             |  worse than emailing nobody and saying so. A first name alone matches only
             |  in the internal-attendee field, where "Mike" means the Mike on the team.
             |  Context: the attendee boxes are free text and say "Add people", so people
             |  put names in them. guestEmails only ever collected attendees typed with an
             |  "@", so a teammate on the meeting heard nothing and the host was never
             |  told — the save reported the guests it did reach and stayed silent about
             |  the rest. Separately, a guest ADDED to an existing meeting got an invite
             |  built without the meeting's time or its calendar entry: a join link and no
             |  idea when to use it.
             |  Built: lib/meetings/directory.ts (pure matching, unique-or-nothing) +
             |  directory.server.ts (the member read, on the caller's client — the
             |  principals_select policy already lets a member see their own org, so no
             |  service role); both write paths (/api/meetings/schedule POST,
             |  /api/meetings/[id] PATCH) resolve before saving, so the stored attendee
             |  carries the address and every later reschedule or cancellation reaches
             |  them too; the PATCH invite now carries startIso, duration, sequence and a
             |  whenLabel; sendMeetingInvites gained notifyHost so the host can be the
             |  ORGANIZER on that invitation without being mailed about their own meeting
             |  again; both routes return `uninvited` and the edit screen says it out loud.
             |  Rejected: fuzzy or first-hit name matching. It resolves the ambiguous case
             |  by picking somebody, which is the one outcome worse than not sending.
             |  Confidence: typecheck/eslint clean, Jest +16 new (4402 total green, no
             |  regressions). Two lib modules, two routes, one component; no migration, no
             |  new deps.
2026-09-04  |  Meeting notifications, end to end  |  Four gaps in one path:
             |  the reminder that never fired, the change nobody heard about, the
             |  mailbox nobody knew was missing, and the draft that could not be
             |  published.
             |  Decision: reminder_minutes is now honoured by the hourly cron, not only
             |  by Google for meetings that happened to be synced there. The sweep fires
             |  a reminder up to one sweep EARLY rather than not at all — on an hourly
             |  cadence a "15 minutes before" reminder has no exact moment to be sent
             |  at, and one that lands within the hour before is useful where one sent
             |  after the meeting began is not. It claims the row (UPDATE … WHERE
             |  last_reminder_sent_at IS NULL) before sending, so a crash costs one
             |  reminder rather than mailing a guest list twice.
             |  Decision: an edit notifies attendees when the TIME, the LOCATION or the
             |  JOIN LINK changes — the three an attendee has to act on — and stays
             |  silent on agenda and objective, which they read when they open the
             |  meeting. A save that moves both time and place sends one email, not two.
             |  Decision: with no mailbox connected, sendEmail degrades to channel
             |  "in-app" and the save reports "invited 0", which reads as "nobody had an
             |  address". Both write paths now resolve the mailbox up front and return
             |  mailboxConnected + a reason; /meetings carries a dismissible warning,
             |  backed by a credential-EXISTENCE check (mailboxConfigured) rather than a
             |  token mint, because it runs on every visit.
             |  Context: a draft could be opened from the calendar and edited, but
             |  updateMeeting never clears is_draft — only the schedule endpoint does —
             |  so "Save meeting" on a draft left it a draft and its attendees were
             |  never told the meeting existed. The edit screen now routes a draft
             |  save through that endpoint.
             |  Built: lib/meetings/reminder.ts gained the sweep's due-rules (pure) and
             |  reminder-sweep.server.ts the read/claim/send, wired into /api/cron as a
             |  best-effort block with its own cron-health counters;
             |  meeting-updates.ts gained a "relocated" kind (REQUEST at the same time,
             |  bumped SEQUENCE) and diffMeetingPlace, and its .ics now carries the
             |  meeting's own place instead of always the room link; mailbox.server.ts
             |  gained mailboxConfigured; MailboxWarning.tsx on /meetings.
             |  Rejected: making the reminder sweep strict about its nominal time. It is
             |  correct and it never fires, which is the bug being fixed.
             |  Confidence: typecheck/eslint clean, production build passes, Jest +25 new
             |  (4427 total green, no regressions). Two new modules, one new component,
             |  no migration, no new deps.
2026-09-04  |  Save to calendar, in every meeting email  |  A link that works
             |  in every calendar, not a paperclip only two mail clients read.
             |  Decision: a hosted one-event .ics at
             |  /api/meetings/public/<roomCode>/calendar.ics, linked from the
             |  invitation, the reschedule, the relocation and the reminder. The
             |  attachment stays — it is what makes Gmail and Apple Mail draw an
             |  Accept/Decline card — but for every other client it is a file under a
             |  paperclip that has to be noticed, downloaded and opened, which on a
             |  phone is most of a minute. A link is one tap and behaves the same
             |  everywhere.
             |  Decision: it PUBLISHes rather than invites. Anyone holding the link can
             |  fetch it, and an iTIP REQUEST would have to carry an ORGANIZER address
             |  and the attendee list — exactly what the public lookup beside it
             |  deliberately withholds. Same UID as the emailed invitation, so saving
             |  corrects the entry somebody already holds instead of giving them the
             |  meeting twice.
             |  Decision: the room code is the capability, as it already is for
             |  /meeting-invite/<code>, so no new token. A draft or an untimed meeting
             |  404s, as does an internal failure — no code may behave observably
             |  differently from any other.
             |  Context: booking emails have carried an "Add to Google Calendar" link
             |  since they were written; meeting emails carried nothing but the
             |  attachment. Not offered beside a cancellation or a removal, whose .ics
             |  tells the client to REMOVE the entry — a save button there asks for the
             |  opposite of what the email says.
             |  Rejected: a Google Calendar TEMPLATE link, which is what the booking
             |  emails use. It is free, and it works for one calendar out of three.
             |  Confidence: typecheck/eslint clean, production build passes, Jest +17 new
             |  (4444 total green). One new route, no migration, no new deps.
2026-09-04  |  One save-to-calendar, everywhere  |  Booking emails and the invite
             |  screen join the meeting emails.
             |  Decision: booking emails drop the "Add to Google Calendar" TEMPLATE link
             |  for a hosted .ics at /api/scheduling/booking/<manageToken>/calendar.ics.
             |  The template link worked in one calendar out of three, and the invitee
             |  does not get to choose which one they own. googleCalendarLink and its
             |  date helper are deleted rather than left as a second way to do this.
             |  Decision: keyed on the manage token, not the booking id. The id is
             |  unguessable in practice but it is a database key nobody was handed; the
             |  manage token is what this product already treats as the whole capability
             |  for one booking, and it is already in every booking email.
             |  Decision: the UID is the BOOKING's (inviteUid), not the linked meeting's.
             |  A meeting-scoped UID would have put the same meeting in the invitee's
             |  calendar a second time, beside the entry the confirmation's own .ics
             |  created. Same rule the meeting endpoint follows for its own UID.
             |  Decision: offered on exactly the transitions inviteMethodFor sends a
             |  REQUEST for — confirmed, rescheduled, rescheduled_by_host, host copies
             |  included. A pending request is a hold the host may yet decline, and the
             |  endpoint refuses any booking that is not confirmed, so the button and
             |  the .ics policy cannot drift apart. (The pending email never carried the
             |  Google link either; the policy was already consistent.)
             |  Built: the public meeting lookup now returns scheduledAt / durationMinutes
             |  / timezone (null for a draft), so /meeting-invite/<code> can finally show
             |  WHEN the meeting is — in the reader's own zone, always named, because the
             |  invitee is the one person who may be nowhere near the organizer — and can
             |  gate its own save link on there being a time to save.
             |  Confidence: typecheck/eslint clean, production build passes, Jest +13 new
             |  (4457 total green). One new route, one dead helper removed, no migration,
             |  no new deps.
2026-09-04  |  Five review findings, all real  |  Qodo read the notification work
             |  and found five correctness bugs. Every one reproduced.
             |  Decision: notifications now carry the sequence the SAVE produced, not the
             |  one the row held before it. live_meetings_bump_sequence fires on every
             |  UPDATE, so sending prior.calendar_sequence sent a revision the client
             |  already held — and a client discards those. That is the exact failure
             |  migration 20260827030000 was written to prevent, arriving through the
             |  front door. updateMeeting and deleteMeetingLocal now SELECT the bumped
             |  value back (a soft delete is an UPDATE, so the cancellation was stale
             |  too) and return it.
             |  Decision: an edit that moves a meeting or changes its reminder setting
             |  clears last_reminder_sent_at. The sweep excludes any stamped row forever,
             |  so a meeting rescheduled after its reminder went out could never be
             |  reminded about again. Deliberately NOT cleared on an attendee edit —
             |  adding one guest must not re-mail a reminder to everybody.
             |  Decision: the sweep pages instead of capping. It reads in start-time
             |  order but due-ness depends on each meeting's own lead, so one capped page
             |  let a wall of sooner-but-not-yet-due meetings hide a later one whose long
             |  reminder had come round. Bounded by pages, not by a single limit.
             |  Decision: one horizon. The sweep queried 8 days while canSendReminder
             |  accepts 14, so any setting between them sat permanently outside the query
             |  meant to find it. Both read REMINDER_MAX_LEAD_MS now.
             |  Decision: loadOrgDirectory pages, and FAILS CLOSED. It read 500
             |  memberships unordered and matched against whatever came back. Against a
             |  partial directory the unique-or-nothing rule is worthless — a name that
             |  is ambiguous in the organization can look unique in the half that loaded,
             |  and the invitation goes to the wrong colleague. A directory that cannot
             |  be read in full now returns nothing: the attendees are reported
             |  unreachable and the host is told, which is the outcome the matcher was
             |  always supposed to guarantee.
             |  Confidence: typecheck/eslint clean, production build passes, Jest +15 new
             |  (4472 total green). No migration, no new deps.
2026-09-04  |  CodeRabbit: a token leak of my own making  |  Three findings beyond
             |  the five Qodo raised; the first is the worst thing in this branch.
             |  Decision: the booking "Save to calendar" link is INVITEE ONLY. It is built
             |  from the manage token, which is the invitee's credential for that booking
             |  — it cancels and reschedules it. Adding it to the host copies "for parity"
             |  handed one party the other's bearer token. The host needs no link: the
             |  meeting is already on their FundExecs calendar and their email carries the
             |  same .ics as an attachment.
             |  Decision: a sweep claim comes back when the send reached nobody. The claim
             |  is stamped before sending so a crash cannot mail a guest list twice, but
             |  an unconnected mailbox is not a crash — it is a known failure, and keeping
             |  the stamp excluded that meeting from every future sweep, turning a delay
             |  into a cancellation. Release is conditioned on the exact timestamp this
             |  sweep wrote, so it can only ever clear its own claim.
             |  Decision: an untrusted `attendees` array is validated, not cast.
             |  `{"attendees":[null]}` reached code that reads .email off each element and
             |  answered 500 to what is a malformed request; normalizeAttendees refuses
             |  the shape and both write paths return 422.
             |  Rejected: CodeRabbit's own suggested sequence fix (prior + 1), which its
             |  prose also warns against — an intervening save makes it stale. The
             |  persisted value is the only correct one.
             |  Confidence: typecheck/eslint clean, production build passes, Jest +13 new
             |  (4485 total green). No migration, no new deps.
2026-09-06  |  Access requests: no self-serve account creation  |  Request access is now
             |  a real queue, not a label on the sign-up form.
             |  Built: migration 20260906120000_access_requests — public.access_requests
             |  (email-unique queue, pending/approved/declined, RLS with NO policies so
             |  only the service-role client reaches it) + principals.access_approved_at,
             |  with every EXISTING principal backfilled as approved so the gate cannot
             |  lock out a current user.
             |  Removed: app/login/actions.ts signUp() and the /login?mode=signup form
             |  (full-name field, "Create account" button, the sign-in/sign-up toggle).
             |  /login is sign-in only; every "Request access" CTA (landing header/CTA/
             |  footer, meeting invite, in-meeting guest upsell) now points at the new
             |  public /request-access form, superseding the 2026-07-11 AccessGate note.
             |  Added: lib/access-requests.ts — one gate both auth paths call.
             |  enforceAccessGate() runs after signInWithPassword AND inside
             |  /auth/callback (Google OAuth was the remaining self-serve hole: it mints
             |  an auth user before anyone asks us). Unapproved ⇒ signOut() + bounce to
             |  /request-access with pending / declined / required copy. Decision: it
             |  fails OPEN on missing service-role env or a thrown read, and NEVER gates
             |  a platform-admin email — a gate that can lock the internal team out of
             |  the console that approves everyone else is worse than no gate.
             |  Decision: the public form answers identically whether the email is new,
             |  queued, approved, or already an account; a request form that discloses
             |  who is on the platform is an enumeration oracle.
             |  Added: /admin access-request queue (approve/decline, re-checks
             |  requirePlatformAdmin inside the server action), approval stamps any
             |  existing principal and emails the requester; internal alert reuses the
             |  exactly-once claim shape of principals.signup_alerted_at.
             |  Follow-up (same day): the alert email now carries the decision.
             |  Migration 20260906140000 adds decision_token_hash /
             |  decision_token_expires_at / decided_via; the internal email gets
             |  Approve + Decline buttons and /access-decision is their landing pad.
             |  Decision: the button is authority-by-token, not by session — it has to
             |  work for someone reading mail on a phone — so the token is treated as a
             |  credential: SHA-256 at rest, 14-day expiry, cleared by the same UPDATE
             |  that records the decision (single-use, and a console decision retires
             |  the emailed link too).
             |  Decision: the link only ever opens a CONFIRMATION page; the grant is the
             |  POST behind the button. A GET that approved would hand access to whichever
             |  mail scanner or link previewer followed the URL first — inbound-mail bots
             |  follow every link in a message.
             |  Decision: unknown / expired / spent all render one message, so a stranger
             |  holding a stale link learns nothing. /access-decision is in
             |  CRAWLER_DISALLOW (the URL is the credential).
             |  Refactor: applyAccessDecision is now the single write both doors call;
             |  lib/admin/access-requests.ts keeps only the listing + the admin-attributed
             |  wrapper, and the email bodies moved to lib/access-request-emails.ts.
             |  Kept: supabase/config.toml enable_signup stays TRUE — an approved
             |  requester still creates their auth user on first Google sign-in; the gate
             |  is the app's, not the provider's.
             |  Follow-up 2 (2026-09-07): /request-access becomes a real sign-up form.
             |  Migration 20260907120000 adds applicant_type + the onboarding-shaped
             |  columns (organization_name, hq_location, aum_range, fund_count,
             |  primary_strategy, website, phone) + details jsonb.
             |  Six applicant types: gp, family_office, advisory, operator, lp,
             |  service_provider. Decision: applicant_type is its OWN vocabulary, not
             |  organizations.operator_role — four map 1:1 and prefill the wizard's role;
             |  lp/service_provider have no operator_role and would have meant widening
             |  the ecosystem matcher's lane matrix, so they pick their role in
             |  onboarding instead. Captured and approved like anyone else.
             |  Decision: two column shapes. Answers ONBOARDING also asks for get typed
             |  columns (prefill is then a straight copy, reusing the same aum_range
             |  buckets and strategy slugs organizations constrains); reviewer-only
             |  answers that vary per type (service line, ticket size, sector) go in
             |  details jsonb rather than a wide sparse table that grows a column per
             |  question.
             |  lib/access-request-fields.ts is the single schema: the form, its
             |  validation, the alert email, the admin card and the decision page all
             |  render from it. A select value the form never offered is refused; a field
             |  the chosen type wasn't asked is dropped, not stored.
             |  Prefill: app/onboarding reads the approved request by email and seeds the
             |  wizard — prefilled and EDITABLE, since a request-time answer is often
             |  approximate and shouldn't silently become the org record.
             |  In-app notice: countPendingAccessRequests badges the sidebar's Admin
             |  console link, computed only for platform admins (it is a cross-org
             |  service-role read).
             |  Still no password at request time: an account exists only after approval.
             |  Confidence: typecheck/eslint clean, production build passes, Jest +40 new
             |  (4596 total green). Live Supabase auth flow not exercised (no local
             |  Supabase); the emailed round trip (mint → click → confirm → grant) is
             |  covered only at the unit level; so is the prefill read. Next: run ALL
             |  THREE migrations before deploy —
             |  until they land, access_approved_at is missing and the gate fails open;
             |  and set ADMIN_ALERT_EMAIL to the @beygroupintl.com reviewers or no alert
             |  is sent at all.

2026-09-08  |  Live meetings: a call that repairs itself  |  The mesh had no
             |  renegotiation, no send budget and no way to say what it was doing.
             |  Added: lib/meetings/connection.ts — the whole policy, pure and tested.
             |  Fixed (1): ICE restart never happened. `restartIce()` marks a connection
             |  as wanting fresh candidates and then waits for a renegotiation; there was
             |  no `onnegotiationneeded` handler anywhere, so a call that lost its path
             |  stayed frozen until someone reloaded. There is one now, plus bounded
             |  restarts with backoff (5 attempts) and a "Reconnecting…" badge held back
             |  by a 2.5s grace period so a Wi-Fi roam does not flash it.
             |  Decision: perfect negotiation, with politeness decided by comparing peer
             |  ids — both ends can restart at once, and one has to yield. Nothing extra
             |  is signalled to agree on it.
             |  Fixed (2): everything that changed the outgoing video looked up the
             |  sender by `getSenders().find(s => s.track?.kind === "video")`. Someone
             |  who joined with their camera off had no video track, so no video sender,
             |  so their screen share and their camera reached nobody — silently, with
             |  the button lit and the local preview correct. Transceivers are now
             |  declared up front (adopted by the offer's m-sections on the answering
             |  side, so no extra round trip) and both senders are held per peer.
             |  Fixed (3): no send budget at all. On a mesh each participant uploads a
             |  copy of 720p30 to every other, and what gives way first is not the
             |  picture but the audio sharing the path — the "static". videoSendCap
             |  divides a 2.4Mbps upstream budget by the room, and takes resolution and
             |  frame rate down with the bitrate rather than handing an encoder 720p and
             |  250kbps. A shared screen gets its own shape (full resolution, fewer
             |  frames) and `maintain-resolution`.
             |  Fixed (4): adaptation was all-or-nothing on aggregate inbound bytes —
             |  full video to audio-only on one bad reading, and straight back, so a
             |  wobbling connection flickered for the length of the call. Now: per-peer
             |  rate AND packet loss (loss is what static actually is, and was not
             |  measured at all), one tier at a time, two bad samples down and three good
             |  ones up. The "degraded" tier was declared in the type and never reachable.
             |  Decision: audio-only stops the stream at the sender (`encoding.active`),
             |  not by disabling the local track — a bad ten seconds used to turn off the
             |  member's own picture while the camera button still claimed it was on.
             |  Added: `useinbandfec=1` on Opus via an SDP munge on every offer and
             |  answer (the only way to ask), so a single lost packet is reconstructed
             |  rather than heard. Safari and some Firefox builds do not offer it, and a
             |  call is only as good as its worst leg.
             |  Added: a `video` signal beside `mic`, for the same reason — a camera
             |  turned off keeps sending black frames and a paused stream freezes on its
             |  last one, so peers used to get a black rectangle where a name belongs.
             |  Tiles now say "Camera off" / "Video paused" / "Reconnecting…".
             |  Confidence: typecheck/eslint clean, Jest +52 new (5039 total green).
             |  Not exercised: real peer connections. The negotiation, cap and link rules
             |  are unit-tested; the wiring in MeetingRoom.tsx is not, and wants a
             |  two-browser pass (join camera-off then share; pull the network) before
             |  it is trusted. No migration, no new deps.
2026-09-11  |  Dropped the invite-only framing  |  The access queue stays; the
             |  exclusivity language around it does not.
             |  Changed (public copy): landing FAQ + closing CTA, /request-access
             |  (metadata description, the `required` gate notice, body copy), /login
             |  and /join/[code], and lib/seo/llms.ts. The "Invite-only · Early Access"
             |  branding strip on all three auth entry points is now "Early Access".
             |  Every "Request access" CTA and the /request-access form are untouched —
             |  they are still the way in, just no longer sold as a velvet rope.
             |  Changed (internal): comments, JSDoc and type docs that named the gate
             |  "invite-only" now call it the access gate / access-request queue
             |  (lib/access-requests*, lib/admin/access-requests, app/login/actions,
             |  app/auth/callback, app/admin/*, the 20260906120000 migration header).
             |  Behaviour identical — enforceAccessGate() still bounces an unapproved
             |  principal on both auth paths; a platform admin still approves by hand.
             |  Not touched: lib/brains/knowledge/* ("keep the event private and
             |  invitation-only unless securities counsel approves broader
             |  solicitation"). That is Reg D general-solicitation guidance the agents
             |  give operators, not our own positioning — removing it would strip a
             |  compliance guardrail.
             |  Confidence: typecheck/eslint clean, Jest 5295 green (422 suites). Copy
             |  and comments only — no logic, no migration, no new deps.
2026-09-11  |  Declining someone actually revokes them now  |  It didn't. A decline
             |  wrote the queue row and left the account signing in.
             |  Three parts, all one bug: decideAccess checked access_approved_at
             |  BEFORE requestStatus, so a stamp outranked a decline;
             |  enforceAccessGate skipped the access_requests lookup entirely when a
             |  principal carried a stamp, so it never read the decline at all; and
             |  applyAccessDecision recorded "declined" on the request without
             |  clearing principals.access_approved_at.
             |  Why it mattered: migration 20260906120000 backfilled EVERY principal
             |  existing then as approved. So all three failed in the same direction,
             |  for exactly the accounts a decline is for — anyone who already had
             |  one. Declining a stranger with no account worked; declining a real
             |  user did nothing.
             |  Fixed: decline is checked first in the table, the gate reads the queue
             |  regardless of the stamp, and a decline nulls the column. Decisions
             |  stay reversible — approve re-stamps through the same
             |  `.is("access_approved_at", null)` filter, which now matches again.
             |  Unchanged: pending still blocks, no-request still blocks, platform
             |  admins are still never gated, and the gate still fails OPEN on a
             |  missing service-role env or a thrown read. Only a decline's reach
             |  changed.
             |  Added: lib/access-requests.gate.test.ts — the service-client halves
             |  had NO coverage, which is how this survived. Each of the three legs
             |  was verified to fail against the old code before the fix landed.
             |  Confidence: typecheck/eslint clean, production build passes, Jest +26
             |  new (5343 total green, 425 suites). No migration, no new deps.
             |  Note: existing principals declined BEFORE this shipped still carry a
             |  stale stamp — their decline was a no-op and stays one until the
             |  request is re-declined. Worth a one-off sweep if any exist.

2026-09-14  |  Background masks keep headwear  |  The blur was cutting the tops
             |  of people's heads off.
             |  Cause: selfie_segmenter.tflite was read through its CATEGORY mask —
             |  the model's yes/no at its own threshold. It was trained on selfies and
             |  is markedly less sure about what sits ON a head, so a cap, hijab,
             |  turban, headwrap, helmet, over-ear headphones or a lot of hair came
             |  back under that threshold and were composited away. For a religious or
             |  medical head covering that is not a cosmetic defect.
             |  Fix, in two parts. Read the CONFIDENCE mask instead and ramp coverage
             |  from 0.08 to 0.30 rather than cutting at the model's ~0.5: the pixels
             |  headwear occupies do not score zero, they score low. Then grow what is
             |  left outward ~1% of frame width with a chamfer dilation, because the
             |  boundary the model does draw tends to sit inside the fabric.
             |  Decision (per user): bias toward over-including. The cost of too much
             |  is a faint ring of real room travelling with the silhouette; the cost
             |  of too little is erasing part of someone. Not the same size of mistake.
             |  Decision: the widen applies to every effect, not just blur — one mask,
             |  one behaviour across blur, templates and uploaded images.
             |  Performance, which is why this is not just a threshold change: growing
             |  the mask at frame resolution measured +10.3ms/frame at 720p, a quarter
             |  of FRAME_BUDGET_MS before the compositor draws anything, and would have
             |  tripped the CPU suspension on modest laptops. The whole mask pipeline
             |  now runs on a fixed 320-wide grid and the compositor upscales it — a
             |  scale that was already happening. Net 2.55ms/frame at 720p against
             |  9.07ms for the old, narrower pipeline: headwear support AND ~3.5x less
             |  per-frame mask work, now flat across resolutions (1080p costs what
             |  720p costs, where before it cost 2.25x).
             |  blendMask (category labels) is replaced by blendCoverage (0-255 both
             |  sides); personCoverage stays for the category fallback, which is used
             |  when a build returns no confidence mask.
             |  Tested with a still-frame harness (per user): frames are BUILT, not
             |  captured — a confident head, a headwear band at 0.18-0.28, room at
             |  0.02 — and run through the shipped pipeline end to end. Verified the
             |  harness bites: restoring the threshold to 0.50 turns 5 tests red.
             |  Confidence: typecheck/eslint clean, production build passes, Jest
             |  5629 green (+29 new). Not exercised: a real camera. Very tall headwear
             |  is beyond what growing a silhouette can fix and wants the multiclass
             |  model (selfie_multiclass_256x256 has an accessories class) — offered
             |  and not chosen, deliberately, as the heavier option.

2026-09-14  |  Live meetings: join, backgrounds, camera and mic  |  Six defects
             |  found by inspecting the join path, the background pipeline and the
             |  device handling end to end. No new feature; all six were already
             |  reachable.
             |  1. A remembered camera or microphone that has since been unplugged
             |  left the GREEN ROOM with no preview and no meter. The recovery is to
             |  forget the id and re-open against the system default, but the
             |  setCamId("")/setMicId("") that forgets it happens DURING the first
             |  combined open, while the per-device effects are still standing down
             |  behind a `primedRef`. A ref does not re-render, so nothing ran them
             |  again: "No camera found" with a working camera plugged in. Primed is
             |  now state.
             |  2. A device another application was holding was reported as a device
             |  that is not there. Those have different fixes and only one of them
             |  involves going to look for hardware. The green room now classifies
             |  through media-acquisition's classifyMediaError — the same one the call
             |  uses, rather than a second list of DOMException names that had drifted
             |  from it — and readinessProblems gained camera_busy/mic_busy.
             |  3. The green room did not retry a busy device; the call has for a
             |  while. The commonest cause is the page that was just here not having
             |  finished releasing the camera (a reload, a bounce through the invite
             |  link). One retry at RETRY_SAME_DEVICE_MS, only for the failures that
             |  are about timing.
             |  4. A background chosen while the 12MB segmenter was still downloading
             |  was silently dropped: the second call returns early behind the
             |  build guard, and the build applied the effect it was STARTED for. The
             |  picker said "Terminal" while the room saw the blur chosen first. The
             |  build now applies bgEffectRef.current — sameEffect() in backgrounds.ts
             |  is the value comparison that needs (every pick is a fresh object).
             |  5. BackgroundProcessor kept segmenting a stopped camera. A stopped
             |  track leaves the hidden <video> holding its last frame with a
             |  readyState that still says it has data, so the loop runs at 24fps over
             |  one still picture, on the GPU, indefinitely. This happens on EVERY
             |  join — the green room's preview processor outlives by a few hundred ms
             |  the tracks the room stops when it takes over — and again on an
             |  unplugged webcam. The processor now watches its source for `ended`.
             |  6. The same loop also ran through a screen share, where the composited
             |  canvas reaches neither the peers nor the local tile. setPaused now
             |  follows `!camOn || shareOn`.
             |  Hardening alongside: BackgroundProcessor.create() is wrapped, because
             |  a throw (rather than a null) left processorBuildingRef set and blocked
             |  every future build for the rest of the call; and the fire-and-forget
             |  applyBackground at join now catches, because the camera is disabled
             |  waiting for it and a floating rejection is a member whose controls say
             |  their camera is on while every tile shows nothing.
             |  Decision: the green room keeps its own acquisition rather than being
             |  folded into openCallMedia. It maintains camera and microphone as
             |  independent live tracks so a mic change cannot restart segmentation;
             |  openCallMedia opens once and returns. Sharing the CLASSIFIER, not the
             |  sequence, is what these two actually have in common.
             |  Tested: 15 new tests. Seven drive components and were run against the
             |  pre-fix code: six fail, the seventh is the control that must pass
             |  either way. The other eight cover functions that do not exist before
             |  this change (sameEffect, the busy readiness problems). The green room ones drive a stubbed getUserMedia through
             |  the real component (unplugged device, busy device, busy-then-free);
             |  the processor one drives the real class over a stubbed canvas/video.
             |  enumerateDevices is deferred a turn in those tests on purpose — that
             |  is what lets React render between the forget and the prime, which is
             |  the ordering a real browser produces and the one defect 1 needs.
             |  Confidence: typecheck/eslint clean, production build passes, Jest
             |  5644 green (+15). Not exercised: a real camera, a real screen share,
             |  or two browsers in one room.

2026-09-14  |  Live meetings: recovery and the public waiting-room endpoints  |
             |  Second inspection pass, over the WebRTC connection layer and the
             |  admission server side (chosen by the user after the client-media
             |  pass above).
             |  1. An unanswered offer made a peer UNRECOVERABLE. renegotiate()
             |  re-checked `signalingState !== "stable"` after createOffer and bailed,
             |  but a connection whose offer was never answered — a frozen tab, a
             |  network that went away mid-handshake — sits in `have-local-offer` for
             |  good. That is exactly the connection recoverPeer() is trying to
             |  rescue, so every rescue bailed before sending anything while still
             |  spending one of its five attempts: five silent no-ops, then
             |  "Connection lost" permanently, and a page reload the only way back —
             |  the failure the recovery path was written to prevent. canSetLocalOffer
             |  in connection.ts now allows `stable` and `have-local-offer`, which is
             |  what setLocalDescription(offer) is defined for.
             |  2. forgetPeerState did not clear connChangedAtRef, so it grew for the
             |  length of a call across join/leave cycles.
             |  3. The public waiting-room endpoints had no rate limit, while
             |  ice-servers next to them has had one for a while. POST knock is the
             |  one with teeth: unauthenticated, reachable by anyone ever forwarded an
             |  invite link, and it INSERTS a row under a guest_key the caller
             |  chooses — so nothing in the row collapses a flood. Unbounded, it is an
             |  unbounded waiting list in a panel a host is reading during a live
             |  meeting, and an unbounded table behind it. Now 60 per 10 minutes per
             |  address, checked BEFORE any database work; the poll separately at 600
             |  per minute (a waiting guest generates ~26 in their first minute, or ~4
             |  with the Realtime push); the public room lookup at 60 per minute.
             |  Decision: keyed on clientIp() like every other limit here, and knock
             |  and poll get separate buckets — sharing one would mean a guest who
             |  polls for two minutes cannot re-knock when the server tells them to.
             |  Residual, stated rather than fixed: this bounds a flood per address,
             |  not per meeting. A distributed flood still fills one host's waiting
             |  list. Capping waiting rows per meeting is the fix for that and has its
             |  own failure mode (locking out real guests), so it was not taken here.
             |  Confidence: typecheck/eslint clean, production build passes, Jest 5657
             |  green. Thirteen new tests, all run against the pre-fix code: nine
             |  fail, four are the controls that must pass either way (a limit that
             |  refuses nobody is not a limit, and one that refuses everybody is a
             |  different bug). Not exercised: a real peer connection losing its
             |  answer, or a real flood.

2026-09-15  |  Camera and microphone: what they cost  |  Fourth pass, on the cost
             |  of the devices themselves rather than on defects. Four decisions put
             |  to the user; three taken, one declined.
             |  1. THE JOIN NO LONGER REOPENS THE DEVICES. The green room opened the
             |  camera and microphone, and the call stopped both and opened the same
             |  two again milliseconds later — the most expensive thing on the join
             |  path and the least necessary. A few hundred ms on a laptop, more on
             |  Windows, a camera light blinking at the moment somebody is watching
             |  their own face, and a race the room could lose, since a camera
             |  released a moment ago is often still held when asked for again (which
             |  is why the busy-retry exists at all). planPreviewAdoption decides
             |  whether what is open is what the call would have opened — the
             |  microphone decides, matched on getSettings().deviceId rather than on
             |  what was requested, because adopting the wrong camera silently for a
             |  whole meeting is worse than the delay avoided. Anything else falls
             |  through to openCallMedia unchanged.
             |  The dangerous half is ownership, and it is two-directional: the green
             |  room must stop stopping the tracks (a `release` callback sets a flag
             |  every stop site checks), AND the room must stop listening to it — it
             |  keeps rendering until it unmounts, its state changes keep firing
             |  onPreviewStream, and without the second guard the room would file the
             |  adopted microphone as a preview again and the next teardown would stop
             |  the track the member is talking into.
             |  2. Opus DTX (usedtx=1). In a six-person mesh five people are listening
             |  at any moment and each was uploading a separate constant-bitrate
             |  stream of their own silence to every other participant. Cost: some
             |  engines clip a few ms off a word after silence, and comfort noise is
             |  synthetic. Existing parameters are still never overridden, so a
             |  usedtx=0 already present survives.
             |  3. The camera now follows demand, not just the encoders. Capture was
             |  pinned at 720p while the encoders scaled down for thumbnails, so a
             |  laptop captured 720p30 and scaled every frame four times over to
             |  produce pictures nobody sees at that size. applyConstraints moves it
             |  to 360p when nothing above a thumbnail is asked for, and back up the
             |  moment one peer spotlights. Screen shares exempt — their size is the
             |  thing being read.
             |  The trap, which scaleForCapture exists for: scaleResolutionDownBy is a
             |  DIVISOR, so a thumbnail's 4 is 320x180 out of 1280 and 160x90 out of
             |  640. Moving the capture without correcting the divisor would have
             |  quietly halved every thumbnail in the call — the opposite of the
             |  intent. The correction holds the OUTPUT fixed while the input moves,
             |  with a floor of 1 so a small capture is never upscaled. The re-tune is
             |  guarded against looping and re-runs when the constraint lands, because
             |  the camera may settle somewhere other than what was asked for.
             |  4. DECLINED (per user): an "original sound" toggle dropping noise
             |  suppression and AGC. A call is a conversation and the defaults are
             |  right for it. constraintsFor's unused noiseSuppression option is
             |  removed instead — nothing ever passed it, and an unused switch reads
             |  as a feature that exists.
             |  Also removed: MeetingRoom's previewStream state, written and never
             |  read (only the ref was used).
             |  Confidence: typecheck/eslint clean, production build passes, Jest
             |  5706 green — nineteen new tests and one removed with the option,
             |  so 5688 to 5706. Run against the pre-change code, seventeen of the
             |  nineteen fail, as do two pre-existing Opus assertions that pinned
             |  the exact fmtp string. The other two new tests are controls and
             |  pass either way: an SDP that already says usedtx=0 keeps it, and
             |  the green room still stops its devices on unmount when the call
             |  did NOT take them.
             |  Not exercised: a real camera being adopted, a real applyConstraints on
             |  hardware that may freeze while re-tuning, or DTX as heard by a person.

2026-09-14  |  Guest connections  |  Third pass, on what it costs an invite-link
             |  guest to get connected (asked for by the user). Guests are the
             |  participants most likely to be behind the NAT that needs a relay, so
             |  everything here is either a path they take that nobody else does, or
             |  a cost they pay twice.
             |  1. A deployment that sets TURN_URLS to its relay and nothing else —
             |  which is nearly all of them, because the relay was the thing that was
             |  missing — handed browsers NO stun: entry. A browser with no STUN
             |  server never learns its own public address, so it offers host and
             |  relay candidates and nothing in between: two guests on ordinary home
             |  networks, who would have hole-punched a direct path given a reflexive
             |  candidate, relay every frame instead. An extra hop of latency, paid
             |  for on the operator's own bandwidth. The relay IS a STUN server —
             |  coturn answers a binding request on the same host and port — so
             |  buildIceServers now derives stun: from plain turn: URLs when nothing
             |  else answers that question. Only turn: over its default transport:
             |  turns: and ?transport=tcp yield no UDP reflexive candidate, so an
             |  entry for either costs a handshake and returns nothing usable.
             |  Decision: a configured stun: entry always wins — an operator who named
             |  one meant it, and it may be a different box.
             |  2. Peer connections were built on the browser default bundlePolicy. A
             |  call is two m-sections, and under `balanced` a browser prepares them on
             |  separate transports until BUNDLE is agreed in the ANSWER — two
             |  candidate gatherings, two sets of connectivity checks, and behind a
             |  relay two TURN allocations, per peer. peerConfig() now states
             |  max-bundle and rtcpMuxPolicy require, so there is one transport from
             |  the offer onwards. Safe unilaterally: both ends are this code.
             |  Deliberately NOT added: iceCandidatePoolSize. Pre-gathering only pays
             |  when a connection exists well before its offer, and here a peer
             |  connection is created and offered on in the same breath — it would buy
             |  nothing and open a TURN allocation per pooled candidate to buy it.
             |  3. The ICE fetch and the signalling WebSocket took turns. enterRoom
             |  awaited the config, THEN opened the socket — two independent round
             |  trips, serialized, at the worst moment for a guest who has just been
             |  let in. Now both start together and the deadline moves to the two
             |  places it actually falls: nothing is announced until the config lands,
             |  and handleSignal awaits the same promise before acting on anything, so
             |  no connection is ever built on the STUN-only fallback. Awaiting one
             |  shared promise releases waiters in queue order, so messages keep theirs.
             |  4. That made an unbounded fetch dangerous, so it is bounded. A request
             |  that is never answered is never rejected either — a captive portal or a
             |  black-holing proxy leaves it pending for the life of the tab — and
             |  signalling now waits on it. 4s per attempt, two attempts: a stalled
             |  endpoint degrades to STUN-only and says so, instead of a member who is
             |  nominally in the meeting and never receives a message.
             |  5. Two round trips a guest was paying for nothing: joinMeeting asked
             |  auth.getUser() twice (same answer both times), and read live_meetings
             |  under RLS before falling back to the public endpoint — a read that for
             |  a guest either returns nothing or returns exactly what the public
             |  endpoint returns. The host-detection effect did the same on every page
             |  load, competing for the connection with the public lookup and the
             |  camera. Both now skip when there is no signed-in user. Cost, stated:
             |  a signed-in host makes two calls in sequence rather than together, for
             |  a button label, on the one participant who is not struggling to connect.
             |  Confidence: typecheck/eslint clean, production build passes, Jest 5668
             |  green (+11). Not exercised: a real relay, a real NAT, or a browser
             |  actually gathering candidates — every claim here about what a browser
             |  does with these settings is from the specs and from coturn's
             |  behaviour, not from a packet capture.


2026-09-15  |  Guests go straight to the relay; hosts hear the door  |  Two
             |  halves of "guests cannot connect".
             |  Connection (per user: relay-only from the START for guests, not
             |  after a failure): invite-link guests are the one population always
             |  on somebody else's network — corporate firewall, hotel wifi, mobile
             |  CGNAT, symmetric NAT — and the direct path they try first is the one
             |  that fails. peerConfig now takes { relayOnly } and sets
             |  iceTransportPolicy:"relay"; shouldForceRelay decides. Their call forms
             |  on the first attempt instead of after a failure, an ICE restart and a
             |  multi-second stall.
             |  GUARD on that choice, which the user's option did not include and
             |  which is not optional: relay-only is applied only when a relay
             |  actually exists (relay===true from /api/meetings/ice-servers).
             |  Forcing it with no TURN configured leaves a connection no usable
             |  candidates AND no direct path to fall back to — a guest on an
             |  ordinary home network would go from a working call to one that
             |  cannot physically connect. A deployment without TURN keeps the old
             |  behaviour. Members are never relayed: they are on networks this
             |  deployment mostly controls, and relaying them buys nothing and costs
             |  bandwidth.
             |  Host notice (per user: the real bottleneck): a guest's wait is
             |  usually the host not knowing. The room already chimed and already
             |  badged the tab title — both stop at the edge of the browser window.
             |  lib/meetings/knock-notice.ts adds a system notification, which
             |  reaches a host who has switched application. Fires only for the
             |  host, only on a RISE in the waiting count (admitting 3 of 4 drops
             |  it, and notifying there would fire for something they just did),
             |  only while the tab is HIDDEN (a visible tab already shows the bar),
             |  and only once permission is granted. Tagged so a second guest
             |  replaces the first rather than stacking.
             |  Permission is requested on the host's own press of Join — the
             |  gesture browsers require and the moment it makes sense — never on
             |  load, and never again after a denial, which browsers remember.
             |  Not changed (per user): knock timing stays on Join, so nobody
             |  appears in the host's panel who is not ready.
             |  Already in place, found and left alone: TURN is already authorized
             |  for admitted guests by their admission row; the admission session
             |  already pushes over Realtime with a polling safety net; the guest key
             |  already survives a reload; the tab-title badge already existed.
             |  Confidence: typecheck/eslint clean, production build passes, Jest
             |  5688 green (+59 new). Not exercised: a real guest on a real hostile
             |  network, which is the only thing that proves the relay path. Worth a
             |  phone on cellular with wifi off before this is trusted.
             |
2026-09-15  |  Live meetings: the transcript nobody was keeping  |  Asked to
             |  optimize recording and transcripts. Recording does not exist —
             |  no MediaRecorder anywhere, no table, no bucket — so per the
             |  founder this is phase 1 of two, transcript now and full A/V
             |  recording next. What the transcript path was actually doing:
             |  Losing it (1): live_meeting_transcripts was written throughout
             |  every call ever hosted and read by NOTHING. A backup never once
             |  restored. The report was built from whatever the host's browser
             |  still held in memory, so the record of a meeting hung on one tab
             |  surviving to the end of it. Report and regenerate now read the
             |  rows and take whichever record holds more LINES — not characters,
             |  because a duplicated transcript is longer than a correct one.
             |  Losing it (2): every participant saved EVERY line, its own and
             |  everyone else's, so a three-person meeting stored each sentence
             |  three times and the model read the room stuttering.
             |  Losing it (3): progress was an INDEX into an array that remote
             |  lines splice into the MIDDLE of, ordered by when they were spoken.
             |  The mark slid over unsaved lines and back across saved ones — it
             |  dropped and duplicated in the same call.
             |  Losing it (4): the mark advanced BEFORE the insert resolved and
             |  the insert was fire-and-forget. A failed write deleted those words
             |  from history, silently, with nothing in the console.
             |  Losing it (5): a 60s interval cleared on unmount with no final
             |  flush, so up to a minute went unsaved — the minute a meeting
             |  decides things in.
             |  Losing it (6): a GUEST could not write at all. RLS on that table
             |  is keyed on auth.uid() and a guest is nobody. Every guest line was
             |  refused by a policy that cannot fail loudly. Fixing the duplication
             |  alone would have deleted guests from the record entirely — the
             |  transcript would have got cleaner and emptier at once, which is
             |  why the new route exists.
             |  Losing it (7): the model was handed "Meeting: Untitled" and
             |  "Participants: Unknown" on every meeting ever ended from the room,
             |  while its own prompt asks it to assign action items to named
             |  people. endMeeting sent neither.
             |  Losing it (8): TRANSCRIPT_LIMIT was 12,000 chars — twenty minutes
             |  of speech. Longer meetings were cut to their tail, mid-WORD, with
             |  no marker, so the model described the last twenty minutes as the
             |  whole conversation. Now 120,000 (~2.5 hours), cut on a line
             |  boundary, and the cut announces itself.
             |  Built: lib/meetings/transcript-buffer.ts (ownership, id-keyed
             |  watermark, batching, backoff) + transcript-restore.ts (rows back
             |  to text, and which record to trust) + POST /api/meetings/[id]/
             |  transcript, which takes the guest door the ICE endpoint already
             |  proved and stamps speaker_user_id from the SESSION so an admitted
             |  guest cannot post lines as the host. Rows carry the client's own
             |  line id as primary key, so a retried flush upserts instead of
             |  duplicating — which is what makes retrying safe at all.
             |  Flush is now 15s, reschedules itself with backoff, drains on end,
             |  and fires keepalive on unmount and pagehide.
             |  Confidence: typecheck/eslint clean, production build passes, Jest
             |  5739 green (+51 new).
             |  Not exercised: a real multi-party call. Specifically unproven —
             |  that a guest's lines now land, and that a host killing their tab
             |  mid-call leaves a meeting the report can still be built from.
             |  Left undone deliberately: the meeting log still gates "regenerate"
             |  on a report row existing (canRegenerate reads report.has_transcript),
             |  so a meeting whose host died before pressing End has rows that are
             |  reachable by the API and not by the UI. Closing that needs the log
             |  query to know which meetings have lines without reading every line
             |  — a view or an RPC — and it did not belong in this change.
             |
2026-09-15  |  Live meetings: recording, phase 3  |  Phase 2 of the founder's
             |  two-phase plan (transcript first, then full A/V). Recording did
             |  not exist at all before this — no MediaRecorder, no table, no
             |  bucket — so this is a build, not an optimization.
             |  The constraint that shapes everything: this is a MESH. No server
             |  ever holds the media, so nothing server-side can record it; there
             |  is nothing in the middle to record. The only place all the
             |  streams exist at once is a browser, and the only browser
             |  guaranteed present for the whole meeting and entitled to the
             |  result is the HOST's. Decisions (all per founder): host
             |  composites one file; active speaker with grid fallback and screen
             |  share taking the frame; visible indicator + announcement rather
             |  than per-person consent gates; 720p/1.5Mbps/90 days.
             |  Built: recording-policy.ts (720p not 1080p — a quarter of the
             |  pixels to composite on a machine already running the call; 24fps;
             |  VP9 first, MP4 last because H.264 encoding is the most expensive
             |  option here; zero-padded part paths so a string sort IS playback
             |  order) + recording-layout.ts (the only interesting logic: a
             |  challenger must hold the floor 1.5s before the frame cuts, and
             |  crosstalk falls to the grid rather than flicking between two
             |  people — the failure mode that makes auto-directed video
             |  unwatchable) + recording-range.ts + recording-composer.ts +
             |  use-recording.ts + the sweep + a Range-aware playback route.
             |  Applying phase 1's lesson directly: a record held only in a
             |  browser is one closed lid away from never existing. So parts are
             |  uploaded every 5s during the call, and a host whose battery dies
             |  loses seconds rather than an hour. Nothing ever stitches them —
             |  Storage cannot concatenate server-side and pulling 675MB through
             |  a function to rewrite it costs more than storing it twice — so
             |  the playback route presents the parts as one stream and maps
             |  Range requests onto them, which is what makes SEEKING work.
             |  No API route in the write path at all: only the host records, the
             |  host is signed in, and RLS on the bucket and both tables asks
             |  exactly the question that matters. A route in the middle would be
             |  a body limit and a round trip with no opinion.
             |  Consent is not a host-side setting: several US states require
             |  EVERY party to know, so the badge is driven by a broadcast signal
             |  every participant renders, it is never hidden on mobile, and it
             |  is re-announced whenever somebody joins — a late arrival has
             |  missed the original and would otherwise sit in a recorded meeting
             |  with no badge.
             |  Self-caught before pushing: decode surfaces were pruned by what
             |  was in the FRAME, so anyone cycling in and out of the 4-tile strip
             |  had their <video> destroyed and rebuilt — and a new one shows
             |  black until it decodes, so the recording would have flickered
             |  exactly when the conversation moved around. Pruned by room
             |  membership instead.
             |  Also caught: the `video` signal carried no `sharing` flag, so the
             |  composer could only recognise the HOST's own share — a guest
             |  presenting slides would have been composited as a small tile of
             |  their slides, which is the one thing a recording exists to catch.
             |  Confidence: typecheck/eslint clean, production build passes, Jest
             |  5815 green (+76 new). NOT exercised, and this is the important
             |  part: no frame of video has ever been composited by this code. No
             |  camera, no second browser, no MediaRecorder in CI. The pure
             |  layout/range/policy logic is tested hard because it is the only
             |  part that can be, and the composer is deliberately thin for the
             |  same reason. Needs a real two-browser call before it is trusted,
             |  and specifically: whether a host's CPU can composite at 24fps
             |  while running the call, and whether the assembled parts play and
             |  seek in a browser.

2026-09-15  |  The waiting room: the door, not the doorbell  |  Fifth pass, on
             |  the path between knocking and being let in. Three findings, each
             |  one a place where the cost lands on somebody standing outside.
             |  1. A GUEST ADMITTED INSTANTLY WAITED FIFTEEN SECONDS. The push
             |  that tells a guest their answer is ready only reaches whoever is
             |  already subscribed, and the guest is not subscribed until the
             |  knock's response has travelled back and the socket has joined the
             |  channel. A host watching the panel clicks Admit inside that gap —
             |  which is the case the responsive cadence was tuned for — and the
             |  nudge is published to a channel nobody is on. The guest is then on
             |  the WATCHED cadence, whose first poll is fifteen seconds out, so
             |  the fastest possible admission produced the slowest possible wait.
             |  setWatching now asks once on connecting. Same fix, same reason,
             |  for every reconnect after a drop: nudges published while the
             |  socket was down reached nobody, and only asking finds out.
             |  2. The poll could not use an index. GET knock?key= looks a guest
             |  up by guest_key alone — it holds the room code, not the meeting
             |  id, so the meeting is reached through a join rather than used as
             |  a filter. Every index on live_meeting_admissions leads with
             |  meeting_id (the PK is on id; UNIQUE (meeting_id, guest_key) and
             |  the status index both lead with meeting_id), and a btree cannot
             |  answer a predicate on its second column. So the hottest read in
             |  the meeting stack was a sequential scan — paid per waiting guest
             |  per tick, while somebody watches a spinner, over a table nothing
             |  ever deletes from. One index on (guest_key).
             |  3. The knock was documented as idempotent and was not. Read-then-
             |  insert is not atomic, and this endpoint is called concurrently BY
             |  DESIGN: the first knock races the re-knock the poll fires when the
             |  server has no record of the guest, and two tabs or a double press
             |  do the same. The loser hit UNIQUE (meeting_id, guest_key) and was
             |  answered with a 500 — the one operation promised to be safe to
             |  repeat, failing precisely when it was repeated. A unique violation
             |  now re-reads and answers from the row that won, through the same
             |  path as a knock already on file, so the outcome is identical
             |  whichever way the race went — including the promotion a teammate
             |  is owed.
             |  Also: the teammate check and the existing-knock read answer
             |  different questions and neither needs the other's answer, so they
             |  run together instead of in sequence. For a signed-in caller the
             |  teammate check is itself two round trips (resolve the user, then
             |  look up membership), all of it inside the one request a guest is
             |  actively waiting on. Quick access still skips it rather than
             |  racing it: the answer cannot change the outcome.
             |  Looked at and left alone: the host's list already applies Realtime
             |  events directly and coalesces one reconciling re-read per burst;
             |  the nudge already carries no verdict, for reasons in
             |  admission-channel.ts; the poll schedule already widens with the
             |  wait; a hidden tab already stops polling.
             |  Confidence: typecheck/eslint clean, production build passes, Jest
             |  5714 green (+8 new, 5706 to 5714). Run against the pre-change
             |  code, six of the eight fail, as do four pre-existing tests whose
             |  answer queues assumed no ask on connecting; the other two new
             |  tests are controls (a non-unique insert failure is still a 500, a
             |  subscription that never connects still does not ask on connect).
             |  Not exercised: the index against a table with rows in it — the
             |  plan change is read off the index definitions, not off an EXPLAIN
             |  — and a real concurrent knock, which the test simulates by making
             |  the insert fail the way Postgres would.
             |
2026-09-15  |  Calendar hygiene, and a report that reads like a record  |  Three
             |  asks, and two turned out to be features whose machinery was
             |  already written and unreachable.
             |  Starvation (the real bug): `consecutive_failures` has been
             |  written on every Google sync since sync existed and read by
             |  NOTHING. Worse than a missing feature, because the sweep takes
             |  the 25 connections with the oldest `last_sync_at` — and a
             |  connection that fails never updates that timestamp, so it sorts
             |  to the FRONT forever. One revoked grant was retried hourly at
             |  full cost and held a slot a healthy connection never reached.
             |  The more broken a connection, the more of the sweep it consumed.
             |  Fixed with a `next_attempt_at` column and a 15min→1day backoff;
             |  a connection that recovers has it cleared rather than serving out
             |  a penalty. Healthy connections synced within the hour are also
             |  skipped — a deployment under 25 connections was re-syncing every
             |  one every hour, including ones refreshed by hand minutes before.
             |  "Sync now" still always syncs: the pacing exists to stop the
             |  sweep wasting itself, not to refuse somebody who asked.
             |  Remove from calendar: `decideWrite` has ALWAYS returned a delete
             |  when a meeting's sync flag is false, and nothing anywhere ever
             |  set it false. The delete dialog on the meetings screen said so
             |  out loud — "Connected calendar events are not deleted unless
             |  separately approved and synced" — true, with no way to act on it.
             |  Now DELETE /api/meetings/[id]/calendar. Host-only (it is their
             |  calendar, their grant) and deliberately NOT folded into Delete:
             |  a meeting that moved elsewhere is still a meeting that happened.
             |  Export, per the founder ("more institutional in form and
             |  presentation, and there should be a docx download"): the .docx
             |  download already existed and was labelled "Word", which reads as
             |  a link to something else — every format now states its extension.
             |  The document gained a Meeting Record block (date, time, duration,
             |  reference, participants, tone) replacing one interpuncted line;
             |  decisions and action items moved AHEAD of the discussion and
             |  became numbered, because "action 3 is mine" is a sentence people
             |  say and they cannot say it about a bullet; and a provenance
             |  footer that admits what is model-generated.
             |  Found while doing it: `loadReportForExport` has selected
             |  `attendees` since it was written and `buildReportMarkdown` threw
             |  them away — every report this product ever exported was the
             |  record of a conversation that did not say who had it.
             |  Transcripts in exports now render as speaker turns through
             |  `parseTranscript`, the same parser the report PAGE has always
             |  used, so the filed document matches the page somebody read.
             |  Confidence: typecheck/eslint clean, production build passes, Jest
             |  5733 green. Five existing export tests were REWRITTEN rather than
             |  relaxed — the format changed on purpose and they now assert the
             |  new shape; a test that stops checking is worse than one that
             |  changes its mind. Not exercised: a real Google account revoking
             |  access (the backoff path), and a rendered .docx opened in Word.

2026-09-15  |  Devices that come back  |  Sixth pass, on the camera and
             |  microphone being live when a meeting starts (asked for by the
             |  user). Four decisions put to them; the green room stays for
             |  everyone, both devices keep starting ON with no remembered
             |  off-state, a device that fails to open is retried in the
             |  background, and one lost mid-call is reopened automatically.
             |  The first two were already true — the green room defaults both
             |  on and carries the choice in — so the work is entirely in the
             |  cases where "live" silently was not.
             |  1. A CAMERA LOST MID-CALL WAS NOT RECOVERED IF A BACKGROUND WAS
             |  ON. The recovery existed and was attached to the wrong track. It
             |  watched the outgoing video track for `ended`, guarded on that
             |  track being the camera — and with an effect on, the outgoing
             |  track is the processor's CANVAS, so the guard failed and no
             |  listener was attached at all. Backgrounds are what this product
             |  leads with, so the members most likely to be on a laptop webcam
             |  had no recovery. The same bug made the listener a one-shot for
             |  everybody else: it keyed off `localStream`, which does not change
             |  identity when the camera does, so every camera after the first —
             |  from the picker, or from this very fallback — died unnoticed. Now
             |  watches the camera device itself, mirrored into state so the
             |  effect re-attaches when it changes.
             |  2. A device that would not open at join is now gone back for.
             |  Joining without a camera is the right trade for getting in; not
             |  watching for it to free up is not. The failure that dominates is
             |  "in_use" — a camera still held by the Zoom the member has not
             |  quit — and that condition ends, usually within seconds, with
             |  nothing watching. device-reacquire decides what each failure is
             |  worth: in_use/aborted/missing/unknown poll on a front-loaded
             |  backoff (2s, 5s, 10s, 20s, 30s, then a minute, stopping at ten);
             |  overconstrained never retries, because the device is present and
             |  cannot do what was asked, so the identical request fails
             |  identically forever; and denied does not poll AT ALL — a browser
             |  told no rejects the next call rather than re-prompting, so a poll
             |  there is a loop that can never succeed. It waits on the
             |  Permissions API instead, which is the whole mechanism for that
             |  case rather than an optimisation.
             |  reacquire-loop does the waiting, plus the two events that make
             |  waiting pointless: devicechange (a webcam plugged in at second
             |  three should not wait out an interval chosen on the assumption
             |  nothing happened) and a permission flipping to granted. Attempts
             |  never overlap — a dock reconnecting fires several devicechange
             |  events and each must not start its own getUserMedia beside the
             |  one in flight — and the backoff restarts from the front after a
             |  real event.
             |  3. GUARD, which the request did not include: automatic recovery
             |  must never fight the member. Both loops stop the moment they
             |  toggle, switch or start that device themselves, and a recovered
             |  microphone comes back at the state they ASKED for at join, not
             |  switched on because it happened to be recovered — someone who
             |  joined muted stays muted. A recovered mic also re-announces over
             |  the signal channel, because everyone else has been drawing them
             |  as muted and the track arriving is invisible to the room.
             |  Confidence: typecheck/eslint clean, production build passes, Jest
             |  5747 green (+33 new, 5714 to 5747), all 33 in the two new
             |  modules.
             |  NOT EXERCISED, and the honest gap: finding 1 has no test. The
             |  MeetingRoom test harness deliberately stops short of entering the
             |  room ("a test that mocked all of that would be testing its own
             |  mocks"), so there is no media harness to extend and building one
             |  is larger than the fix. It is verified by reading. Also not
             |  exercised: a real camera being released by a real application, a
             |  real permission grant mid-call, and Safari's Permissions support,
             |  which has come and gone by version.

2026-09-15  |  A camera that checks itself  |  Reported: configure the camera
             |  in the green room, start the meeting, and it is live for NOBODY
             |  — including the member — until they open device settings and
             |  pick the same camera again. Reproduces on every join path, with
             |  and without a background.
             |  Static analysis found at least four ways to reach that state and
             |  they are indistinguishable from inside the room: a device asked
             |  for again before its driver let go (the green room's tracks are
             |  stopped and the same camera requested milliseconds later;
             |  openCallMedia retries once, and some hardware needs longer); a
             |  track that had already ended; a track left DISABLED by the
             |  background hold, which disables the camera until the segmenter
             |  builds and depends on every route out re-enabling it; and an
             |  adopted preview that was never live.
             |  DECISION: do not chase which. The member's own repair — open
             |  settings, pick the camera — works for all four, which means the
             |  fix is to do that automatically rather than to find the one true
             |  cause. camera-liveness judges the camera by what it IS doing:
             |  wanted and no track, wanted and ended, or open-and-disabled
             |  behind a UI that says it is on. The room asks once, 2.5s after
             |  joining, and repairs what it finds.
             |  Two details that matter. The check reads the CAMERA, not the
             |  outgoing track: with an effect on, the outgoing track is the
             |  processor's canvas, and a healthy canvas over a dead camera is
             |  precisely the state this catches. And a disabled-but-open track
             |  is repaired by setting the flag, not by reopening — reopening
             |  works, and also blinks the camera light in front of somebody
             |  watching their own face and costs a second of black on every
             |  other tile, for a fault that is one boolean.
             |  Deliberately late (a fresh track is briefly not producing, and
             |  the hold is released only when a 12MB segmenter lands — judging
             |  either sooner would condemn a camera that is merely starting)
             |  and deliberately one-shot (a safety net under a path that is
             |  supposed to work; anything still wrong afterwards belongs to the
             |  re-acquisition loop, anything breaking later to the device-loss
             |  listener).
             |  Not repaired: a member who joined with their camera off, or who
             |  turned it off in the first 2.5 seconds. camWantedRef follows
             |  their intent rather than camOn, which is false in exactly the
             |  broken case this exists to catch.
             |  Confidence: typecheck/eslint clean, production build passes, Jest
             |  5759 green (+12 new, 5747 to 5759).
             |  NOT EXERCISED, and the honest gap: the wiring has no test, for
             |  the same reason as the entry above — the MeetingRoom harness
             |  stops short of entering the room, so there is no media harness.
             |  The verdict logic is covered; the effect that calls it is
             |  verified by reading. And because the root cause was never
             |  isolated, this is a net under the failure rather than a fix for
             |  it: if it still reproduces, the console now says which of the
             |  four states it was, which is the thing nobody could see before.

2026-09-15  |  Screen sharing and recording  |  Seventh pass, asked for by the
             |  user. Two findings in sharing, one in recording.
             |  1. YOU COULD NOT STOP SHARING YOUR SCREEN WITH YOUR CAMERA OFF.
             |  swapOutgoingVideo returned early on a null track — `if (!next ||
             |  !stream) return`. restoreCameraTrack passes cameraTrackRef, which
             |  IS null for a member sharing with their camera off, so ending the
             |  share replaced nothing on the senders and stopped nothing.
             |  shareOn went false, the button went back to "Share screen", the
             |  room was told sharing had ended — and the screen kept going out
             |  to every participant with the browser's own sharing indicator
             |  still lit. The only person who could not tell was the one
             |  sharing. A null `next` now means SEND NOTHING rather than DO
             |  NOTHING, which is also the right answer on the two other paths
             |  that can reach it with null (abandonBackground, and a restore
             |  with no camera).
             |  2. getDisplayMedia was asked for `{ video: true }` — "whatever
             |  this display is", which on a 4K monitor is 3840x2160 captured at
             |  whatever the compositor runs and re-encoded continuously. The
             |  send caps bound the wire; they do nothing about capture and
             |  encode, paid by the one machine also running the meeting and the
             |  thing being presented. displayConstraints caps the FRAME RATE at
             |  15 and deliberately leaves resolution alone: shared screens are
             |  static, so halving the rate halves the encoder's work and costs
             |  nothing visible, while resolution is what makes text readable — a
             |  screen share nobody can read is not a cheaper one, it is a failed
             |  one. `ideal` throughout, never `max` or `exact`: an
             |  OverconstrainedError here reaches the member as a share button
             |  that does nothing. Audio still not requested, and the comment now
             |  says why (nowhere to route it; asking would light the "sharing
             |  audio" indicator while sending silence).
             |  3. THE RECORDING UPLOAD PATH WAS BUILT TO MAKE RETRYING SAFE AND
             |  NEVER RETRIED. Object upserted by a path derived from the part's
             |  own index, row upserted on (recording_id, idx) — sending a part
             |  twice is indistinguishable from once. Having paid for that, it
             |  dropped any part whose first attempt failed and wrote a console
             |  line. Uploads run continuously for the length of a call from a
             |  browser: a thirty-second wifi stumble in an hour-long board
             |  meeting is six holes, and the recording was still filed
             |  "complete" because nothing counted them. upload-retry decides
             |  what is worth repeating (network/5xx/429/408 and anything
             |  unrecognised, because giving up on an unfamiliar error shape
             |  loses footage while retrying costs three requests; 401/403/413
             |  are decisions and get none) with three attempts inside ~8s —
             |  short because parts upload IN ORDER and a part that retries for a
             |  minute holds up every part behind it.
             |  What could not be stored is now counted and reported, in seconds
             |  rather than parts: "4 chunks" means nothing to somebody deciding
             |  whether to hold the meeting again. GUARD, not asked for: this
             |  goes in a NEW `notice` field, not `error`. The existing error bar
             |  is role="alert", red, and has no dismiss — routing "the rest was
             |  saved" through it would tell a host their recording is broken and
             |  leave the claim on screen for the rest of the meeting. The notice
             |  is role="status", neutral, and dismissible. A retry that outlives
             |  its recording also checks it is still the same recording before
             |  writing.
             |  Confidence: typecheck/eslint clean, production build passes, Jest
             |  5924 green (+19, 5905 to 5924). The 4 new devices tests fail
             |  against the pre-change source; the 15 upload-retry tests cover a
             |  module that did not exist, so "failing before" does not apply to
             |  them.
             |  NOT EXERCISED: finding 1 has no test, for the third entry running
             |  — the MeetingRoom harness stops short of entering the room, so
             |  there is no media harness and building one is larger than the
             |  fix. Verified by reading. Also not exercised: a real 4K display
             |  captured at 15fps, a real failing upload, and whether any browser
             |  declines the frameRate hint. recording-composer.ts (412 lines)
             |  remains the largest untested module in this area and was not
             |  touched.

2026-09-15  |  The calendar that was read and never consulted  |  Asked to
             |  optimize the meeting invite and scheduling flow. The invite side
             |  turned out to be in good order — iTIP REQUEST/CANCEL, stable
             |  UIDs, sequence bumps, host confirmation, reschedule and
             |  relocation mail all already there. The scheduling side had a
             |  hole you could drive a client call through.
             |  `googleBusyForUser` existed. It was written, commented ("for
             |  availability"), joined to `google_calendars.blocks_availability`
             |  so a member could choose which calendars hold their time — and
             |  called by NOTHING. `blocksTime` next to it, docstring entirely
             |  about availability, called only by its own test. So every Google
             |  event a member had ever synced sat in `external_events` where the
             |  grid drew it and availability never looked. A host with Google
             |  Calendar connected could be booked straight over a client call
             |  through their own public link, and be told the slot was free.
             |  This is the second feature this week found fully built and
             |  unreachable, after the sync backoff. The pattern worth naming:
             |  the code was written to the right design and the last wire was
             |  never run, and nothing anywhere fails when that happens — a
             |  calendar with no busy time and a calendar nobody asked about
             |  look identical from the outside.
             |  Wired it in, and the same for the in-app form: scheduling a
             |  meeting in here warned about other meetings in here and about
             |  time blocked by hand, and said nothing about the calendar the
             |  member actually lives in. Now a third kind of conflict, with the
             |  same "Save anyway" escape, showing spans only — the host knows
             |  what is in their own calendar, and the summary of a private
             |  event has no business travelling to say "busy".
             |  The all-day trap, which is why this needed a zone: all-day events
             |  are stored anchored at UTC MIDNIGHT, deliberately — the grid
             |  draws them as banners and only needs them to sort. Availability
             |  is not so forgiving. Taken literally, "all day Thursday" for a
             |  host in New York blocks 8pm Wednesday to 8pm Thursday: it frees
             |  four booked hours of Thursday evening and eats four unbooked
             |  hours of Wednesday. Both wrong, in opposite directions, and
             |  invisible unless you are the host wondering why. So the stored
             |  instants are read back as the calendar dates they encode and
             |  re-anchored to midnight in the host's own zone, borrowing the
             |  scheduling layer's `localToIso` rather than growing a second
             |  implementation of DST — two implementations is exactly how the
             |  two sides of a booking come to disagree about what time it is.
             |  Same bug in the ICS path, so `externalBusyForUser` now reads the
             |  stored feed events rather than each feed's `cached_busy` blob.
             |  The blob had thrown away which events were all-day — the one
             |  thing that cannot be interpreted without the host's zone — and
             |  covered the feed's whole four-month read window, so a one-week
             |  slot lookup compared every candidate slot against four months of
             |  intervals. Both sources are now windowed with a day of slack each
             |  way (an all-day event can start a zone-offset outside the window
             |  and still cover it), capped loudly at 2000 events rather than
             |  silently, and failed independently: a revoked Google grant must
             |  not stop a subscribed feed from blocking time, and neither may
             |  take the booking page down.
             |  Confidence: typecheck/eslint clean, production build passes, Jest
             |  5905 → 5936 green (+31 new, one of which caught me dropping the
             |  `blocks_availability` filter while rewriting the query — the
             |  exact kind of silent widening that lets a calendar the member
             |  switched off start holding their time again).
             |  NOT EXERCISED: no live Google account in this environment, so the
             |  join-to-`google_calendars` embed and the feed-events embed are
             |  verified by shape against the two existing queries that use the
             |  same pattern, not against a real PostgREST. First real booking
             |  against a connected calendar is the proof.

2026-09-15  |  Three ways to be left outside the door  |  An audit of the
             |  waiting room, asked for by the user; three defects found and
             |  fixed. All the same shape: somebody stuck outside with nothing
             |  watching.
             |  1. THE HOST'S LIST HAD NO FALLBACK. `.subscribe()` was called
             |  with no status callback and loadWaiting ran exactly once on
             |  mount, so a host whose WebSocket never opened — corporate proxy,
             |  firewall, captive network — read the list on joining and never
             |  again. Guests knocked into a panel that stayed empty and gave up
             |  at the timeout. This is the exact mirror of what the GUEST side
             |  has had a floor under for a while, and the host is the only
             |  person who can act on a knock: a guest polling faithfully every
             |  1.5s is no use when the host was never told they were there. The
             |  subscribe status is now read, and a 10s re-read runs only while
             |  the channel is NOT connected, so a healthy call pays nothing.
             |  2. AN ADMITTED GUEST WHOSE ENTRY FAILED WAS STRANDED FOREVER.
             |  settle() called `void opts.onAdmitted()` AFTER stop() had cleared
             |  every timer, listener and subscription — because a decision is
             |  terminal. onAdmitted is the one callback that does real work
             |  (devices, ICE, a channel), and enterRoom has no top-level
             |  try/catch: `await supabase.auth.getUser()` is unguarded, as is
             |  knownDevices() inside openCallMedia's split path. So a rejection
             |  was discarded and the guest sat on "waiting for the host to let
             |  you in" permanently — not even the timed-out copy, since that
             |  timer was cleared too — while the host saw them admitted and gone
             |  from the panel. New onAdmitFailed, wrapped in Promise.resolve()
             |  so a synchronous throw is caught too, and a new "failed"
             |  admission UI state whose copy says the host DID let them in and
             |  offers Try again. Their devices were never torn down, so asking
             |  again costs one press.
             |  Worth recording: run against the pre-change code the new test
             |  does not merely fail, it CRASHES THE NODE PROCESS with an
             |  unhandled rejection. The defect was one step worse than it read.
             |  3. A DELETED MEETING LOOKED LIKE A DROPPED PACKET. The poll
             |  collapsed every non-OK response into null ("no news, ask again").
             |  The knock route answers 404 when the meeting is gone, so a host
             |  who cancelled left their guest watching a spinner for the full
             |  ten minutes a wait may run. pollStatusFromResponse maps 404 to
             |  "ended" — a verdict the session already acts on — and
             |  deliberately leaves 429 and 5xx transient: a limiter saying
             |  "slower" is not "never", and treating a bad minute as terminal
             |  would tell a guest the meeting is over while it is still going.
             |  Also: every path that leaves or resets the wait now clears the
             |  failed state, or the "Try again" box outlives the thing it
             |  describes.
             |  Looked at and NOT a defect: live_meeting_admissions' RLS matches
             |  only `organization_id IN (...)`, so a NULL-org meeting would be
             |  invisible to its own host — while live_meetings_select
             |  explicitly supports NULL-org rows. Not reachable: createMeeting
             |  always passes auth.ctx.orgId. Worth knowing if a NULL-org
             |  creation path is ever added.
             |  Confidence: typecheck/eslint clean, production build passes, Jest
             |  5939 green (+15, 5924 to 5939). All 15 fail against the
             |  pre-change source (9 as assertions, and the admission-session
             |  ones by crashing the runner, as above).
             |  NOT EXERCISED: the host fallback poll has no test — it is an
             |  effect in MeetingRoom, and the harness stops short of entering
             |  the room. Verified by reading. Also not exercised: a real
             |  WebSocket-hostile network, and a real 404 mid-wait.

2026-09-15  |  The report that stopped early, and the email nobody could send  |
             |  Asked to optimize meeting notes and summaries. Four things, and
             |  the first is one I made worse myself.
             |  THE REPORT WAS BEING CUT OFF MID-SENTENCE. `max_tokens: 2048`,
             |  for a schema that asks for a summary, three lists, a sentiment, a
             |  next-meeting line AND a complete ready-to-send follow-up email.
             |  When the model runs out of room inside a tool call the API does
             |  not raise: it sets stop_reason and hands back the partial JSON,
             |  which looks exactly like an answer. The fields at the END of the
             |  schema are the ones that never arrive, and `follow_up_draft` is
             |  last. So hosts got reports with no email, or an email stopping
             |  mid-sentence, and nothing anywhere said why. I made it worse two
             |  changes ago by raising the transcript budget from 12,000
             |  characters to 120,000 — a longer meeting means more to report on,
             |  into the same 2,048. Raised to 8,192 and stop_reason is now read;
             |  a report that still runs out says so on its own page.
             |  ACTION ITEMS WENT TO THE WRONG PERSON — always the host. The
             |  prompt asks for "Sarah: Send the deck by Friday" and the model
             |  obliges; every one of those became a task assigned to whoever
             |  ended the meeting. The host collected a list of other people's
             |  commitments and Sarah was never told about hers. Now the owner is
             |  parsed off the front and matched against the organization's own
             |  directory, unique-or-nothing, the same rule the invitation path
             |  uses. Two Sarahs and it stays with the host, because a commitment
             |  filed against the wrong colleague is worse than one that did not
             |  move — somebody will act on it.
             |  Two traps in that matching, both caught by tests I wrote before
             |  the code: the address local-part is a NAME-ish form, not an
             |  identity, so "Sarah" in an org with sarah@ and sokonkwo@ must not
             |  resolve through the lucky address; and "ambiguous" must not be
             |  returned as "not found", or an exact form that means two people
             |  falls through to a looser form that happens to mean one.
             |  AND THE TASKS OFTEN WERE NOT CREATED AT ALL. `void
             |  Promise.allSettled(...)` on the line before the response. On a
             |  serverless runtime the invocation can be frozen the moment the
             |  response is sent, so whatever had not landed never did —
             |  silently, because nothing was waiting to hear. Awaited now.
             |  THE FOLLOW-UP DEAD-ENDED IN THE CLIPBOARD. The model writes a
             |  ready-to-send email; the page offered a Copy button. So the host
             |  went to another application, pasted it, and typed in the
             |  addresses of people this meeting already knows — while the
             |  product held the attendee list, a connected mailbox and the same
             |  send path the invitations use. It is now editable in place and
             |  sends to everyone on the meeting who has an address, host only,
             |  sender excluded, one bad address not stopping the rest.
             |  Smaller: the report page dated itself to the meeting ROW's
             |  created_at, so a board call booked the week before was reported
             |  under the day it was scheduled. And the institutional record
             |  wrote through Promise.allSettled with nothing reading the
             |  results — a failed write was indistinguishable from a meeting
             |  that produced nothing, discovered months later as a search that
             |  comes back empty.
             |  Worth naming: `notes_snapshot` and `meeting_notes` are both
             |  written and read by nothing, anywhere. That is the fourth
             |  write-only store this week, after the transcript table, the
             |  failure counter and the Google busy lookup. I did not build
             |  readers for them — there is no screen asking — but the pattern is
             |  now the most reliable thing in this codebase for finding real
             |  bugs: follow what gets written and ask who reads it.
             |  Confidence: typecheck/eslint clean, production build passes, Jest
             |  5955 → 6027 green (+72 new).
             |  NOT EXERCISED: no mailbox is connected here, so the follow-up
             |  send is verified against a mocked sendEmail, not a real Gmail
             |  round trip. And the truncation path is tested by asserting on
             |  stop_reason, not by making a real model run out of room.


2026-09-16  |  A badge nobody could clear, and a task raised twice  |  Second
             |  pass on meeting notes, and the headline came from following the
             |  same thread as yesterday: find what gets written and ask who
             |  reads it — then ask who ever writes the OTHER value.
             |  `followup_status` IS read: deriveMeetingStatus turns it into
             |  "Follow-Up Needed" on the meetings list. Every report that
             |  produced a follow-up email set it to "draft". NOTHING, anywhere,
             |  has ever set it to "done". So a meeting earned that badge the
             |  moment it was summarised and carried it for the rest of its life,
             |  however diligently the host actually followed up — the one state
             |  the list was built to celebrate was unreachable. Sending the
             |  follow-up now closes it, and only on a full send: a partial one
             |  is still outstanding for whoever missed it, and closing it would
             |  hide exactly the meetings that still need a person.
             |  THE SECOND THING I MADE WORSE MYSELF, YESTERDAY. The report route
             |  has no idempotency: any re-POST for the same meeting writes
             |  another report row and another full set of tasks. That was
             |  survivable while every task landed on the host's own list. It is
             |  not now that items reach the person they name — the room retries
             |  a lost response, and Sarah gets "send the deck" twice. So
             |  team_tasks gained a meeting_id, and a run skips what this meeting
             |  has already raised, keyed on the item verbatim (case, spacing and
             |  a trailing full stop set aside; a REWORDED item is a new
             |  commitment, because a near-match rule would swallow a real one).
             |  That dedupe is what made the third thing safe. Regenerating a
             |  report — the thing a host reaches for precisely because the first
             |  one read wrong — raised no tasks at all. The corrected report said
             |  Ana owed something and nothing ever told Ana. It raises them now,
             |  and the unchanged items are left alone rather than filed again.
             |  It also moves `followup_status` with the report it replaced,
             |  instead of leaving the list describing the one the host rejected.
             |  Reading the failure direction each time: failing to read what was
             |  already raised means a duplicate, so it is logged and the write
             |  proceeds; failing to write the badge means a wrong badge, so the
             |  email still reports success. Neither is allowed to lose a report.
             |  Also: `context_snapshot` was a bare string here and an object
             |  everywhere else in the codebase; it is an object now, and holds
             |  the item verbatim, which is what the dedupe reads.
             |  Two tests caught harness lies rather than code bugs, which is its
             |  own kind of finding: the regenerate harness recorded every update
             |  into one slot, so "never updates a report row" and "updates the
             |  meeting's badge" were indistinguishable; and its report insert was
             |  being clobbered by the real createTeamTask reaching the same fake.
             |  Confidence: typecheck/eslint clean, production build passes, Jest
             |  6027 → 6056 green (+29 new).
             |  NOT EXERCISED: the migration is unapplied here, so the meeting_id
             |  column and its index are verified by shape only. Note the deploy
             |  window — migrations apply in parallel with the deploy, so for a
             |  few seconds createTeamTask will insert a column that does not yet
             |  exist, return null, and raise no tasks for a report ending in
             |  exactly that gap. Same shape as the calendar_feed_events window
             |  already documented above, and the same answer: it is seconds, and
             |  the alternative is a two-stage deploy for a nullable column.

2026-09-16  |  The adaptation that could not fix what it measured  |  Asked to
             |  check for defects with the bandwidth connection, then to fix
             |  them in phases. Three, and they compound: the room decided a
             |  link was bad on evidence it had manufactured, then answered it
             |  in the one direction that could not help, and if the network
             |  actually went away it stopped trying to come back.
             |  THE REMEDY POINTED THE WRONG WAY. Every input to the link state
             |  is INBOUND — bytes received, packets lost, streams arriving — so
             |  `bwMode` says what this member is failing to download. Every
             |  response to it was on the send side: halve our encoders, switch
             |  them off, tell the room our video is paused. So somebody on a
             |  congested downlink kept pulling the full stream from every peer
             |  while switching off the one thing that was not causing the loss.
             |  The loss went on, so the mode never lifted, and they spent the
             |  call invisible and no better off. The lever was already built
             |  and unused: receivers already tell senders what size to encode
             |  for. A degraded link now stops asking anyone for a full-size
             |  picture and an audio-only one stops asking for pictures at all,
             |  so the thing being reduced is the thing being measured.
             |  THE MEASUREMENT WAS AN AVERAGE CALLING ITSELF A MINIMUM. The
             |  sampler summed every peer's bytes and divided by the peer count,
             |  under a comment insisting this was "per peer, not in total"
             |  because an aggregate "hides one starved stream behind three
             |  healthy ones". A mean is an aggregate. It hid the starved stream
             |  just as well, and invented starvation that was not there: every
             |  silent participant dragged it down, and Opus DTX had just been
             |  turned on to make silence free. Seven people, one camera on,
             |  average about 37kbps against a 90kbps floor — a healthy call
             |  reading as a dying one. `videoExpected` had the mirror flaw: it
             |  asked what each peer's camera was doing, never what we had asked
             |  them to send. Background the tab and every tier drops to `none`,
             |  the peers stop sending exactly as instructed, their cameras stay
             |  on — so the rule expected video it had itself cancelled. Ten
             |  seconds in another tab started it, and because `degraded` judges
             |  on loss alone the room read healthy again and climbed back:
             |  normal/degraded, every twenty seconds, halving its own send caps
             |  and broadcasting to the room on each flip.
             |  A THIRTY-SECOND OUTAGE WAS PERMANENT. ICE recovery ran five
             |  restarts across about twenty-nine seconds and then stopped for
             |  good — the attempt cap and the give-up were the same number. A
             |  laptop asleep for a minute, a tunnel, a slow Wi-Fi handover left
             |  every tile reading "Connection lost" for the rest of the meeting
             |  at BOTH ends, each having given up on the other, with no way
             |  back but a reload. Three doors, all of which had to close: the
             |  burst now drives the badge while retries continue on a
             |  twenty-second cadence out to ten minutes; `online` clears the
             |  backoff instead of being ignored; and the signalling channel,
             |  which announced once, now says hello again on a resubscribe when
             |  there is a stalled peer to rebuild — a socket that dropped is
             |  also a socket that carried none of the offers those restarts
             |  were producing.
             |  Worth naming: the first two defects are the same mistake in
             |  opposite directions — a number was trusted without asking what
             |  it was a number OF. The mean was trusted as a per-stream rate;
             |  an inbound rate was trusted to justify an outbound remedy. Both
             |  had confident comments on top. The comments are how I found
             |  them: each one stated an intent the code underneath did not
             |  implement, which is a better defect detector than reading the
             |  code cold.
             |  Confidence: typecheck/eslint clean, production build passes,
             |  Jest 6063 → 6083 green (+20 new), re-measured against main after
             |  merging it in. Eight of the twenty were run against the previous
             |  rules first and fail there.
             |  NOT EXERCISED: the MeetingRoom harness still stops short of
             |  entering the room, so all three wirings — the sampler loop, the
             |  `online` listener, the resubscribe rejoin — are verified by
             |  reading, with only the pure policy under test. Fourth pass
             |  running with that gap; it is now the main thing standing between
             |  this area and real regression cover.


2026-09-17  |  A scrubber with a length  |  Asked to optimize recording playback
             |  and export, with questions first. Four answers, all the
             |  recommended option; the first one is the whole pass.
             |  THE RECORDING COULD BE PLAYED AND NOT WATCHED. The playback
             |  route already stitched the parts and answered Range requests,
             |  and I had called that "enough to seek" when I built it. It is
             |  not, and the reason is the container rather than the transport.
             |  What MediaRecorder writes while a meeting runs is a LIVE WebM:
             |  no duration in its header and no cue index, because neither can
             |  be written until a recording that is still being made has ended.
             |  A browser handed that shows a scrubber with no length and
             |  refuses to seek. Byte ranges cannot rescue it either — a byte
             |  offset into the middle of a WebM is not decodable without the
             |  header the FIRST part carries. So an hour-long meeting could be
             |  watched from the beginning and nowhere else, which is not
             |  really watching it.
             |  The fix is to stop asking the container for a timeline and store
             |  one. Each part now records where it starts and how long it runs,
             |  MEASURED at capture rather than assumed from the five-second
             |  timeslice — a timeslice is a request, not a promise, and a
             |  timeline built from "five seconds each" drifts far enough over
             |  an hour that the scrubber lands a minute out by the end.
             |  Playback then goes through MediaSource: part 0 is the
             |  initialization segment, every part after it is a cluster with
             |  its own absolute timestamp, and appending part N alone is
             |  enough to play from part N. A seek becomes "which part holds
             |  this moment" — a question about data, not about a format.
             |  Native controls had to go with it, because a duration the
             |  element does not believe in cannot drive its scrubber.
             |  Falls back to the plain element where MediaSource or the codec
             |  is missing: worse, no seeking, but it plays, and rendering
             |  nothing on an older browser would be the bigger regression.
             |  Recordings made before timing existed fall back to the nominal
             |  part length, which is approximate and keeps them watchable.
             |  THE 90-DAY WARNING WITH NOTHING TO DO ABOUT IT. The panel has
             |  always said "Deleted in N days" and there was no way to save a
             |  copy, which makes stating it worse than not stating it. A
             |  download now, on the same rule as watching: RLS has already
             |  decided this caller was in the meeting, and a recording you may
             |  watch in full is one you may keep. The filename is built from
             |  the date rather than the title — a title is user input on its
             |  way into a Content-Disposition header, and quoting that for
             |  every browser is a worse problem than not having it.
             |  The export now names the recording with its expiry, so a filed
             |  record does not quietly lose the video a month later. And a
             |  transcript line jumps the player to that moment: the turns come
             |  from the stored ROWS rather than being re-parsed out of the
             |  rendered text, because only the rows ever carried a time — and
             |  they never stopped being structured, so reading them is less
             |  work as well as more accurate.
             |  Two judgement calls worth keeping. A turn whose attribution
             |  confidence changes mid-way is split rather than merged: that is
             |  two different claims about who was speaking. And a host who
             |  pressed Record halfway through leaves early turns at a negative
             |  offset — kept and clamped to zero, because the words were still
             |  said and the nearest moment the recording holds is its start.
             |  Confidence: typecheck/eslint clean, production build passes,
             |  Jest 6063 → 6095 green (+32 new).
             |  NOT EXERCISED, and it is the important gap: there is no browser
             |  here. The MediaSource path — appending disjoint parts, the
             |  duration taking, the seek landing where the timeline says — is
             |  verified by reading and by the pure timeline tests underneath
             |  it, not by watching a recording. The arithmetic is covered; the
             |  wiring is not. First real playback of a real meeting is the
             |  proof, and the fallback is what catches it if the wiring is
             |  wrong.

2026-09-17  |  The feature that only worked in the recording  |  Asked to check
             |  for defects with screen sharing, then to fix all four. The
             |  through-line: `recording-layout.ts` had the right rules the
             |  whole time, and the live room had none of them.
             |  THE CAMERA BUTTON BLANKED THE SHARE. toggleScreen takes the
             |  camera off the local stream entirely, so during a share the
             |  stream's only video track IS the screen — and toggleCam flipped
             |  `enabled` across that stream. One press sent black frames to the
             |  whole room while the browser still lit its sharing indicator,
             |  the button still read "Stop sharing", and announceVideoState
             |  still reported the video live, because it ORs in shareOn. So
             |  nobody even fell back to a name card; they drew a black
             |  rectangle. The one person who could not see it was the
             |  presenter, whose own tile IS the screen. reacquireCamera has
             |  carried a "not while sharing" guard for weeks. The manual toggle
             |  never learned, because nothing made the two share a rule.
             |  A SHARE WAS NEVER SPOTLIGHTED. `sharingPeers` was tracked,
             |  broadcast over the signalling channel, and kept in step with
             |  every announcement — and read by nothing but the recording
             |  composer. In the live room a shared screen was one grid cell the
             |  size of a face, which at six people nobody can read, and the
             |  spotlight followed the audio meter, so a presenter who paused to
             |  take a question lost the big tile to the person asking, mid
             |  slide. That is the fifth write-mostly store this fortnight, and
             |  the first where the reader existed but was the wrong one: the
             |  recording read it, the room did not. New question to add to
             |  "who reads this?" — WHICH reader, and is it the one the user is
             |  looking at.
             |  A SECOND PICKER LEAKED THE FIRST CAPTURE. No in-flight guard on
             |  toggleScreen, and `shareOn` stays false while the picker is
             |  open, so a second press opened a second picker; the first
             |  capture was then dropped from the stream without being stopped
             |  and ran until the tab closed, with the browser still telling the
             |  member that surface was shared. The camera button has had this
             |  guard since it grew one.
             |  A SHARE KEPT PIXELS IT COULD NOT AFFORD. The capture asked only
             |  for a frame-rate cap, and screenSendCap pinned the resolution
             |  divisor at 1 deliberately, because resolution is what makes text
             |  readable. Both are right and together they defeat the thing they
             |  protect: at four peers the budget is ~600kbps, and a 5K capture
             |  held at full size on that is a smear. Capped at 1440p (ideal,
             |  never max — an OverconstrainedError here is a share button that
             |  does nothing) and the encoder now gives up resolution below the
             |  floor, which is the rule the camera ladder twenty lines above
             |  already stated.
             |  Worth naming: three of the four are the same failure of pairing.
             |  Two code paths that must agree — toggleCam and reacquireCamera,
             |  the live stage and the recording stage, the capture size and the
             |  encoder divisor — where one knew the rule and the other did not,
             |  and nothing in between forced the question. Each was individually
             |  well commented. The comments are what found them again.
             |  Confidence: typecheck/eslint clean, production build passes,
             |  Jest 6149 → 6167 green (+18 new), re-measured against main
             |  after merging it in (#1101 and #1104 landed mid-flight). Six of the eighteen were run
             |  against the previous rules first and fail there.
             |  NOT EXERCISED: the MeetingRoom harness still stops short of
             |  entering the room, so toggleCam's share branch, the picker guard
             |  and the stage wiring are verified by reading; only the pure
             |  policy in stage.ts, devices.ts and connection.ts is under test.
             |  Fifth pass with that gap. It is no longer the main risk in this
             |  area — it is the only one.

```

---

*This file is the Associate Agent's memory before the Associate Agent exists.*
*When the agent is built, it will read this file first.*
*When the system learns, it will write back to this file.*
*The prompt and the product are the same thing.*
