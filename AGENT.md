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
  - A device can fail three ways and each needs its own watcher: never starting
    (the liveness check), ending (the device-loss listener) and stalling — the
    track stays live and goes `muted`. The camera had all three and the
    microphone had two, and the missing one is the worse one: a frozen frame is
    visible to the person it happens to, silence looks like listening. The
    microphone stall is reopened first, once, and only told about if that does
    not help (`mic-liveness.ts`).
  - "No track" is not "cannot". Joining with the camera off opens no camera at
    all, so the standing that reads absence as a fault told every camera-off
    member nobody could see them, for the whole call, and hid every other media
    notice behind it. A device that was never wanted is the member's choice;
    `standingOf` has to be told which.
  - A phone put down and picked up again leaves every media element paused with
    a live stream attached, and the analyser context interrupted. Nothing in the
    room changed, so nothing re-ran `play()` or `resume()`. The page coming
    back is its own event, and it has to be listened for.
  - Every exit has to save, not just the ones that are pressed. The host's End
    and the Leave button both settled the sentence in flight and drained what
    was unsaved; the handler that runs when the HOST ends the meeting — the exit
    most people take — tore the call down at once. Under the ownership rule the
    words it dropped had no other copy.
  - A status that is only ever set on success is a lie waiting to happen. The
    recognizer's status went "active" on start and nothing on end, so an engine
    dying on every run with `network` was "Live" for the whole call. State has
    to be written on the way down as well as the way up.
  - A retry loop with no exit and no voice is the same as no retry: a refused
    save retried every thirty seconds forever, silently, while the room was
    told the member was covered. Three failures in a row is a fact worth saying.
  - Zero is not a measurement when the meter is off. A suspended AudioContext
    reads every level as zero, and zero recorded as a sample is "measured
    silence", which is evidence — it marked real speech a hallucination.
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


2026-09-17  |  The checks that were absent, not passing  |  Asked to fix the CI
             |  trigger miss, after watching it happen twice.
             |  On #1103 neither ci.yml nor jest.yml produced a run for the
             |  pushed head. The `opened` event simply did not deliver — no
             |  config in this repo explains that and none can prevent it. What
             |  the config DID do was make the miss unrecoverable: neither
             |  workflow listened for `ready_for_review`, so marking the draft
             |  ready — the very next thing that happens here — asked nothing,
             |  and the PR carried a check panel that read quiet rather than
             |  absent. #1097 was the same miss; that one was rescued by an
             |  unrelated push happening to land.
             |  Three gaps, all closed: `ready_for_review` on both workflows, so
             |  a dropped `opened` gets a second chance; `reopened` on jest.yml,
             |  which was missing outright, so a closed-and-reopened PR ran no
             |  tests at all; and `workflow_dispatch` on ci.yml, which jest.yml
             |  already had — when #1103's runs vanished the tests could be
             |  dispatched by hand and lint, typecheck and build could not.
             |  Worth naming: absent and green look identical in the check panel,
             |  and I nearly merged on that. The habit that caught it was not
             |  reading the panel at all — it was asking the workflow-run list
             |  which SHA each workflow last ran on. A check that never ran
             |  reports nothing, and nothing renders as calm.
             |  Cost accepted: a PR opened as a draft and later marked ready now
             |  runs ci.yml twice. Cheaper than a merge nothing checked. If that
             |  doubling bites, `concurrency` with cancel-in-progress is the
             |  standard answer and was deliberately not added here — it changes
             |  cancellation semantics for every run, which is more than this
             |  was asked to do.
             |  Confidence: both files parse and expose the intended trigger
             |  sets; typecheck clean and Jest 6190 green, though neither touches
             |  YAML. No workflow linter is configured in this repo. The real
             |  proof is this PR itself: jest.yml correctly will NOT run on it
             |  (its paths filter excludes .github/workflows/**), and ci.yml
             |  should fire once on open and again on ready-for-review.

2026-09-17  |  State that outlived the thing it described  |  Asked to check for
             |  defects with recording, then to fix all three. Two of them were
             |  one mistake wearing two faces, and the face it wore was six refs
             |  where there should have been one object.
             |  A FAILED START BURIED THE PREVIOUS RECORDING. `recordingIdRef`
             |  was set on a successful start and never cleared — not on stop,
             |  not in finalize. So it still held recording #1's id when
             |  recording #2's row insert failed, and the catch read it and
             |  called finalize("failed") on #1: a finished, watchable file
             |  rewritten to a failure, with an ended_at of now and a duration
             |  counted from a start hours earlier. The trigger is the ordinary
             |  failure mode of start — a transient insert error — so the cost
             |  of a recording that would not begin was a recording that had
             |  already finished.
             |  A FAST RESTART BLANKED THE PREVIOUS RECORDING'S NUMBERS. finalize
             |  captured the id up front and then awaited the upload queue,
             |  which was right — and read the COUNTERS after that await, which
             |  was not. `start` zeroes them, and the button is live the moment
             |  onStopped sets "idle", so a host who stops and records again
             |  while parts are still landing had #1 closed with size 0 and
             |  chunk_count 0. The panel renders a size only when it is above
             |  zero, so it simply vanished. Worse quietly: the same reset
             |  cleared the dropped-part count, so the notice telling the host
             |  what #1 had lost — added a fortnight ago for exactly this — was
             |  thrown away before it could be shown.
             |  Both are gone structurally rather than patched: one RecordingRun
             |  object per recording, passed to the functions that need it, so
             |  "is this still the current recording" is an identity check and a
             |  function that wants a recording is handed the one it means.
             |  A SWEPT RECORDING HAD NO LENGTH. The sweep recomputes size and
             |  part count from the chunk rows — deliberately, because it cannot
             |  trust wall-clock time for a tab that died — and then set no
             |  duration at all, so every recording it closed was listed with a
             |  size and no length. The data to compute one arrived when parts
             |  began carrying offsets; only the reader was missing. It now uses
             |  buildTimeline + timelineDuration, which is the same figure the
             |  player's scrubber shows, from the same rows.
             |  Worth naming: the sweep already knew the lesson the hook had not
             |  learned. It refuses to trust in-memory state and recounts from
             |  the rows; finalize trusted refs a restart could zero. When two
             |  places answer the same question and one is careful, the careful
             |  one is worth reading before writing the other.
             |  Also worth naming: three candidates did NOT survive checking —
             |  a dropped part stalling the player (partAtTime advances past the
             |  gap), double-pressing Record (the button is disabled while
             |  starting), and the two playback routes disagreeing on byte
             |  offsets (same rows, same order). Reporting those as defects
             |  would have cost more than finding them.
             |  Confidence: typecheck/eslint clean, production build passes,
             |  Jest 6192 → 6196 green (+4 new), baseline re-measured from
             |  origin/main in a clean worktree. All four were run against the
             |  previous behaviour first and fail there.
             |  NEW: lib/meetings/use-recording.test.tsx is the first test in
             |  this repo to drive a React hook, with the composer mocked and a
             |  Supabase stand-in. Both of its cases need two recordings
             |  interleaved to reproduce at all, which is why neither defect was
             |  noticed by hand. It is a small dent in the MeetingRoom coverage
             |  gap flagged on the last five passes — the hook, not the room.

2026-09-17  |  The transcript that stopped at a thousand lines  |  Asked to check
             |  for defects with the transcript, then to fix them. Three, and
             |  the first is the one that quietly decides how much of a long
             |  meeting this product remembers.
             |  EVERY TRANSCRIPT READ WAS CAPPED AT 1000 ROWS. supabase/config.
             |  toml sets `max_rows = 1000`. All three readers of
             |  `live_meeting_transcripts` — /api/meetings/report, the
             |  regenerate route, and the report page's clickable cues — asked
             |  for the whole table with no `.range()`, so PostgREST returned
             |  the first thousand rows and said nothing about stopping. No
             |  error, no flag, no short page: a truncated read and a complete
             |  one are the same shape. All three order by `ts` ascending, so
             |  the thousand rows they got were the EARLIEST thousand and what a
             |  meeting lost was its ENDING — the part where it decides things.
             |  A thirty-minute call does not reach a thousand utterances; a
             |  two-hour one, or a busy four-person one, does. The truncation
             |  also skewed the restore: chooseTranscript picks by line count,
             |  so a stored copy cut off at 1000 could lose to a posted copy
             |  that held less of the meeting. Fixed by paging, in one place
             |  (lib/meetings/transcript-read.ts) rather than three, because
             |  getting it wrong is silent in exactly the same way each time.
             |  `id` is now a tiebreak on `ts` so a page boundary cannot fall
             |  inside a tie and drop a row or repeat one.
             |  LEAVING A MEETING SAVED ONE BATCH. drainTranscript — the loop
             |  that keeps flushing until nothing is owed — was called from
             |  endMeeting and nowhere else. leaveMeeting tore the call down and
             |  navigated, leaving the flush effect's cleanup to fire a single
             |  keepalive flush of at most MAX_BATCH (50) lines, unchecked. Only
             |  a host sees End; every guest and every non-host leaves through
             |  the path that saved fifty lines. A participant whose writes had
             |  been failing reached Leave holding hundreds, and under the
             |  ownership rule in transcript-buffer nobody else was saving them.
             |  leaveMeeting now drains, awaited before it navigates.
             |  THE RESTORE PICKED A WINNER INSTEAD OF MERGING. chooseTranscript
             |  took whichever copy had more lines and discarded the other
             |  whole. Neither is a superset: the rows hold the opening a host
             |  who reloaded or joined late never had, and the posted copy holds
             |  the final seconds, spoken after the last flush and after the
             |  last row was ever written. So in the exact case the restore
             |  exists for — a host whose tab died — it returned the stored copy
             |  and threw away the end of the meeting. Replaced by
             |  mergeTranscripts. Both copies are rendered by the same formatter
             |  and both run in speaking order, so an identical line is the same
             |  utterance and shared lines anchor the two records; a run of
             |  lines OUTSIDE those anchors can be placed with certainty, before
             |  everything shared or after it, and is recovered. A line missing
             |  from the fuller copy's MIDDLE is deliberately left missing:
             |  between two anchors there is nowhere it provably goes, and a
             |  guess reorders a conversation the model then reads as a
             |  different meeting.
             |  Also worth naming: two candidates did NOT survive checking. The
             |  transcript POST returns `ids` the client deliberately ignores —
             |  it marks lines saved from the batch it sent, so a reply lost in
             |  transit still retires them, which is the better rule and not a
             |  bug. And the SpeechRecognition restart loop calls start() inside
             |  a setSrStatus updater, which contradicts the rule stated at
             |  toggleCam but is idempotent here and does no harm.
             |  Confidence: typecheck/eslint clean, production build passes,
             |  Jest 6341 → 6357 green (+16 new, +1 suite), baseline re-measured
             |  from origin/main in a clean worktree. The three merge cases were
             |  run against the previous pick rule first and fail there. The
             |  paging fix is covered at the loop, not at the call sites: the
             |  MeetingRoom/Supabase coverage gap flagged on the last six passes
             |  still means the three readers themselves are only exercised by
             |  typecheck and build.

2026-09-18  |  The chat that could not tell you it had failed  |  Asked to check
             |  for defects with the chat, then to fix all four. Chat looks like
             |  the simplest thing in the meeting and had the most ways to
             |  mislead the person using it.
             |  A SEND THAT FAILED LOOKED EXACTLY LIKE A SEND THAT WORKED.
             |  sendSignal was `channelRef.current?.send(...)` with the returned
             |  promise dropped. Realtime resolves it to "ok", "timed out" or
             |  "error", and sendChat appended the message locally FIRST and
             |  unconditionally. The channel is `broadcast: { self: false }`, so
             |  there was never a round trip to notice the absence of either. A
             |  send that timed out left somebody reading their own words in a
             |  room that had not received them — and the optional chain turned
             |  "there is no socket at all" into the same silence. Now the send
             |  is awaited and its answer becomes the message's own state:
             |  sending, sent, or "Not delivered" with a Retry that reuses the
             |  original id so a message that did go out cannot land twice. The
             |  precedent was already in the repo: nudgeGuests awaits the same
             |  call and counts failures, and says in its header that it may
             |  fail BECAUSE every guest also polls. Chat has no second chance.
             |  THERE WAS NOWHERE AN UNREAD COUNT COULD APPEAR. chatOpenRef was
             |  set true when the chat tab mounted and cleared only when the
             |  whole panel collapsed, so switching to People left it true and
             |  every message that arrived while somebody read the roster counted
             |  as read. Nothing said otherwise either — the toolbar badge is
             |  gated on `!copilotOpen`, and the Chat tab had no badge of its
             |  own. A host triaging the waiting room got no sign at all. The
             |  panel now reports visibility both ways round, and the Chat tab
             |  carries the count.
             |  MESSAGES WERE ORDERED BY ARRIVAL, SO NO TWO PEOPLE SAW THE SAME
             |  CONVERSATION. `ts` was carried end to end and read by nothing:
             |  the sender appended at send time, everyone else at receive time,
             |  so a line landed before its replies on one screen and after them
             |  on another. Sorted on ts now, tie-broken by the sender's message
             |  id — which is why the id is now carried on the wire. Same fix,
             |  for the same reason, restoreTranscript applies to rows.
             |  TEXT AND NAMES WERE TAKEN ON THE SENDER'S TERMS. No bound on
             |  either, and the name shown was whatever the payload claimed
             |  rather than the roster's, keyed by signaling id — the thing the
             |  TranscriptLine comment already argues for. Now bounded at 2000
             |  characters on the way out AND the way in, without cutting a
             |  surrogate pair in half, and resolved from the roster. A clock
             |  more than two minutes from ours stops deciding where its
             |  messages sit and gets our arrival time instead.
             |  Worth naming: the audit's fourth finding was reported WRONG and
             |  the browser said so. I wrote that a pasted URL would force the
             |  column wider than the panel, "which only scrolls vertically".
             |  It does not: Tailwind's `overflow-y-auto` sets one axis, and CSS
             |  computes the other to `auto` whenever its pair is not `visible`.
             |  So the panel silently becomes a SIDEWAYS SCROLLER and takes
             |  every other message off-screen with it — milder than a burst
             |  page, and still wrong. The first version of the visual check
             |  passed against the unfixed bubble, which is how this was caught;
             |  it now measures scrollWidth against clientWidth and fails at
             |  phone width without `break-words`.
             |  Confidence: typecheck/eslint clean, production build passes,
             |  Jest 6357 → 6390 green (+33 new, +2 suites), baseline
             |  re-measured from origin/main in a clean worktree; visual suite
             |  8/8. Ordering, naming and the length bound were each run against
             |  the previous behaviour first and fail there; delivery had no
             |  previous behaviour to fail.
             |  NEW: MeetingRoom.chat.visual.test.ts is the first layout check
             |  on the meeting room, and jest.setup.dom.ts now fills
             |  Element.scrollIntoView — absent from jsdom, called by five
             |  components here, and the reason none of them had a test. A real
             |  dent in the MeetingRoom coverage gap flagged on the last seven
             |  passes: CopilotSidebar is now exported and tested directly, the
             |  way HostExitControl already was.

2026-09-18  |  The chat that did not outlive the call  |  Asked to optimize the
             |  meeting chat and reactions. Landed on top of the same day's
             |  delivery/ordering/naming pass, which fixed how a message
             |  behaves on its way through the room; this is about what happens
             |  to it afterwards.
             |  NOTHING STORED THE CHAT. It was a Supabase broadcast into a
             |  React array and nowhere else. Broadcast has no history and no
             |  durability, so somebody who joined ten minutes into a call saw
             |  an empty panel while the room talked about what had been said in
             |  it, a reload emptied their own copy, and the conversation went
             |  when the call did. The report carried the transcript of what was
             |  SAID and nothing of what was TYPED — which for most calls is
             |  where the documents, the numbers and the links were. Found by
             |  the same diagnostic as the last five passes: follow what gets
             |  written and ask who reads it. Nothing was written, so nobody
             |  could.
             |  Built: live_meeting_chat (client-minted id as the primary key,
             |  so a retried post upserts rather than duplicating, exactly as
             |  live_meeting_transcripts does), attendees-only SELECT and NO
             |  write policy at all — writes go through GET/POST
             |  /api/meetings/[id]/chat, because a table whose only sensible
             |  policy is keyed on auth.uid() has nothing to say about an
             |  invite-link guest, and the route is what authorizes one.
             |  THE CALLER CHECK WAS ABOUT TO BE COPIED. The transcript route's
             |  host/participant/org-member/admitted-guest ladder is the rule
             |  the chat route needs, verbatim. Extracted to
             |  lib/meetings/meeting-access.server.ts rather than pasted: three
             |  copies drifting apart is how a guest ends up able to write a
             |  transcript line and not a chat message, with nobody able to say
             |  which was intended.
             |  THE CHAT READ AS A LOG. Three lines from one person repeated
             |  their name three times; nothing carried a time; and a shared URL
             |  — the single commonest thing anybody puts in a meeting chat —
             |  was flat, unfollowable prose. groupChat, chatClock and chatParts
             |  fix all three. chatParts returns PARTS, not markup, so the
             |  caller renders React nodes and nothing here can put HTML on a
             |  page; it matches plainly-written http(s) and nothing else, and
             |  the href is re-parsed with `new URL` rather than pattern-matched
             |  (a "javascript:" inside a sentence is text, and is tested as
             |  such).
             |  A REPEATED REACTION CLEARED ITSELF EARLY. The expiry compared
             |  the emoji VALUE: sending 👍 twice meant the second send's
             |  timeout and the first send's timeout both matched, so the first
             |  one's expiry wiped the second one three seconds early. Timers
             |  are keyed by person now and cleared on unmount.
             |  A RAISED HAND GOT NONE OF THE ATTENTION CHAT GETS. It showed as
             |  a ✋ on a tile that is off-screen in speaker layout, and beside a
             |  name in a sidebar tab that is closed by default — while a
             |  one-word chat message lights a badge on the toolbar. So the
             |  person whose hand is up waits on somebody happening to look.
             |  lib/meetings/hands.ts: raisedBy (others only, oldest first —
             |  the order a chair would take them in, and the order a Set
             |  preserves), handsUpLabel, handsFirst. The control bar carries
             |  the count and says who; the people list lifts them to the top.
             |  Also: the export's recording block and the new chat block are
             |  now BOTH gated on attendance. RLS would refuse them anyway, but
             |  a caller about to be told the report is not theirs has no
             |  business costing the queries. The test that caught it asserted
             |  the whole set of tables queried while claiming something
             |  narrower ("without asking the participants table"); tightened to
             |  what it says rather than relaxed.
             |  Confidence: typecheck/eslint clean, production build passes,
             |  Jest 6390 → 6444 green (+54 new, +2 suites), baseline
             |  re-measured from origin/main in a clean worktree; visual suite
             |  still green, and the chat panel's own layout check re-run
             |  against the grouped, linkified rendering.
             |  MERGE NOTE worth keeping: this branch and the delivery/ordering
             |  pass above built lib/meetings/chat.ts in parallel and collided
             |  on it. Resolved by union, not by choosing: normalizeChatText
             |  gained the control-character strip the stored path needs,
             |  mergeChat sorts by the same comparator insertMessage uses (and
             |  carries `delivery` forward from the local copy, because a stored
             |  row has no idea whether your socket accepted the send), and the
             |  panel is grouped AND shows delivery AND links. Two parallel
             |  branches on one file is now the norm here, not the exception.

2026-09-18  |  Four ways the waiting room told a guest the wrong thing  |  Asked
             |  to check the waiting room again — a second pass over an area
             |  already fixed once this session — then to fix all four.
             |  A REFUSED KNOCK LOOKED LIKE A KNOCK NOBODY HAD ANSWERED. The
             |  poll read its response through pollStatusFromResponse; the knock
             |  did `if (!res.ok) return null` inline. So a 429 — no row
             |  inserted, host never told — came back as "no verdict", the
             |  session began waiting, and the guest was shown "Waiting for the
             |  host to let you in" over a queue they were not in. It could not
             |  recover: the poll answered "unknown" (no row on file) by
             |  re-knocking straight into the same refusal. Two ways in, and the
             |  single-guest one needs no crowd — the unknown→re-knock path
             |  spends all 60 of KNOCK_LIMIT in about 90 seconds. Both halves of
             |  the endpoint now read through one function, which names a
             |  refusal "busy", and the screen says so.
             |  THE POLL NEVER READ THE ONE ANSWER THAT SAID TO SLOW DOWN. A 429
             |  mapped to null and the cadence was picked purely from elapsed
             |  wait, so a limited guest kept asking every 1.5s — which is what
             |  kept them limited — while the limiter sent Retry-After into a
             |  header nobody read. Consecutive refusals now back off, the
             |  server's own number wins when it gave one, and the ladder is the
             |  floor under it. The repo had this pattern twice already, in
             |  nextFlushDelay and nextRecovery.
             |  A GUEST WHO GAVE UP STAYED ON THE HOST'S PANEL FOREVER.
             |  cancelAdmission stopped the local session and touched nothing on
             |  the server; there is no TTL on the table and nothing sweeps it.
             |  The host went on seeing somebody who had left — in the panel, in
             |  the toolbar count, and in the system notification knockAlert
             |  fires when that count rises — and admitting them reached nobody.
             |  DELETE on the knock route withdraws, guarded to status=waiting
             |  so an admit (which the transcript route checks a guest's writes
             |  against) and a deny are both untouchable. Called on cancel, on
             |  pagehide while still asking, and when the wait ends itself.
             |  THE WAIT HAD NO END, AND THREE COMMENTS SAID IT DID.
             |  ADMISSION_TIMEOUT_MS changes the copy and nothing else — by
             |  design, and documented — but scheduleNext rescheduled
             |  unconditionally and nothing else stopped it. Meanwhile
             |  admission-poll.ts, MeetingRoom and admission-poll.test.ts all
             |  described "the full ten minutes a wait is allowed to run". So a
             |  waiting tab left open asked an unauthenticated, service-role
             |  endpoint every ten seconds for as long as it lived. The bound
             |  those comments claimed now exists. Not a verdict: nobody decided
             |  anything, so the screen offers to ask again.
             |  Worth naming: MeetingRoom.admission's fetch stub was `{ ok,
             |  json }` and nothing else. That was fine while the room read only
             |  those two and broke the moment it read `status` and `headers` —
             |  every real Response has both, and a stub missing them turns into
             |  a TypeError the session reads as "the request failed". Six tests
             |  went red on a change that was correct. A mock that is a worse
             |  Response than the browser's is a test asserting something the
             |  product does not do; it is a faithful stub now.
             |  Also worth naming: five candidates did NOT survive checking — a
             |  deny surviving a reload or a second tab (resolveGuestKey already
             |  puts the key in localStorage), the knock's read-then-insert race
             |  (UNIQUE_VIOLATION is caught and re-read through the same path), a
             |  forged nudge (it carries no verdict), loadWaiting being unbounded
             |  against max_rows (a thousand-person waiting list is not a
             |  meeting), and a host closing their tab without ending the meeting
             |  — real, but the meeting lifecycle rather than the waiting room.
             |  Residual, stated plainly: a hard crash or a killed tab still
             |  leaves a stale row, because pagehide does not fire for those. A
             |  server-side sweep would close that; withdraw covers cancel,
             |  unload and give-up, which is the overwhelming majority.
             |  Confidence: typecheck/eslint clean, production build passes,
             |  Jest 6390 → 6424 green (+34 new), baseline re-measured from
             |  origin/main in a clean worktree; visual suite 8/8. The refusal
             |  and wait-bound cases were run against the previous behaviour
             |  first — four of them fail there.

2026-09-19  |  The reaction nobody could see, and nobody could hear  |  Asked to
             |  check for defects with reactions, then to fix all four. Two of
             |  them are the same asymmetry: hands.ts had already written down
             |  why a tile is a bad place to be noticed, #1113 acted on it for
             |  raised hands, and reactions were left where they were.
             |  THE EMOJI WAS RENDERED ON THE SENDER'S TERMS. The picker offers
             |  six, and nothing on the receiving side ever consulted that list:
             |  the handler passed msg.emoji straight through and the tile drew
             |  it at text-4xl. A peer on a modified build could paint any
             |  string of any length across somebody's picture. An allowlist
             |  rather than a length bound, because "a reaction" means one of
             |  those six — eight characters of anything else is still eight
             |  characters of anything else. Applied on the way in AND out, the
             |  same argument normalizeChatText makes.
             |  A REACTION COULD BE COMPLETELY INVISIBLE. It was drawn in
             |  exactly one place, an overlay on the sender's tile, and the
             |  thumbnail strip is overflow-x-auto. Worse than the hands case it
             |  mirrors, twice over: a hand stays up until lowered so a late
             |  look still finds it, where a reaction lives three seconds; and a
             |  screen share FORCES speaker layout, so everyone but the
             |  presenter is in that scrolling strip at the moment people most
             |  want to react. ReactionTicker puts them over the stage with the
             |  name attached. Not a count, which is what the hands affordance
             |  is — a reaction is an event, not a standing state.
             |  A REACTION WAS INVISIBLE TO A SCREEN READER. The tile overlay is
             |  a bare emoji with no text, so there was nothing to announce and
             |  reactions did not exist at all for anyone not looking at the
             |  picture. reactionLabel is the equivalent of handsUpLabel, whose
             |  own docstring says it is "for a tooltip and for a screen
             |  reader". The ticker is aria-live=polite; the tile overlay is now
             |  aria-hidden, or it would read twice.
             |  A DEPARTING PEER LEFT A LIVE TIMER. The leave handler dropped
             |  the reaction and left the timeout running, so three seconds
             |  later an orphan fired against somebody no longer in the room —
             |  and its updater allocated a fresh record whether or not there
             |  was anything to remove, re-rendering the whole meeting for
             |  nothing. The leave handler two thousand lines earlier already
             |  used the right idiom. That rule is withoutReaction now, and both
             |  call it.
             |  Worth naming: I wrote a visual check for the ticker and it
             |  passed against the deliberately-broken version, so it was
             |  deleted rather than shipped. Twice now a first-cut visual check
             |  has measured the wrong thing — on the chat panel the control
             |  caught it and the check was fixed; here the layout genuinely
             |  cannot break the way I was measuring (a long name WRAPS by
             |  default, and truncate clips), so there was nothing to guard. A
             |  test that cannot fail is worse than no test: it reads as
             |  coverage. Run the control before believing a green check.
             |  Also worth naming: four candidates did NOT survive checking —
             |  the double-reaction early-clear (fixed in #1113), a reaction
             |  that fails to send (fire-and-forget by design; ephemeral, unlike
             |  chat), reduced motion (the globals.css catch-all already
             |  neutralises animate-bounce), and seeing your own twice
             |  (broadcast self:false plus the from !== myId guard).
             |  Confidence: typecheck/eslint clean, production build passes,
             |  Jest 6483 → 6509 green (+26 new, +2 suites), baseline
             |  re-measured from origin/main in a clean worktree; visual suite
             |  8/8. The bound, the ordering and the no-op render were each run
             |  against the previous behaviour first and fail there.
2026-09-18  |  The removal that removed you from one screen  |  Asked to optimize
             |  meeting participant management and the waiting room.
             |  "REMOVE" WAS A MESSAGE. The host's client broadcast
             |  {type:"kick", target} on the signalling channel and closed its
             |  own peer connection, and nothing else happened anywhere. Two
             |  consequences, both invisible from the host's screen, which is
             |  where the tile had just vanished.
             |  THEY NEVER LEFT. handleSignal gates the kick on
             |  `msg.target === myId`, so only the removed person acts on it —
             |  and kickPeer closed only the HOST's connection. Every other
             |  participant kept a live peer connection, so the removed person's
             |  camera and microphone carried on reaching all of them. The host
             |  watched the tile go and reasonably concluded they were gone.
             |  THEY CAME BACK. Nothing was written. A guest's guest_key lives
             |  in localStorage against the room code and their admission row
             |  still said "admitted", so a reload took the knock route's
             |  "return the existing decision" path straight back into the call.
             |  A signed-in teammate had it easier: callerIsOrgMember
             |  auto-admits, so they never went near the waiting room at all.
             |  Built: live_meeting_removals, keyed on the ACCOUNT for anyone
             |  who has one and on the guest key otherwise. That asymmetry is
             |  the whole design — membership is what waves a teammate past the
             |  queue, and a teammate can drop a guest key but not an account.
             |  Host-verified POST/DELETE route; the knock route refuses a
             |  removed subject ahead of BOTH the membership check and quick
             |  access, matched against the account the SERVER resolves from
             |  cookies rather than anything the body claims.
             |  DELETE exists because the fix opened a smaller hole than it
             |  closed: a misclick used to correct itself the moment the person
             |  pressed reload, and a durable removal with no undo would be a
             |  worse trap than the one it replaced.
             |  The nudge that tells the room names NOBODY, and that is load-
             |  bearing. admission-channel.ts had already established that
             |  anyone holding a room code can publish on a broadcast channel,
             |  so a message saying "drop peer X" would be a way to eject
             |  anybody from any meeting whose link was ever forwarded. Each
             |  client instead asks POST /public/[roomCode]/removed about the
             |  peers IT can see, and the endpoint answers only about subjects
             |  the caller already named — so it cannot be turned into a way to
             |  enumerate a meeting's guest keys, which would be enough to read
             |  another guest's admission status from the poll next door.
             |  Worth saying plainly: the subject a peer announces is
             |  self-asserted, exactly as its displayName already was. This does
             |  not pretend to fix the room's trust model. What it buys is that
             |  a removal has something durable to be written against, and the
             |  check that matters happens server-side on the way back in.
             |  THE WAITING ROOM FILLED WITH PEOPLE WHO HAD LEFT. A `waiting`
             |  row is cleared by a decision and by nothing else, so a guest who
             |  knocked and closed the tab stayed in the host's panel for the
             |  rest of the meeting — chiming, badging the tab title, counting
             |  in "Waiting to join (3)", and ending with the host admitting
             |  somebody who was never going to appear. The liveness signal
             |  existed and was being discarded: a waiting guest polls every
             |  1.5s and that handler only SELECTed. THE INVERSE OF THE USUAL
             |  DIAGNOSTIC — instead of "follow what gets written and ask who
             |  reads it", this was "follow what gets READ and ask what it could
             |  have told us". Worth adding to the kit.
             |  last_seen_at is throttled to a third of the grace window. The
             |  naive version would have been an UPDATE every 1.5s per waiting
             |  guest AND — because live_meeting_admissions is in the Realtime
             |  publication and the host subscribes to `*` on it — a list
             |  re-apply and a coalesced re-read on the host's screen at the
             |  same rate. I nearly shipped that; the existing test asserting
             |  the poll costs one query is what caught it.
             |  The panel filters on presence rather than deleting rows, so a
             |  guest who comes back (reopened the tab, out of the tunnel) keeps
             |  their place in the queue instead of having to knock again.
             |  Also: loadWaiting had no .limit(), so it truncated silently at
             |  PostgREST's max_rows exactly as the transcript read used to. And
             |  live_meeting_admissions.user_id has existed since the waiting
             |  room shipped and has been NULL on EVERY row ever written — the
             |  knock route resolved the caller's account to decide whether they
             |  were a teammate and then threw it away. Found by the usual
             |  diagnostic, and it is the column the removal needed.
             |  MERGED WITH THE PASS ABOVE, which another session wrote at the
             |  same time over the same files. The two fixed the stale-knock
             |  defect from opposite ends and neither is redundant: they
             |  withdraw eagerly (DELETE on cancel and pagehide), this expires
             |  on a missing heartbeat. Their entry names the residual —
             |  "a hard crash still leaves a stale row, because pagehide does
             |  not fire for those. Closing that needs a server-side sweep" —
             |  and last_seen_at closes exactly that, without a sweep. Where we
             |  disagreed they listed loadWaiting's missing .limit() under
             |  "checked and not changed"; it is bounded here, on the grounds
             |  that it is a guard against PostgREST truncating silently rather
             |  than a limit on how many people may queue. Two sessions on one
             |  surface is now normal: assume it, and write the entry so the
             |  other half can be told apart from your own.
             |  REVIEW CAUGHT TWO THINGS THAT WOULD HAVE SHIPPED BROKEN, and
             |  both deserve recording because both were failures of a pattern
             |  this file already warns about.
             |  The unique indexes were PARTIAL — `(meeting_id, user_id) WHERE
             |  user_id IS NOT NULL` — and `ON CONFLICT` can only infer a
             |  partial index if the statement repeats its predicate, which
             |  PostgREST's `on_conflict` (column names only) cannot. So every
             |  removal upsert would have failed with 42P10: EXACTLY the defect
             |  already recorded here against live_meeting_participants. Reading
             |  your own changelog is not the same as applying it.
             |  And "Allow back" did nothing: DELETE lifted the removal row but
             |  left the admission at `denied`, and the knock is idempotent, so
             |  the person stayed out forever. The undo I added to avoid a trap
             |  was itself inert.
             |  THE BIGGER CORRECTION was the identity model. Peers announced
             |  their own subject over the signalling channel and the host sent
             |  it back to be removed — so a participant could announce somebody
             |  ELSE'S subject, let the host click Remove on their tile, and
             |  have the service role ban the victim while they reconnected. I
             |  had written "self-asserted, exactly as displayName already is"
             |  and talked myself past it. It is not the same: a display name
             |  misleads a human, an identity here drives a privileged write.
             |  Now the knock records the signalling id, the host sends only
             |  that, and the SERVER resolves whose tile it is. Which deleted
             |  code — no subject on the wire, no parseSubject, no removedAmong
             |  — and made the public check answer in signalling ids, which
             |  everyone in the room already has.
             |  The same move fixed the `kick` signal, which predates all of
             |  this: it was obeyed on arrival, on a channel anyone with the
             |  room code can publish to. It is a hint to go and ask now.
             |  Also from review: the knock checked ONE subject (subjectFor
             |  prefers the account, so a guest removed by key could sign in and
             |  slip past); readRemovals treated a failed query as "nobody is
             |  removed"; the presence write was a bare `void` in a serverless
             |  handler, which this file records as a defect class and which
             |  `after()` exists for; and the stale filter ran after the cap, so
             |  a queue headed by people who had left would hide everyone real.
             |  LESSON worth keeping: a comment explaining why something is
             |  acceptable is the place to look hardest. Three of these were
             |  under one.
             |  Confidence: typecheck/eslint clean, production build passes,
             |  Jest 6449 → 6566 green, baseline
             |  re-measured from origin/main in a clean worktree; visual suite
             |  8/8. The knock refusals were each run against the previous
             |  behaviour first and fail there.
             |  STILL NOT COVERED: the MeetingRoom coverage gap flagged on the
             |  last eight passes. CopilotSidebar's new panel is tested
             |  directly, and the pure rules and both routes are; the room's own
             |  wiring of them — the subject announcement, the nudge
             |  subscription, dropPeer — is exercised only by typecheck and
             |  build.

2026-09-18  |  The recording that outlived the meeting  |  Asked to optimize the
             |  meeting recording lifecycle and storage. The lifecycle itself
             |  was already built — an hourly sweep expires recordings and
             |  closes out ones whose host vanished mid-call — so this is three
             |  ways the BYTES escaped it.
             |  DELETING A MEETING DELETED EVERYTHING EXCEPT THE RECORDING.
             |  live_meeting_recordings.meeting_id is ON DELETE CASCADE and the
             |  chunk rows cascade from that, so a hard delete removed every row
             |  that knew a recording existed and left the recording in the
             |  bucket. And not in a harmless way: the Storage read policy asks
             |  attended_live_meeting(), which resolves through live_meetings,
             |  so with the meeting gone nobody could read them either. A host
             |  pressed Delete, was told it was done, and the faces, voices and
             |  shared screens stayed — unreachable, unfindable by the expiry
             |  sweep, and kept. Worth naming the shape: THE CASCADE DESTROYED
             |  THE EVIDENCE OF WHAT TO CLEAN UP. Any delete whose side effects
             |  live outside Postgres has this problem, and the fix is always
             |  the same two halves — read what you will need before the delete,
             |  and have a sweep that can find the wreckage without it.
             |  So: the route reads the ids first and removes the objects, and
             |  the sweep gained an orphan pass driven from the BUCKET rather
             |  than the database, because the database is exactly where the
             |  evidence went. That pass is not belt-and-braces — it is what
             |  covers every meeting deleted before today, and scheduling-
             |  service.ts, which hard-deletes meetings without going near the
             |  route. It spares soft-deleted meetings on purpose: those can
             |  still be restored and their recording is still readable.
             |  THE EXPIRY SWEEP ORPHANED EVERYTHING PAST THE THOUSANDTH PART.
             |  removeObjects listed the prefix with { limit: 1000 } and no
             |  paging. CHUNK_MS is 5s, so a thousand parts is 83 minutes: every
             |  recording longer than that left its remainder behind while the
             |  row was marked deleted, its size zeroed and its chunk rows
             |  dropped — after which nothing pointed at those objects at all.
             |  The function's own comment says it lists rather than reading the
             |  chunk rows precisely so an object the rows lost track of still
             |  gets cleaned; the cap silently defeated that, for exactly the
             |  recordings that cost the most. Paged now, and it THROWS rather
             |  than half-deleting: marking a row gone while objects nothing can
             |  find remain is the one outcome worse than not deleting.
             |  TWO CLOSE PATHS, TWO DIFFERENT DURATIONS. finalize() wrote
             |  duration_seconds from wall clock; the sweep wrote it from the
             |  part timeline and said so — "the same figure the player's
             |  scrubber shows, from the same rows". They differ by exactly the
             |  parts that were dropped, which this path already counts, so a
             |  recording that lost a minute was listed and exported a minute
             |  longer than the video anyone could watch. Both read the parts
             |  now. THE DIAGNOSTIC HERE WAS "two things compute the same
             |  number; do they agree?" — worth adding beside "follow what gets
             |  written and ask who reads it".
             |  Confidence: typecheck/eslint clean, production build passes,
             |  Jest 6575 → 6600 green (+25 new, +1 suite) measured on this
             |  branch's own merge base, which is the waiting-room pass plus
             |  main after #1114. The paging and orphan cases were run against
             |  the previous behaviour first and fail there; the delete route
             |  had no tests at all before this.
             |  NOT COVERED: nothing verifies the bucket against the database in
             |  the other direction — a chunk row whose object is missing is
             |  still only discovered by a viewer hitting a hole. And the orphan
             |  pass reads the bucket root, which only ever grows; at some size
             |  that listing needs its own cursor.
             |  REVIEW ROUND, AND THE LESSON OF THE PASS. A review of this diff
             |  found the very defect it was written to fix living in two more
             |  places IN THE FIX ITSELF. sweepOrphans listed the root at offset
             |  0, limit 200, every run — and living meetings' folders are never
             |  removed, so the window never advances: past ~200 recorded
             |  meetings an orphan sorting after it is never examined again.
             |  "A backlog is taken next hour" was in the comment and was false;
             |  this pass is the only thing that can find these objects, so it
             |  was never. And clear-all read 50 ids while deleting every
             |  meeting, discarding the read's error, so a host with 120
             |  meetings orphaned 70+ on the spot and a failed read cleaned
             |  nothing, deleted everything and returned 200.
             |  WORTH KEEPING, and the real output of this pass: WRITING THE
             |  FIX FOR A DEFECT DOES NOT INOCULATE THE FIX AGAINST IT. I had
             |  just written two paragraphs on a cap silently orphaning the
             |  remainder, and then wrote two more caps that do it. The tell in
             |  both was the same and was sitting in my own prose: a bound
             |  whose comment explains why the remainder is fine. That is the
             |  "a comment explaining why something is acceptable is the place
             |  to look hardest" rule from the last pass, met again one pass
             |  later, in my own words, about my own code.
             |  Second: the harnesses HID both. list() ignored its offset and
             |  limit() ignored its bound, so each cap passed its tests as
             |  though it were not there. A stub that does not honour the
             |  argument under test cannot fail the test that matters — so when
             |  a bound is the thing being fixed, fix the harness first and
             |  watch the old code fail.
             |  Also: recordings.orphaned was computed and dropped on the floor.
             |  It is in the cron metrics now — the one number that would have
             |  exposed either of the two above.
             |  Re-verified after: Jest 6621 green across 488 suites, typecheck
             |  and eslint clean, build passes; four new tests, each run against
             |  the previous behaviour first and failing there.

2026-09-18  |  The transcript that would not follow, and the search that found
             |  turns  |  Asked to optimize the meeting transcript search and
             |  playback sync. Both defects turned out to be the same shape:
             |  the panel knew something and told nobody.
             |  SYNC RAN ONE WAY. A line could seek the recording — that was
             |  built in #1101 — and the recording reported its position to
             |  nobody. RecordingPlayer tracked positionMs in its own state and
             |  never lifted it. So watching forty minutes of a meeting back
             |  meant scrolling the transcript by hand to keep up, which is the
             |  work having the two side by side exists to remove. Every piece
             |  was already there: the cues carry a clock and the player tracks
             |  one. The missing thing was a wire and the question "which of
             |  these is being said right now" (cueAt — the LAST cue that has
             |  started, not the nearest, so a pause mid-sentence still belongs
             |  to the speaker).
             |  cuesCanFollow is the honest half: transcriptCues clamps to zero
             |  every turn spoken before Record was pressed, which is right for
             |  seeking (the nearest moment the recording holds is its start)
             |  and useless for following — a meeting recorded from halfway has
             |  a pile of turns all claiming 0ms, and marking one of them "now"
             |  would be inventing a fact. So following is offered only when
             |  the clamped pile is not most of the transcript.
             |  SEARCH FOUND TURNS, NOT WORDS. It filtered the list to the turns
             |  containing the query and stopped. The match was never shown, so
             |  searching "valuation" returned eight turns and left you reading
             |  all of them to find the word — the task the search box exists to
             |  avoid. There was no count and nowhere to step. And filtering
             |  DELETED the conversation around each hit, which is the part that
             |  makes a hit mean anything: "Yes, about forty" is not an answer
             |  until the question above it is visible.
             |  It locates now instead of filtering: every match, in order, with
             |  its span inside the paragraph, so the caller paints them in
             |  place. Parts rather than markup, the same rule chatParts
             |  follows, because this is other people's words. A test asserts
             |  the parts reassemble into exactly the sentence that was said — a
             |  renderer that drops a character is rewriting a meeting record.
             |  WORTH KEEPING: "what does this component know that it never
             |  says?" found both. It is the same question as "follow what gets
             |  written and ask who reads it", pointed at state instead of at
             |  rows — positionMs was written on every timeupdate and read by
             |  one scrubber.
             |  Also: stepping to a search hit beats following the playhead, on
             |  purpose. Somebody who searched is reading, not watching, and
             |  being dragged away mid-sentence by the recording is the
             |  behaviour that makes people switch sync off everywhere it
             |  exists. Following also yields to the first scroll and offers
             |  itself back rather than fighting.
             |  Confidence: typecheck/eslint clean, production build passes,
             |  Jest 6592 → 6663 green (+71 new, +2 suites) measured on this
             |  branch's own base. The panel now has a component test at last —
             |  a real dent in the report-page coverage gap flagged on the last
             |  nine passes, and it covers both directions of the link plus the
             |  text-integrity property.
             |  NOT COVERED: the highlight is a substring match, so a search for
             |  "forty" does not find "40". Worth doing and deliberately not
             |  done here — number and homophone matching is its own pass, and
             |  guessing at it silently would make the count untrustworthy.

2026-09-23  |  A call with nobody on the other end of the software  |  Asked
             |  for a one-way meeting: record yourself on a phone call and get
             |  analytics. Founder's answers set the shape — microphone with an
             |  optional capture of the computer's own audio, ONE transcript
             |  rather than separating the two voices, the existing meeting
             |  report rather than new speaking metrics, a searchable archive,
             |  and a consent acknowledgement stored with a disclosure to read
             |  aloud.
             |  THE ARCHITECTURAL DECISION, and the one worth keeping: a call is
             |  a live_meetings ROW, not a table of its own. Recording objects
             |  are keyed <meeting_id>/<recording_id>/…, the bucket's read
             |  policy resolves through live_meetings, and both the expiry sweep
             |  and the delete cleanup find a recording's bytes by way of that
             |  table. A calls table would have sat outside every one of them
             |  and orphaned its own audio the first time a call was deleted —
             |  which is EXACTLY the defect the 2026-09-18 pass spent itself
             |  fixing. Reusing the row means reusing the lifecycle that
             |  already works. The cost is one column and a filter on four
             |  lists; the review found two of those lists I had missed.
             |  AUDIO ONLY, which is why audio-capture.ts exists beside
             |  recording-policy.ts rather than reusing it. The meeting
             |  recorder composites a canvas at 1.5Mbit: right for a room with
             |  faces in it, and 675MB an hour of still picture for a phone
             |  call. At the audio bitrate the same hour is ~57MB and every
             |  part, player, sweep and cleanup works on it unchanged.
             |  useRecording now takes a SOURCE rather than constructing a
             |  composer. Not tidiness: everything downstream of the part
             |  contract — the retrying upload, the part rows, the duration
             |  taken from the parts — is where the 2026-09-18 duration bug
             |  lived, and a second copy of it for calls would have re-created
             |  that bug in a place nobody was looking.
             |  WORTH KEEPING, from the review round: A RECORDING ENDS ONCE,
             |  and that invariant belongs with the code that WRITES the row,
             |  not with each source being well-behaved. MediaRecorder fires
             |  onstop after onerror, so both recorders — the new one and the
             |  meeting composer, which has had this since it was written —
             |  reported an error and then a clean stop, and useRecording
             |  finalized the same recording twice: failed, then complete. The
             |  second one sticks, so a broken recording was filed as good and
             |  the error banner was cleared. Fixed in all three places; the
             |  test that proves it is at the HOOK, because that is where the
             |  invariant lives.
             |  Second: A ROUTE THAT REFUSES IS A ROUTE THAT STRANDS. The report
             |  route is the only thing that ever marks a session ended, and it
             |  400s on an empty transcript. A call recorded in a browser with
             |  no speech recognition has audio and no words — an ordinary
             |  outcome — so it stayed open forever while the person watched a
             |  report page generate a summary that was never coming. One-way
             |  calls close out without analysis now; for a meeting the refusal
             |  stands, because a meeting with no transcript is a bug and an
             |  empty report would bury it.
             |  Third, and a repeat: A BLIND PATCH HITS THE WRONG THING. The
             |  new columns were added to database.types.ts by finding
             |  "meeting_type: string;" twice — and the second occurrence was
             |  SchedulingEventType, a different table entirely. Same shape as
             |  the blanket regex that rewrote the removals tests in September.
             |  Review found it; nothing else would have, because extra
             |  optional fields on a type compile perfectly.
             |  Confidence: typecheck/eslint clean, production build passes,
             |  Jest 6900 → 6972 green across 504 suites. Ten review findings,
             |  all fixed, four of them in lists and lifecycles rather than in
             |  the feature itself.
             |  NOT COVERED, and this is the honest part: NOTHING HERE HAS MET A
             |  REAL MICROPHONE. The pure rules are tested and the wiring is
             |  not — no test opens getUserMedia, mixes two streams, or plays
             |  back what was stored. Worth ten minutes with an actual phone
             |  call before it is trusted: speakerphone for both sides, then a
             |  tab share with the audio box ticked and with it unticked.
             |  Also not covered: two-party diarization (the founder chose one
             |  track), speaking metrics, and trends across calls. And consent
             |  is an acknowledgement with a script, NOT legal advice — the
             |  product records what somebody confirmed, it does not obtain
             |  consent for them.

2026-09-23  |  The report that was always about to arrive  |  Asked to optimize
             |  the meeting report page. The worst thing on it was mine, from
             |  the one-way call pass earlier the same day, and it was a fix
             |  that did not land.
             |  THE PAGE ASKED THE WRONG QUESTION. reportViewState keyed ready
             |  on hasSummary: Boolean(report.summary). The report route writes
             |  a row with summary: "" down two paths — a model call that
             |  failed, and (new that morning) a one-way call with nothing
             |  transcribed. Both are FINISHED. Keyed on the summary, both read
             |  as "generating": a permanent spinner, polling every five
             |  seconds for the life of the tab, over a recording and a
             |  transcript sitting right there fully readable.
             |  CodeRabbit had flagged the symptom on #1124 and I "fixed" it by
             |  writing the report row — without checking what the page did
             |  with a row it considered empty. WORTH KEEPING: A FIX IS NOT
             |  DONE UNTIL THE READER OF THE DATA AGREES. Writing the row
             |  satisfied the route; the PAGE decides what a row means, and
             |  nobody asked it. "Follow what gets written and ask who reads
             |  it" — already in this file — pointed straight at it, and I did
             |  not run it on my own fix.
             |  The state split is the repair: generating (no row, may still
             |  come), unsummarised (a row that says nothing — render it, stop
             |  polling), stalled (waited long enough that it is not coming).
             |  THE TRANSCRIPT WAS RE-PAGED EVERY FIVE SECONDS.
             |  readAllTranscriptRows sat in the poll body, so a two-hour
             |  meeting re-fetched every transcript row it had, a thousand at a
             |  time, every five seconds — forever, because of the bug above.
             |  The two compounded: the state that never ended was also the
             |  state that fetched most.
             |  REVIEW ROUND, five findings, all mine from this change, two
             |  worth recording:
             |  A BOUND MUST BE DERIVED FROM WHAT IT BOUNDS. I picked three
             |  minutes for "long enough that no report is coming" by
             |  intuition. The route's client is LONG_RUN_TIMEOUT_MS (120s)
             |  with maxRetries:1 — 240s worst case. My limit would have
             |  declared a working report dead and, because giving up also
             |  stops the polling, a report arriving at 250s would never have
             |  appeared. 360s now, pinned in attendance.test.ts against
             |  LONG_RUN_TIMEOUT_MS so the two cannot drift. The constant stays
             |  a literal on purpose: that module is bundled into the page, and
             |  importing the Anthropic client to read one number would ship
             |  the SDK to the browser.
             |  "THE ROWS CANNOT CHANGE" WAS FALSE EXACTLY WHEN IT MATTERED.
             |  Fixing the re-paging, I read the transcript once at mount and
             |  wrote that premise in a comment. Participants are sent to this
             |  page the instant a meeting ends, while their own keepalive
             |  flush and everybody else's backing-off retries are still in
             |  flight — so the single read could permanently miss the END of
             |  the meeting, which is the part people open the page to check.
             |  Two reads now: one on arrival, one once the report row exists,
             |  which the route writes after the transcript it was built from.
             |  A confident comment was again the tell.
             |  Also: the consent record a one-way call stores was displayed
             |  NOWHERE — the audit trail existed and the page somebody would
             |  bring the question to did not show it. And a recorded call's
             |  header showed no length, because duration came from
             |  started_at/ended_at and nobody joins a room that does not
             |  exist; the recording's own duration stands in now.
             |  Confidence: typecheck/eslint clean, build passes, Jest 6972 →
             |  6980 across 504 suites.
             |  THE GAP IS NOW CLOSED. Having written "not covered: the page has
             |  no component test" and noticed it was the SECOND report-page
             |  state bug in a day, the test exists: 14 cases over the wiring,
             |  8 of which fail against the previous commit — the unsummarised
             |  render, the copy that must follow the transcript rather than the
             |  session kind, the per-poll transcript re-read, the stall, and
             |  the consent block. The other 6 are guards on behaviour that was
             |  already right.
             |  Method note worth keeping: the first attempt to prove the tests
             |  bite used `git stash push` on files that were ALREADY COMMITTED,
             |  so it stashed nothing and every test passed — which reads
             |  exactly like "the tests do not bite". `git checkout HEAD~1 --
             |  <paths>` is the check that actually reverts. A verification step
             |  that silently does nothing is worse than none, because it
             |  produces a confident green.
             |
             |  MEETINGS VII — THE EXPORT AND THE FOLLOW-UP EMAIL
             |  BOTH EMAIL PATHS WROTE TO THE GUEST LIST AND NEVER TO THE ROOM.
             |  "Email to attendees" on the report and "Send to attendees" on
             |  the follow-up both addressed live_meetings.attendees — the list
             |  somebody types BEFORE a meeting. createMeeting writes
             |  `attendees: []` for an instant meeting and nothing ever fills it
             |  in, so the product's commonest kind of meeting answered 400
             |  "This meeting has no attendees with email addresses." and 409
             |  "Nobody on this meeting has an email address to send to." —
             |  while live_meeting_participants held a row for every person who
             |  had been in the room. The diagnostic that found it: FOLLOW WHAT
             |  A FEATURE READS, AND ASK WHETHER IT IS THE SAME THING THE
             |  FEATURE IS ABOUT. Attendance had been used as a boolean
             |  everywhere ("was this person here?") and the identities thrown
             |  away — loadReportForExport queried that table for a bool and
             |  discarded the rows — so the only place in the schema with an
             |  address on it was the invitation, and the invitation is not the
             |  meeting. Recipients are the union now, sender excluded.
             |  A DROPPED PERSON IS NOT A DELIVERED ONE. A guest who joins by
             |  link has a display name and no address anywhere here. Both
             |  routes dropped them and answered {sent, total} with total
             |  counting only the ADDRESSABLE people — so a meeting of four
             |  where two joined as guests reported "Sent to 2 attendees", a
             |  complete-sounding answer to a send that reached half the room.
             |  They come back named now, because the host is the only person
             |  who can reach them and cannot if nobody says who they are. The
             |  same went for bounces: "Sent to 1 of 9" never said WHICH eight.
             |  THE BOUND AGAIN, in the same shape as yesterday's. followup_status
             |  went to "done" when every ADDRESS succeeded — above a comment
             |  that said closing it early "would hide exactly the meetings that
             |  still need a person". It did: a meeting whose three guests were
             |  never written to at all was marked followed up. A bound must be
             |  derived from what it bounds, and what it bounds is the room.
             |  A FIX IS NOT DONE UNTIL EVERY READER OF THE DATA AGREES. #1125
             |  taught the report page that a report row with an empty summary is
             |  FINISHED. The export was not taught: hasExportableReport was
             |  still `summary.trim().length > 0`, so on a page rendering a
             |  recording and a full transcript, all five Export items answered
             |  409 "Report not ready" — permanently, withholding the very
             |  transcript they were holding. Same defect, second reader, one day
             |  later. The email keeps its own stronger gate (a message
             |  announcing a summary needs one) but now tells "not yet" apart
             |  from "never", because "try again in a minute" is the wrong advice
             |  for a report that needs regenerating.
             |  Also: the report email built a To: name out of the address
             |  ("j.smith") while the follow-up, sending the same meeting to the
             |  same people, used the real one. And the exported document, whose
             |  own comment says an export that names nobody "was a record of a
             |  conversation that did not say who had it", still named nobody for
             |  an instant meeting — and omitted a recorded call's consent
             |  acknowledgement, which is stored precisely so somebody can ask
             |  "should this have been recorded?" months later, and the export is
             |  the copy that survives longest.
             |  REVIEW ROUND, on my own diff: routing the stored jsonb through
             |  normalizeAttendees looked like tightening and was a regression —
             |  that function answers "is this REQUEST BODY acceptable?" and
             |  answers it by rejecting the WHOLE array, so one row written by an
             |  older schema would have silently cost every other invited person
             |  their copy. Validation written for a write path is not validation
             |  for a read path. Two unused exports (accountedFor, NO_RECIPIENTS)
             |  cut in the same pass: a number in a response that nothing reads
             |  is one more thing that can drift away from the truth.
             |  Method note: proving the tests bite with `git checkout HEAD --
             |  <file>` DESTROYED the uncommitted work in that file and I had to
             |  re-apply it from memory. Copy first, or check the bite before the
             |  work is worth losing.
             |  Confidence: typecheck/eslint clean, build passes, Jest 7052 →
             |  7054 across 507 suites; 10 of the new report-export cases and 6
             |  of the new loader cases fail against HEAD.
             |
             |  MEETINGS VIII — THE CONFIRMATION EMAIL AND THE CALENDAR
             |  Reported from production: scheduling a meeting sends no
             |  confirmation and puts nothing on a calendar. Asked which email
             |  and what the app SAYS when you save; the answer — "nothing
             |  either way" — was the diagnosis, because the product has a
             |  message for every other outcome.
             |  A COUNT IS NOT AN OUTCOME. sendMeetingInvites sent per recipient
             |  through Promise.allSettled, counted the successes, and discarded
             |  every failure — `{sent, total}`. The route kept `sent` and
             |  dropped `total`. The screen spoke only when `sent > 0`. So a
             |  batch Gmail refused arrived as a bare zero that was
             |  INDISTINGUISHABLE ON SCREEN from a meeting with nobody to email,
             |  and a host watched the save succeed and no invitation arrive with
             |  nothing anywhere saying why. Three layers each dropped one fact;
             |  no layer was wrong on its own.
             |  AND THE PRE-CHECK LIED IN THE OTHER DIRECTION. mailboxFor reports
             |  ok for a credential that merely EXISTS, including the deploy-wide
             |  GMAIL_ACCESS_TOKEN that its own comment says Google expires after
             |  about an hour. A stale token reports a healthy mailbox. Worse,
             |  the screen then claimed "no email was sent — no Google account
             |  is connected" off that pre-check, while the SEND falls back to
             |  the org mailbox independently — so the message was also false
             |  whenever the fallback worked. The truth was always in
             |  sendEmail's `detail`, which nobody read. It is read now.
             |  NOTHING EVER ASKED THE CALENDAR. syncMeetingExternal required the
             |  REQUEST to carry externalCalendarSyncEnabled AND
             |  externalCalendarProvider, both from a checkbox and a dropdown
             |  inside a COLLAPSED "Advanced options" section defaulting to off.
             |  The ordinary way of scheduling never attempted a push. No error,
             |  no failed sync, no row: a feature that worked and was never
             |  invoked. The connection is the better signal and the app already
             |  computed it — providerSyncAvailable, a grant PLUS a writable
             |  calendar — so the server decides now and the checkbox became an
             |  opt-OUT. A CAPABILITY NOBODY CAN FIND IS INDISTINGUISHABLE FROM
             |  ONE THAT DOES NOT EXIST, and the bug report says so.
             |  The dropdown also offered Outlook, Calendly and iCal while
             |  pushMeetingToGoogle is the only writer in the codebase — pick
             |  one of the three and you enabled a sync that wrote to Google or
             |  skipped. The provider is derived now, never chosen.
             |  REVIEW ROUND, on my own diff, three findings:
             |  I put the calendar lookup INSIDE the try that wraps the save, so
             |  a transient two-query failure would have answered 500 and lost
             |  the meeting — the exact fault the surrounding comments keep
             |  guarding against. canWriteCalendar never throws, and answers null
             |  rather than false: telling somebody to connect a calendar they
             |  already connected sends them to fix what was never broken.
             |  On the PATCH path I made "unstated" mean "follow the connection",
             |  which would have switched sync on for every meeting saved before
             |  this existed, during an edit about something else. A create
             |  default is not an update default.
             |  And the form's advanced panel auto-opens when a meeting carries
             |  "unusual configuration", which included sync being on — now the
             |  ordinary state, so it would have sprung open on every edit.
             |  Confidence: typecheck/eslint clean, build passes, Jest 7054 →
             |  7092 across 508 suites; 11 of the new invite and schedule-route
             |  cases fail against HEAD. Not fixed here: whether THIS deployment
             |  has a working Gmail credential at all — that is configuration,
             |  and /api/meetings/email-health POSTs a real test to prove it.
             |
             |  MEETINGS IX — THE MEETINGS PAGE, WHERE THREE ANSWERS DISAGREED
             |  THE SAME QUESTION WAS ASKED THREE TIMES AND ANSWERED TWO WAYS.
             |  "Is this meeting upcoming?" was written once in the page, once in
             |  /api/meetings/upcoming's SQL, and once in that route's filter —
             |  and the SQL said `scheduled_at >= now`, a START-TIME rule standing
             |  in for an END-TIME one. The page keyed off the end and included a
             |  meeting already in progress; the route excluded it; the list
             |  refetches the route on mount. So a meeting that was RUNNING
             |  rendered on first paint and vanished about a second later, taking
             |  its Join button with it, at the exact moment somebody was trying
             |  to join. TWO THINGS COMPUTE THE SAME NUMBER; DO THEY AGREE? —
             |  they did not, and the disagreement was invisible in each half.
             |  isUpcomingMeeting is now the single predicate both use, and
             |  upcomingWindowStart reaches BACK by MAX_MEETING_MINUTES rather
             |  than forward from now, because SQL cannot compare against
             |  scheduled_at + duration without a generated column. A BOUND MUST
             |  BE DERIVED FROM WHAT IT BOUNDS: the 480 that two services each
             |  spelled out locally is one exported constant, so widening the
             |  longest allowed meeting widens the window that has to contain it.
             |  AN ORDERING THAT FOUGHT ITS OWN LIMIT. One query served both
             |  lists, ordered `scheduled_at DESC NULLS LAST, created_at DESC`,
             |  limited to 50. Nulls last puts every INSTANT meeting at the END
             |  of the result and the limit cuts from the end — so an org with
             |  fifty scheduled meetings showed NONE of its instant ones, which
             |  is the product's commonest kind. The client refresh orders by
             |  created_at, finds them, and the list changed content a moment
             |  after the page settled. Two windows now, asked in parallel: what
             |  is coming up, and what happened recently.
             |  AND PAST WAS DEFINED BY SUBTRACTION. `!upcoming.some(...)` inside
             |  a filter both scanned the upcoming list once per meeting and made
             |  Past mean "whatever Upcoming rejected" — which quietly swept up
             |  drafts and ad-hoc rooms that belong in neither. isPastMeeting is
             |  asked directly, and it now answers for a room nobody ever ended:
             |  an unclosed ad-hoc meeting is past once PRESENCE_STALE_MS has
             |  gone by, the same ceiling attendance already uses for "a killed
             |  tab wrote nothing", rather than sitting in Upcoming forever.
             |  A READ WITH NO CEILING IS A READ THAT WILL BE TRUNCATED SILENTLY.
             |  Both attendance queries were unbounded, and
             |  live_meeting_participants grows by a row per meeting a person
             |  attends for the life of their account — so they were heading for
             |  PostgREST's max_rows, which cuts at a thousand and says nothing.
             |  Bounded to the newest 200, which is more than a fifty-meeting
             |  snapshot can use.
             |  DEAD PAYLOAD ON EVERY VISIT. initialMeetings and initialPast are
             |  passed to exactly ONE component — MeetingsCalendar — which is
             |  code-split behind ?view=, is not mounted on first paint, and
             |  refetches its own five hundred rows the moment it does. So every
             |  meetings load ran a forty-one-column history query and serialised
             |  the result into the HTML for a reader that would not read it.
             |  The history is read only when the URL actually asks for the
             |  calendar. FOLLOW WHAT GETS READ AND ASK WHAT IT COULD HAVE TOLD
             |  US — here the answer was nothing, to anyone.
             |  The scheduling modal was in the landing bundle for the same
             |  reason: two lists imported it statically for a dialog behind a
             |  button. next/dynamic puts it in its own 33 KiB chunk.
             |  AND THE CLOCK NEVER SLEPT. useNow ticked once a second for the
             |  life of the tab — a render of every Upcoming card and, once the
             |  calendar had been opened, of the whole month grid, including the
             |  hours a background tab shows nobody anything. Browsers throttle
             |  background timers; they do not stop them. It stops on
             |  visibilitychange and READS THE CLOCK ON THE WAY BACK, before
             |  resuming: a countdown nobody can see does not need to be right,
             |  it needs to be right the moment they look, and without that read
             |  the first thing they see on returning is the countdown they left.
             |  Method note: the first version of that test passed against HEAD,
             |  because the old unconditional interval kept ticking and the
             |  assertion only checked that the clock had moved. It had to assert
             |  the delta ACROSS the visibilitychange to bite.
             |  Confidence: typecheck/eslint clean, build passes, Jest 7092 →
             |  7115 across 508 suites; 15 of the 62 schedule cases and 2 of the
             |  8 useNow cases fail against HEAD. Not covered by tests: the page
             |  and route query shapes themselves — the two windows, the
             |  attendance ceilings and the history skip are server-component
             |  reads with no harness here, verified by reading and by build.
             |
             |  MEETINGS X — THE MEETING ROOM, AND A DURATION THAT COUNTED
             |  INSTEAD OF MEASURING
             |  THE SAME FILE HELD BOTH ANSWERS. useRecording asks how long a
             |  recording has run with `Date.now() - run.startedAt`. The meeting's
             |  own clock, four thousand lines away in the same component, did
             |  `setDuration((d) => d + 1)` on a one-second interval. One reads a
             |  clock; the other counts callbacks — and setInterval promises a
             |  callback no EARLIER than its delay, never on time. Every late fire
             |  is time the counter never gets back, and this particular main
             |  thread is already carrying WebRTC decode, an analyser sampling
             |  every 120ms, speech recognition, and a canvas composite per frame
             |  once somebody turns a background on. So the number ran slow by an
             |  unpredictable margin — and that number is posted to the report as
             |  the meeting's LENGTH. The institutional record of a call, short by
             |  an amount nobody could name. TWO THINGS COMPUTE THE SAME NUMBER;
             |  DO THEY AGREE? — one was right and the other was the one that
             |  got written down.
             |  lib/meetings/elapsed.ts keeps live SPANS and subtracts, on a
             |  monotonic clock (performance.now, because wall time can move
             |  backwards mid-call and a duration that goes down is worse than one
             |  that drifts). Spans rather than a total because a call that drops
             |  and recovers is live, then not, then live again, and only the live
             |  stretches are the meeting. A late callback now costs nothing,
             |  because the callbacks never held the answer — they only decide
             |  when to look.
             |  AND THAT TICK WAS RE-RENDERING EVERY FACE IN THE ROOM. `duration`
             |  was state in MeetingRoom, which is a 4,655-line component that
             |  renders every video tile in the call — so a second hand in the
             |  control bar reconciled the whole room, once a second, for the
             |  length of the meeting, on the thread decoding the video. Nothing
             |  else on screen had changed. The clock is its own leaf now and
             |  takes the spans as a REF, so the bar's props do not change when
             |  time passes; the per-second render is one <span>. It also sleeps
             |  while the tab is hidden — which it could not have afforded as a
             |  counter, and can now, because on return it reads the real elapsed
             |  time instead of resuming something that fell behind.
             |  The control bar's inline mm:ss had no hour case either, so a
             |  meeting past sixty minutes read "77:03" while the recording clock
             |  beside it read "1:17:03". Two clocks, one file, three spellings of
             |  the same function; there is one now, and it is tested.
             |  NOTHING IN THE FILE WAS MEMOISED — zero React.memo across 6,200
             |  lines. Every transcript line, every chat message and every change
             |  of who is talking (up to eight times a second) reconciled every
             |  tile in the grid. VideoTile is memoised now.
             |  WHICH ALMOST SHIPPED A BUG, and the code's own comment was the
             |  warning. `pc.ontrack` publishes a new peers Map even when the
             |  stream object is UNCHANGED, because a replaced track — screen
             |  share, camera switch, background on — is swapped into that same
             |  MediaStream, and the tile can only learn about it by looking
             |  again; the comment says in as many words that skipping that
             |  re-render leaves a working camera behind the "Camera off"
             |  placeholder for the rest of the call. A shallow memo skips exactly
             |  that. My first fix was a custom comparator that read the track off
             |  each side — and the test caught that it is ALWAYS EQUAL: both
             |  sides hold one object, so there is no record of what was there
             |  before. A COMPARATOR CANNOT DETECT MUTATION OF A SHARED OBJECT.
             |  The track is a prop now; React snapshots it at render time, and
             |  that snapshot is the record. It looks redundant beside `stream`
             |  and is the only thing making the memo correct, so it says so.
             |  Method note, twice over. The first bite-check reverted the track's
             |  USE inside the component and all nine tests still passed —
             |  correctly, because the prop's job is the memo gate, not the
             |  internal read. Reverting the wrong half of a change reads exactly
             |  like a test that does not bite. And of the three cases that do
             |  bite, the "replaced in place" one does not: the tile keeps
             |  rendering the OLD track's picture, which is stale but produces no
             |  placeholder text to assert on. Worth saying rather than counting
             |  it.
             |  Confidence: typecheck/eslint clean, build passes, Jest 7115 →
             |  7152 across 511 suites; 8 of the 10 clock cases and 2 of the 9
             |  tile cases fail against a naive implementation. Not addressed
             |  here: the component is still 4,655 lines with 59 useState, 106
             |  useRef and 74 useEffect in one function, and every OTHER state
             |  change still re-renders all of it — the tiles are merely no longer
             |  reconciled with it. Splitting it is the next piece of work and a
             |  much larger one.
             |
             |  MEETINGS XI — THE WAITING ROOM FLICKER, AND THE MASK
             |  A CHIP THAT VANISHED, CAME BACK, AND VANISHED AGAIN. Admit and
             |  Deny take somebody off the host's panel before the server answers,
             |  which is right — letting a guest in should cost one click and the
             |  round trip is not the host's to wait through. But it puts the
             |  screen ahead of the database, and TWO things then read the database
             |  and put it back. loadWaiting replaces the whole list from the
             |  table, and it is scheduled 400ms after ANY admission event, so it
             |  does not need to be the admit's own event to fire — a second
             |  guest's presence write will do. And a presence write ON the
             |  just-admitted row arrives as an UPDATE whose status is still
             |  `waiting`, so applyAdmissionChange re-inserts the person the host
             |  removed. In that window the host can press Admit a second time on
             |  somebody already in the room.
             |  A decision is now remembered by row id for as long as it might
             |  still be in flight, and nothing the table says can undo it. The
             |  half that is easy to leave out is the FORGETTING: the rejected-POST
             |  path re-reads precisely to put the person back, and a suppression
             |  left in place would swallow that correction — the guest would
             |  disappear from the panel and stay gone, which is worse than the
             |  flicker. Suppression is by row id and a fresh knock is a fresh row,
             |  so nobody is ever caught by it twice.
             |  Also: "Admit all" wanted the ids of everyone on the panel, and I
             |  first read them inside a setWaitingPeers updater. An updater has to
             |  be pure; React is free to run it more than once. A ref.
             |  THE MASKING LOOP RAN AT THE DISPLAY'S REFRESH RATE AND WAS CAPTURED
             |  AT 24FPS. requestAnimationFrame fires at 60Hz, or 120 on a recent
             |  laptop or phone; canvas.captureStream(OUTPUT_FPS) samples at 24. So
             |  a MediaPipe inference, a mask upscale, a putImageData and two blurs
             |  ran two to five times for every frame anybody would ever see, and
             |  the rest was thrown away. FRAME_BUDGET_MS = 45 was the tell and I
             |  read past it twice: 45ms is longer than one animation frame at any
             |  refresh rate in use, because it was always a budget against the
             |  OUTPUT rate. Three numbers describing the same cadence, one of them
             |  five times wrong. Pacing is a cheap return inside the same rAF, so
             |  the loop still stops with the tab and stays synced to compositing.
             |  THEN THE REAL ASK ARRIVED — smooth and seamless, no bleeds, no
             |  headwear cutoff — and the pacing turned out to be what paid for it.
             |  THE BLEED AND THE CUTOFF ARE ONE MECHANISM POINTED TWO WAYS. Growth
             |  reached equally in all four directions, and the old comment named
             |  the price out loud: "a faint ring of the real room travelling with
             |  the silhouette". Most of that ring bought nothing, because the
             |  thing growth exists to save is headwear and headwear is ABOVE a
             |  head. Up reaches furthest now, sideways a little (a headwrap is
             |  wider than the head in it), downward not at all — growing down
             |  drags the desk up into somebody.
             |  AND GROWTH COULD NOT TELL FABRIC FROM WALL. Both are merely "not
             |  yet covered", and the wall is the commoner neighbour. But the model
             |  already knows the difference and the confidence ramp already
             |  carries it: uncertain lands between 0 and 255, confident background
             |  lands exactly 0. So growth may now FILL uncertainty and may not
             |  INVENT coverage. Headwear fills; the wall does not.
             |  A TEST STOPPED ME TRADING A COSMETIC FAULT FOR A DIGNITY ONE. I
             |  also raised CONFIDENCE_PERSON from 0.30 to 0.45, reasoning that a
             |  pixel the model is 30% sure of should not be fully opaque. The
             |  headwear suite refused it: at 0.28 confidence — squarely where a
             |  cap or a headwrap lands — that raise took the fabric from opaque to
             |  58%, which is the room showing THROUGH the top of someone's head.
             |  A faint halo is cosmetic; a semi-transparent head covering is not,
             |  and a threshold is the wrong place to pay for tidiness. Reverted.
             |  The halo is fixed where it is caused, not by making people
             |  translucent. THE TWO MISTAKES ARE NOT THE SAME SIZE — the file said
             |  so already, and the tests held me to it when I forgot.
             |  THE SEAM WAS SOFT BECAUSE IT WAS BLURRED, WHICH IS NOT THE SAME AS
             |  ACCURATE. Alpha crossed from room to person over roughly eight
             |  pixels at 720p: right along hair, a visible ring everywhere else.
             |  Tightening the ramp before the upscale halves the band and keeps
             |  the softness, and it improves BOTH faults at once — headwear at
             |  0.28 goes fully opaque, a halo pixel the model barely saw goes to
             |  nothing. That it helps both is the reason to believe it is the
             |  mechanism rather than a trade. It writes to a separate buffer on
             |  purpose: sharpening the temporal history in place would compound
             |  each frame until the mask was binary, leaving the smoothing running
             |  with nothing left to smooth.
             |  A BOUND SHOULD MEASURE WHAT IT COSTS. The mask grid was a fixed
             |  320px WIDTH, and my first move was to raise it to 480 — which would
             |  have given a 640x480 webcam a 173k-pixel mask while a 1280x720
             |  camera got 130k. The cheap old camera paying more per frame than
             |  the good new one, which is the opposite of what a frame budget is
             |  for. It is a pixel budget now: constant cost whatever the camera,
             |  never finer than the frame, and the upscale falls from 4x to 2.7x
             |  at 720p and 6x to 4x at 1080p.
             |  Confidence: typecheck/eslint clean, build passes, Jest 7152 → 7190
             |  across 511 suites; every change bites against a reverted version —
             |  6 waiting-room cases, 5 pacing, 2 each for the directional radii,
             |  the growth ceiling and the edge. NOT VERIFIED: any of the masking
             |  by eye. These are reasoned from the model's documented behaviour
             |  and the pipeline's own numbers, and the arithmetic is tested, but
             |  nobody has looked at a face. Matching Meet or Zoom is finally
             |  limited by the segmenter — selfie_segmenter.tflite is a small
             |  single-label model — and the next real step is guided upsampling
             |  against the frame's own luma, so the boundary snaps to the picture
             |  instead of being positioned by a blur.
             |
             |  MEETINGS XII — THE PROVIDER THE DATABASE WOULD NOT ACCEPT
             |  A HOST REPORTED IT FROM PRODUCTION: "Meeting saved — invited 2
             |  guests by email; external calendar sync failed: The calendar event
             |  was written but could not be recorded: new row for relation
             |  live_meetings violates check constraint
             |  live_meetings_external_provider_check."
             |  recordSync wrote `external_calendar_provider: "google"`. The
             |  constraint allows 'google_calendar', 'outlook', 'calendly', 'ical'.
             |  Postgres rejected EVERY call — and recordSync runs on both
             |  outcomes, so the damage was two-sided: on success the event went
             |  onto the calendar and the row never learned its id or its status,
             |  and on failure the row could not even record that it had failed.
             |  The whole error trail MEETINGS VIII built was writing into a
             |  statement that never committed.
             |  THE LITERAL WAS OLDER THAN THE BUG REPORT. It sat in
             |  google-write.server.ts before MEETINGS VIII, and nothing had ever
             |  called it — that WAS the MEETINGS VIII finding, "a capability
             |  nobody can find is indistinguishable from one that does not
             |  exist". Making the path reachable is what turned a dormant wrong
             |  literal into a host's error message. Shipping a feature over
             |  untested code makes you the author of everything it does.
             |  WHY NOTHING CAUGHT IT, which is the part worth keeping. A mocked
             |  Supabase client has no constraints to violate, so no amount of
             |  unit-testing the write could see this: the assertion would have to
             |  know what the schema accepts, and it did not. Worse, the FIXTURE
             |  said `external_calendar_provider: "google"` — describing a row the
             |  database could never have produced. A test agreeing with a bug is
             |  how the bug survives a suite that looks thorough. The guard now
             |  reads the migration, parses the constraint's allowed set, and
             |  asserts the constant the writer uses is in it; a constraint
             |  narrowed later fails in Jest instead of in somebody's meeting.
             |  And the constant is SYNCABLE_PROVIDER, the one the planner already
             |  used — so there is no longer a second spelling to disagree with.
             |  TWO THINGS COMPUTE THE SAME NUMBER; DO THEY AGREE? has a sibling:
             |  two things NAME the same thing, and only one of them is talking to
             |  the database.
             |  No data migration: the constraint refused every write, so no row
             |  ever carried the bad value. The events are on the calendars,
             |  though, with rows that do not know their ids — findEventByMarker
             |  recovers those rather than duplicating them, which is the one part
             |  of this that was built for exactly this failure.
             |  Confidence: typecheck/eslint clean, build passes, Jest 7190 →
             |  7194 across 511 suites; both new behavioural cases fail against
             |  the literal that shipped.
             |
             |  MEETINGS XIII — REPAIRING THE ROWS WITHOUT EMAILING ANYBODY
             |  MEETINGS XII fixed the provider so future syncs record their event
             |  id. It did nothing for the meetings already synced, whose events sit
             |  on real calendars attached to rows that do not know they exist. The
             |  ask was to backfill them, and what I had offered was to re-push.
             |  RE-PUSHING WOULD HAVE BEEN THE HARM, NOT THE FIX. Every write in
             |  google-write.server.ts carries `sendUpdates: "all"` — Google's
             |  instruction to notify every attendee. A backlog re-pushed is an
             |  "event updated" email to every guest of every affected meeting, for
             |  a change none of them made and none of them could explain. I found
             |  this by reading the write path before writing the sweep, and it
             |  inverted the design: THE EVENT IS ALREADY CORRECT. Only the row is
             |  wrong. So the repair is a READ — findEventByMarker's private marker
             |  locates the event, and the id is the one missing fact. Nothing here
             |  touches a calendar's contents, and the test that says so is the most
             |  important assertion in the change (it catches a single injected
             |  POST). THE OBVIOUS REPAIR AND THE RIGHT ONE ARE NOT ALWAYS THE SAME
             |  SHAPE, and the difference here was whose inbox it landed in.
             |  That marker exists because an earlier change anticipated exactly
             |  this — an event written whose id was never stored. A guard built for
             |  a hypothetical turned out to be the whole recovery path.
             |  AND THE LOOKUP COULD NOT TELL "NO EVENT" FROM "NO ANSWER".
             |  findEventByMarker returns null for both, deliberately: on the write
             |  path a failed lookup must not block the write. For a sweep that
             |  REPORTS, that collapse is a lie waiting to happen — a Google outage
             |  would come back as "forty meetings have no calendar event", which is
             |  a number somebody acts on by going and making forty events by hand.
             |  lookupEventByMarker keeps them apart; findEventByMarker is now a
             |  thin flattening of it, so the write path sees exactly what it always
             |  did. A NUMBER THAT CANNOT DISTINGUISH ITS OWN FAILURE MODE IS NOT A
             |  MEASUREMENT.
             |  A sweep, not a script. Idempotent by construction — a row with its
             |  id recorded no longer matches the query — so it is safe on the hour
             |  forever, and a host who reconnects a calendar months from now gets
             |  their rows healed on the next pass instead of never. Bounded at
             |  fifty, which is also the Google rate limit, and it asks for one more
             |  than the bound purely to report whether a backlog remains.
             |  A meeting with no event at all is LEFT ALONE. Creating one is
             |  probably right eventually, and it would notify, so it is a person's
             |  decision rather than a sweep's.
             |  Checked and deliberately not changed: the recording sweep's stats are
             |  absent from the cron response but present in recordCronRun's detail,
             |  so liveness is observable and there is no defect to fix. Worth the
             |  look rather than the assumption.
             |  Confidence: typecheck/eslint clean, build passes, Jest 7194 → 7238
             |  across 514 suites; the never-writes assertion catches one injected
             |  POST, 5 cases fail if needsEventId stops excluding drafts, deleted
             |  and hostless meetings, and 5 more if the lookup re-collapses its two
             |  answers. NOT verified: that any real orphaned row exists to repair —
             |  the sweep reports what it finds and reports nothing when it finds
             |  nothing, which is the only honest thing it can do from here.
             |
             |  MEETINGS XIV — THE REPORT PAGE, AND A TEST I WAS WRONG ABOUT
             |  THE SAME DEFECT AS THE MEETING ROOM'S CLOCK, IN ANOTHER FILE.
             |  `playheadMs` is state in the report page's root and exactly ONE
             |  child reads it — the transcript. So every second of playback
             |  re-rendered the recording panel (which holds the <video>), the
             |  chat, the follow-up draft, the export menu and all the summary
             |  markup, to move one highlight. Having just fixed this shape in
             |  MeetingRoom I went looking for it here, which is the only reason
             |  it was quick to find. THE SECOND TIME A SHAPE APPEARS IT IS NOT A
             |  COINCIDENCE, IT IS A HABIT.
             |  AND INSIDE THE TRANSCRIPT IT WAS WORSE. `playing` is a single
             |  index, so `turns.map` rebuilt EVERY turn once a second so that
             |  `i === playing` could move one row's background — and a turn is
             |  not a cheap row: a speaker chip, a clock button, and a nested map
             |  over paragraphs and search-match parts. An hour of two people
             |  talking is hundreds of them, per second, on the thread decoding
             |  the video. The turn is its own memoised component now; `active`
             |  moves for exactly two rows per second.
             |  The per-row match lookup had to move INSIDE it. `matchesIn`
             |  allocates, so computing it in the parent and passing the result
             |  would hand every row a fresh array and defeat the memo silently —
             |  the same trap as `colorFor`, a closure recreated every render,
             |  which is now module scope for the same reason.
             |  I WAS WRONG ABOUT THE TESTS AND THE BITE-CHECK CAUGHT ME. I said
             |  in this session that the 20 existing transcript tests already
             |  covered the refactor's risk because they exercise the playhead,
             |  the search stepping and the seek. They do not. A memo that ignores
             |  `at` leaves the old search hit lit while the counter reads "2 of
             |  2" — and ALL TWENTY STILL PASSED, because every one of them
             |  asserts the counter, which the panel renders, and none of them
             |  asserts the highlight, which the row renders. A suite can exercise
             |  a feature thoroughly and still have no opinion about the half of
             |  it you are changing. The test that bites now asserts which <mark>
             |  is lit, and that it moves both ways.
             |  Two smaller things. `supabase.auth.getUser()` sat inside the
             |  five-second poll, so a report that took a minute to generate asked
             |  the auth server who the reader was twelve times for an answer that
             |  cannot change while the page is open; it is read once. And
             |  RecordingPlayer was imported statically although the page's own
             |  comment says most meetings are not recorded — it is a 4.5 KiB
             |  on-demand chunk now, and the thing that made that safe rather than
             |  clever is that React 19 passes refs as ordinary props, so the ref
             |  the transcript seeks through survives the split. A lazy wrapper
             |  that swallowed it would have left every timestamp clickable and
             |  inert, which is worse than the bytes.
             |  Confidence: typecheck/eslint clean, build passes, Jest 7243 →
             |  7245 across 515 suites; the new highlight test fails against a row
             |  memo that ignores `at`. Thin on tests for the size of the change —
             |  two new cases for four changes — and honestly so: the memoised
             |  panels and the read-once viewer are covered only by the 162
             |  existing report cases still passing, and the lazy player's ref
             |  path is REASONED from React 19 semantics, not exercised.
             |  NOT DONE, and it is the largest thing left: this page is entirely
             |  client-side. Seven browser round trips — auth, meeting, report,
             |  attendance, transcript, recording, chat — gated behind JS before
             |  anything renders. A report is a DOCUMENT; the meetings page beside
             |  it is a server component. Moving it would beat every render saving
             |  in this entry put together, and it is a different change.
             |
             |  MEETINGS XIV (b) — A CACHE IS ONLY HONEST IF SOMETHING
             |  INVALIDATES IT
             |  A review bot read the change above and said the cached viewer goes
             |  stale when another tab switches accounts. Its MECHANISM was wrong:
             |  it said "later polls reuse the original value", but polling stops
             |  as soon as the report exists, so in every state that renders the
             |  follow-up control the OLD code did not re-read the viewer either.
             |  Its POINT was right anyway, by a narrower path — switch accounts
             |  during the generating window and the old code caught it on the
             |  next poll while the cached version does not, and that stale id
             |  then persists into the rendered report.
             |  The thing actually wrong was the comment I had written: "an answer
             |  that cannot change while the page is open". That is false across
             |  tabs. Given a false claim in a comment and code that relies on it,
             |  make the code true rather than softening the comment. So
             |  onAuthStateChange clears the ref and re-asks — comparing the user
             |  ID, not the event, because that hook also fires on every silent
             |  token refresh and re-reading on those would put back the exact
             |  per-poll round trip this change removed.
             |  Why it is worth the code at all: viewerId decides isHost, isHost
             |  decides canSend, canSend decides whether the follow-up can be sent
             |  — so an id outliving its session hands the send to the wrong
             |  person, or takes it from the right one.
             |  Confidence: 5 new cases; 3 of them fail against the pre-fix page
             |  (the two that pass both ways are the guard against reintroducing
             |  the round trip — that is their job). Jest 7245 → 7250 across 515
             |  suites, typecheck/eslint/build clean.
             |  AND: a bot finding whose stated mechanism is wrong can still be a
             |  real defect. Verify the claim, not the explanation — dismissing it
             |  because the reasoning does not hold is how the finding underneath
             |  survives.
             |
             |  MEETINGS XV — THE REPORT IS A DOCUMENT, SO IT IS SERVER-RENDERED
             |  The entry above ends by naming the largest thing left: the report
             |  page was entirely client-side, seven browser round trips before
             |  anything appeared — the viewer, the meeting, the report, the
             |  attendance row, the timed transcript, the recordings and the chat.
             |  The last two were fired by panels MOUNTING, so they could not even
             |  start until the rest had rendered. All of it for content that was
             |  finished before anybody opened the page.
             |  Now: one server pass in two waves (report-page.server.ts), because
             |  the only real dependency is that everything except the viewer needs
             |  the meeting's id, and the meeting is found by room code. Two waves,
             |  not seven round trips.
             |  MEASURED, not asserted: the route's client JS goes 653.6 KiB -> 400.2
             |  KiB, 253 KiB less, a 39% cut. Taken from the route's own
             |  client-reference manifest on a build of main and a build of this
             |  branch, and reproduced. A performance claim nobody measured is a
             |  performance claim nobody can check.
             |  Three things stay on the client because each is genuinely
             |  INTERACTIVE rather than merely dynamic: the export dropdown, the
             |  editable follow-up, and ReportMedia — the <video> and the
             |  searchable transcript, one island because a transcript line seeks
             |  the recording and the playhead moves the highlight back. Plus
             |  ReportWaiting, which is the only live fact on the page.
             |  WHAT FELL OUT FOR FREE, and is the nicer half: the stall clock was
             |  the TAB's. It started at mount, so every reload bought another six
             |  minutes of "Generating your report...", and a report that failed a
             |  week ago still promised to arrive. Measured from the meeting's own
             |  ended_at now, so "not coming" means the same thing on every visit
             |  and on every device. The waiting island is handed the time that is
             |  LEFT, not a fresh allowance.
             |  Also gone: RecordingPanel used to fetch its recordings and then
             |  report the playable one's start time back UP through a callback,
             |  because the transcript needs it to place its cues. So timestamps
             |  were inert until a second round trip landed, and the page held
             |  state whose only purpose was carrying an answer back from a child.
             |  The server knows it before the page renders.
             |  ON DELETING TESTS: six cases went, and it is worth being precise
             |  about why. They tested viewerRef/attendedRef, a client cache that
             |  existed ONLY because the page asked the auth server on every poll.
             |  The server reads the session from the request's cookies, so there
             |  is no cache to go stale. That class of bug is gone by construction
             |  rather than by a fix — the only acceptable reason for its tests to
             |  go with it. Everything else was ported: an async server component
             |  can be awaited and its returned element rendered, so every state
             |  and every piece of copy is still asserted, and "stops polling" was
             |  ported as "mounts no poller at all".
             |  Confidence: Jest 7250 -> 7305 across 518 suites,
             |  typecheck/eslint/build clean, and the route builds as a dynamic
             |  server render.
             |  NOT DONE: nobody has looked at this page in a browser. The bundle
             |  number is measured; that it LOOKS right is reasoned from the markup
             |  being unchanged, which is not the same thing.
             |
             |  MEETINGS XV (b) — FOUR FINDINGS, AND TWO COMMENTS THAT LIED
             |  A review bot read the change above and found four things. All four
             |  were real. Two of them were cases of an ASSERTION standing in for
             |  the work:
             |  ONE. The waiting poll asked the FULL page loader every five seconds
             |  for three booleans — so every tick re-paged the whole transcript,
             |  500 chat rows, every recording and the report body, about seventy
             |  times over a six-minute wait, on a meeting whose transcript is
             |  longest exactly when the wait is longest. Worse than the client page
             |  it replaced, which read the transcript twice. And the comment above
             |  it called it "a cheap request rather than a full re-read of
             |  everything above". The comment was the only thing making it cheap.
             |  Now loadReportState: four meeting columns, the report's summary, the
             |  attendance row. The DECISION stays shared (both end at the same
             |  reportViewState call) so the poll and the render cannot disagree;
             |  the READS are what had to differ. Guarded by a negative test — it
             |  asserts the heavy tables are never touched — because the obvious
             |  test, "does it return the right state", passes for the expensive
             |  version too.
             |  TWO. The concurrency test claimed to assert ORDER and asserted
             |  membership. A sequential loader pushes the same table names in the
             |  same order, so it passed for the exact thing it was written to rule
             |  out. It recorded a `settled` array and never looked at it: the tell.
             |  Now it asserts how many reads had FINISHED when each one started —
             |  1,1,1,1,1 concurrent, 1,2,3,4,5 sequential.
             |  And the bite-check for it nearly lied too. The first injected
             |  "sequential" loader wrapped the same array literal, which evaluates
             |  eagerly — so the reads still STARTED together and only the awaiting
             |  changed. It failed in 2 positions instead of 4, which looked like
             |  success. A defect has to be injected where the mechanism actually
             |  is, not where the keyword is.
             |  THREE. Dates moved to the server, so they formatted in the SERVER's
             |  zone. A meeting at 20:00 in New York is 00:00 UTC the next day: the
             |  line under the title showed the wrong weekday. The consent timestamp
             |  was worse — it exists to answer "recorded with consent, and when",
             |  and a UTC hour with no label is a quietly wrong answer. Plus a
             |  hydration mismatch in RecordingPanel, whose toLocaleDateString and
             |  Date.now() countdown now render once on each side. Fixed with
             |  LocalTime/ExpiresIn: formatted after mount, first paint explicitly
             |  labelled UTC, which is the honest fallback rather than a
             |  local-looking time in the wrong zone.
             |  THIS IS THE ONE THAT PUNCTURES "the markup is byte-for-byte
             |  unchanged" — the sentence used to argue the page did not need
             |  looking at. For dates it was false, and that was the argument for
             |  not checking.
             |  FOUR. reportOwedForMs fell back to created_at, which for a meeting
             |  booked in advance is days before it happens — so a meeting booked
             |  last week and not yet closed was "probably not coming" the first
             |  time anybody opened it. Now ended_at, then started_at, then
             |  scheduled_at, then the row. Took half the suggestion and declined
             |  the other half with a reason: returning 0 for a meeting with no
             |  ended_at would make a room nobody closes wait forever, which is the
             |  permanent spinner the wait limit exists to prevent.
             |  Bundle after the fixes: 400.2 -> 401.1 KiB, because LocalTime is new
             |  client code. Still 252.5 KiB under main. Re-measured rather than
             |  assumed, since the fix added to the thing being counted.
             |  Confidence: Jest 7305 -> 7326 across 519 suites, typecheck/eslint/
             |  build clean. Each fix has a test that fails against the version
             |  before it.
             |
             |  2026-09-29  The meeting log searches what was said, and stops
             |  shipping prose to do it.
             |  The log and the recorded-call archive were the same table split on
             |  `kind`, answering the same question in opposite ways: the archive
             |  read transcripts in Postgres, bounded, and said when the bound bit;
             |  the log matched titles and summaries with String.includes in the
             |  browser and could not read a transcript at all. So "what did we
             |  agree with Dunbar in March" was unanswerable unless somebody had
             |  written Dunbar in a title.
             |  One engine now: session-archive.ts holds the rules (metadata match,
             |  transcript match, the bound and how to admit it) and
             |  session-archive.server.ts holds the clauses. Visibility travels as
             |  DATA rather than being inferred from the kind — a call belongs to
             |  whoever recorded it and a meeting is listed across the org, and
             |  sharing an engine must not quietly share a permission rule.
             |  The clause that bites: a regenerated report INSERTS a row, so an
             |  embed with no order on it returns an arbitrary one. In a list that
             |  is a stale summary, which somebody notices; in a SEARCH it is a
             |  stale transcript, which nobody notices — the search reads words
             |  nobody said any more and misses the ones they did.
             |  Payload: the page now ships a LINE per meeting (title, date,
             |  counts) and fetches the prose when a row opens. Modelled on a report
             |  matching the analysis schema's own description, uncompressed JSON:
             |  1,118 -> 317 bytes a row, so a 200-meeting page carries 218.4 ->
             |  61.9 KiB and one open row costs 0.9 KiB. Modelled, not measured:
             |  real reports vary and the wire is compressed.
             |  What the tests taught, and it is the third time this week: a race
             |  test that resolves a stale promise and asserts on the next line
             |  passes whether or not the stale answer is discarded, because the
             |  assertion runs before the answer has been processed at all. Both
             |  race guards here were toothless until the assertions waited. Proved
             |  by injection afterwards: dropping the search ticket fails one test,
             |  sharing one detail slot between rows fails two.
             |  Confidence: Jest 7375 -> 7417 across 524 suites, typecheck and
             |  eslint clean. Nobody has opened it in a browser.
             |
             |  2026-09-29  The calls archive joins the same engine, and stops
             |  fetching the list it was just handed.
             |  Three copies of the archive narrowing existed — the calls page, the
             |  calls route, and the log — each remembering the report-embed order
             |  separately. Two of them now call narrowArchive. The SELECTs stay
             |  local and that is the line: a call carries a consent record and a
             |  recording length a meeting has no column for, and it draws the
             |  summary and nothing else of the report, so sharing the embed would
             |  mean reading key points no row here shows.
             |  SessionVisibility's host scope gained an optional organizationId,
             |  because the calls query filters by both and the shared type only
             |  said one. Written as a second rule on top of ownership: forgetting
             |  it widens the list to the same person's other work, never to
             |  somebody else's.
             |  The waste: CallArchive's debounced search effect fired on mount with
             |  an empty query, so every visit to /meetings/calls ran the same
             |  fifty-row query twice — once in the server render that drew the
             |  list, once 250ms later to replace it with an identical one.
             |  And archiveSummary is gone: the bound used to be a second paragraph
             |  under the count, which is a caveat a reader finishes the sentence
             |  before reaching. searchSummary folds it in, in the page's own noun.
             |  What the tests taught, twice in one sitting and worth saying once
             |  more: a test that asserts "no request was made" without waiting past
             |  the debounce asserts nothing — it passes because the request has not
             |  had time to happen yet, and it passes just as happily against the
             |  version that makes it. Both such tests here were toothless until
             |  they waited; then putting the mount fetch back failed one and
             |  letting the log search an empty box failed two.
             |  Confidence: Jest 7417 -> 7426 across 525 suites, typecheck and
             |  eslint clean.
             |
             |  2026-09-29  Opened it in a browser. Found something.
             |  The standing caveat on three PRs this week has been "nobody has
             |  looked at it". So both changed lists were rendered in headless
             |  Chromium with the app's real compiled stylesheet, screenshotted at
             |  400px and 1280px, and looked at.
             |  The log held up. The recorded-call archive did not: its meta line
             |  is a flex row with no wrapping, so at phone width the items SHRANK
             |  instead of moving, and a call read as a ragged three-column block —
             |  "Sep 7, 2:47 / PM", "· consent / recorded", "· 14 / mentions".
             |  Nothing in the shared layout checks fires on that. Nothing escapes
             |  the viewport, nothing overlaps, no two controls read alike. It is
             |  simply wrong, and only a layout engine can say so.
             |  Two things learned turning it into a test. getClientRects().length
             |  does not detect a folded flex item: flex children are blockified
             |  and a block whose text wraps still reports one rect. Height against
             |  the element's own line-height does — 32px on a 16px line.
             |  And the width mattered more than the check: measured on the broken
             |  version, the items folded at 320, 360 and 375 and fit at 400. The
             |  shared VIEWPORTS start at 400, which is the WIDE end of a phone, so
             |  a check written against them would have watched this ship on every
             |  iPhone SE, every 13 mini and most Android handsets. The new checks
             |  add 360.
             |  Confidence: 19 -> 22 visual checks, and the fix is proved by
             |  removing it: three items report 32px on a 16px line at 360.
             |
             |  2026-09-29  A review bot found the one thing the tests did not.
             |  CodeRabbit on #1146: the log's count line was keyed on the last
             |  ANSWERED query and nothing on the current one, so "1 match for
             |  “dunbar”" stood over a box that already said "dunbar x" — for the
             |  debounce plus the request, about a third of a second per keystroke.
             |  Labelled Minor. It was right, and the fix is one predicate.
             |  Took half of its suggestion and declined the other half with a
             |  reason. It proposed falling back to the unfiltered list while the
             |  next answer is pending, which would flash all two hundred meetings
             |  up between two keystrokes — the reader watches their results vanish
             |  and come back on every letter. So the ROWS stay standing and the
             |  CLAIM goes: stale rows under a "Searching…" label are honest, a
             |  stale count is not. The same predicate silences "Nothing matches
             |  “dunbar x”" during a window in which nothing has looked.
             |  The general shape, and it is the third time: the bug lived in the
             |  gap between two clocks. `searching` starts when the REQUEST starts;
             |  the query stops being answered when the KEY is pressed. Everything
             |  between those two instants was the defect.
             |  Confidence: Jest 7426 -> 7429 across 525 suites. Proved both ways —
             |  restoring the old predicate fails 2, taking the literal suggestion
             |  fails the one that guards against the flash.
             |
             |  2026-09-29  Two more from the same review, past the inline comment.
             |  CodeRabbit's merge-risk line and architecture pass raised two
             |  things its inline comment did not, and both were right.
             |  (1) "Search can miss older logged meetings." The scan takes the most
             |  recent 200 ROWS and the log filter runs after, so an organisation
             |  with sixty bookings in the next fortnight had a search that read 200
             |  rows, considered 140 meetings, and then said "in the most recent 200
             |  meetings". Overstating reach in the one sentence whose entire job is
             |  to admit reach. `scanned` now counts what was CONSIDERED; `bounded`
             |  still comes from the raw count, because the bound is about the query
             |  stopping and it stopped either way. The log-membership rule moved
             |  into searchMeetingLog, because only the search can see the rows it
             |  rejected — the route filtering a second time would have filtered the
             |  hits and left the number describing something else. Drafts are now
             |  excluded in SQL: one that reaches the loop has already spent a row of
             |  the bound and a read of up to 120,000 characters, to be dropped.
             |  (2) Medium, security: any member can start a 200-transcript scan of
             |  the whole organisation, where the calls archive only ever scanned
             |  what one person recorded. Rate limited, 30 a minute, keyed on the
             |  USER rather than the IP — the caller is authenticated, an office
             |  shares an address, and a user id cannot be varied per request. The
             |  limit sits after the auth gate so a signed-out flood is refused at
             |  401 without spending anybody's budget.
             |  Worth noting what found these: not the inline comment, which was a
             |  UI nit, but the two summary paragraphs underneath it that are easy
             |  to scroll past.
             |  Confidence: Jest 7429 -> 7435 across 525 suites. Each proved by
             |  injection — removing the limit fails 1, counting raw rows again
             |  fails 2, dropping the membership skip fails 3.
             |
             |  2026-09-29  The copilot sidebar was rebuilt several times a
             |  second, for the length of every call.
             |  The voice meter samples every 120ms and `speaking` turns over
             |  whenever a voice crosses the 900ms hold — which is every pause in
             |  ordinary conversation. Each of those re-rendered the whole panel:
             |  every chat turn, every message, re-running the regex that finds
             |  links in text to produce nodes identical to the ones on screen.
             |  Measured before touching anything, which is the only reason the
             |  number means something: a fifty-message chat ran chatParts fifty
             |  times per speaking change. After: zero.
             |  Two memos and a stable handler, the same shape as the transcript
             |  panel in #1140: a module-scope ChatTurnRow, ChatText memoized, and
             |  useStableHandlers so the rows are not handed a new onRetry every
             |  render — which would have made the memo a comment.
             |  What the injections taught. Removing EITHER memo alone changed
             |  nothing measurable: each is independently sufficient for the
             |  chatParts count, so a test watching only chatParts guards the pair
             |  and neither. Counting chatClock, which runs once per TURN, is what
             |  pins the row memo on its own. A test that cannot fail for one of
             |  two redundant reasons is testing neither of them.
             |  And the fixture lied once: it built `new Set()` for raisedHands on
             |  every render, so the ordering memo looked broken when it was the
             |  test changing the input. React state keeps its identity; a fixture
             |  standing in for state has to as well.
             |  Also memoized participantList in the room — not for the cost of
             |  building it, which is nothing, but for its identity: a fresh array
             |  each render makes every memo downstream a comment. It had to be
             |  hoisted above the early returns, because the active-meeting section
             |  of that component is past a `return` and hooks cannot live there.
             |  Confidence: Jest 7435 -> 7447 across 526 suites, typecheck and
             |  eslint clean. Four injections, each failing the test that names it.
             |  Not covered: whether the ROOM hands the panel a stable array, which
             |  is a property of a component no test can render — reaching it means
             |  opening a camera, an ICE negotiation and a Realtime channel.
             |
             |  2026-09-29  The recording player appended an hour of video and
             |  never gave any of it back.
             |  A meeting recording is a live WebM written in five-second parts,
             |  and the player feeds those parts to MediaSource so the thing can
             |  be seeked at all. It appended every part it passed and called
             |  `SourceBuffer.remove` nowhere: measured by driving the real
             |  component through a 60-minute recording with a fake MediaSource,
             |  120 appends, 676.8MB appended, 0 removes, all 720 parts still
             |  resident at the end. The repo's own constants agree — ~1.5 Mbps
             |  video plus 128 kbps audio is the ~675MB/hour that
             |  recording-policy.ts already states — which is how the harness was
             |  checked rather than trusted. Now 6.6MB resident: the 30s
             |  keep-behind window plus the part being watched.
             |  Whether the old behaviour STALLED depended on the browser's own
             |  eviction, which is exactly the thing not to leave to chance:
             |  MediaSource throws QuotaExceededError when it cannot free enough
             |  itself, and the append path treats a throw as a hole in the video.
             |  The rule is `evictionFor` in recording-timeline.ts, and it returns
             |  two things on purpose: a removal boundary that is always a part
             |  boundary, and the part indices to forget. Whole parts because a
             |  removal landing mid-part leaves a cluster with no beginning, which
             |  is the same reason a byte offset into a WebM is not a place to
             |  start. The indices because the player marks a part as appended so
             |  two refills cannot fetch it twice — evicting without clearing
             |  those marks is WORSE than not evicting: a seek back past the kept
             |  window finds everything it needs "already appended", appends
             |  nothing, and plays nothing. Eviction and the appended set have to
             |  move together, so the rule hands them over together.
             |  Eviction runs before a refill rather than on a timer. The moment
             |  the buffer needs more is the moment it is worth releasing what
             |  nobody will watch again, and tying the two means a paused player
             |  queues neither.
             |  RecordingPlayer had no test at all before this — the largest
             |  client component on the report. It has one now, with a fake
             |  MediaSource, because the rules were already testable and the
             |  WIRING was what nothing checked. A correct eviction rule that
             |  nothing invokes bounds nothing.
             |  Confidence: Jest 7447 -> 7462 across 527 suites, typecheck and
             |  eslint clean. Six injections. The one that matters: evicting but
             |  keeping the appended marks fails exactly one test, the one written
             |  for it. Not done, and named rather than shipped: throttling the
             |  player's own clock to the second the way ReportMedia already
             |  throttles the transcript. It would save three renders in four, and
             |  it would also make the scrubber thumb move in 1s steps — 3% jumps
             |  on a short recording. A saving that coarsens the UI is not an
             |  optimisation.
             |
             |  2026-09-29  Typing one letter in the meeting log re-rendered
             |  every row and re-formatted every date.
             |  Measured before touching it, against the two hundred rows a full
             |  log renders: 200 `toLocaleDateString` calls per keystroke, 400 on
             |  mount. Now 0 and 0. The magnitude came from a separate bench,
             |  because a count alone does not say whether it matters: those 200
             |  calls cost 11.24ms against 0.25ms for the same 200 through one
             |  reused `Intl.DateTimeFormat` — most of a 16.7ms frame, spent
             |  formatting dates that had not changed, on every character typed.
             |  `date.toLocaleDateString(locale, options)` looks free and is not.
             |  Two formatters now live at module scope behind `logDateLabel` and
             |  the month grouping. The month divider was the worse of the two:
             |  200 calls to produce about twelve distinct answers, because the
             |  label has to be computed per entry to know whether the month
             |  changed.
             |  `LogRow` is memoized, and `onToggle` takes the row rather than
             |  closing over it — which is what lets the page pass its `toggle`
             |  straight through instead of building a fresh closure per row per
             |  render. `toggle` is already stable across a keystroke, because
             |  what it depends on (which row is open, which details have landed)
             |  is not what typing changes.
             |  THE MEASUREMENT LESSON FROM #1151, APPLIED AND IT PAID: caching
             |  the formatter takes the `toLocaleDateString` count to zero whether
             |  or not the rows are memoized. A test watching only that number
             |  would have passed on either change alone and guarded neither. So
             |  the row memo is pinned by counting RENDERS instead (through
             |  `logDateLabel`, which each row calls exactly once), and the
             |  formatters by asserting the per-call API is never reached. Two
             |  counters, two independent guards. Five injections, each failing
             |  exactly one test: memo removed and unstable handler fail only the
             |  render test; either formatter reverted fails only the caching one.
             |  Asserted as "the per-call API is not reached" rather than by
             |  timing: a timing threshold in CI is a flake waiting to happen.
             |  One of my own mistakes, same class as the one #1154 fixed: the
             |  first edit inserted the new formatters BETWEEN `logEntrySubtitle`'s
             |  doc comment and `logEntrySubtitle`. Caught by reading the file
             |  afterwards rather than by any test — a doc comment attached to the
             |  wrong declaration is invisible to tooling. Twice in two changes is
             |  a pattern, not an accident: inserting above a function means
             |  landing inside the comment belonging to it.
             |  Confidence: Jest 7462 -> 7471 across 527 suites, typecheck and
             |  eslint clean, the log's 9 visual checks green.
             |  Scope: the log's LOAD-time half was done in #1146 (a line per
             |  meeting, server-side search). This is the render-time half, which
             |  that change made visible by leaving the page with 200 cheap rows
             |  and a search box that re-renders all of them.
             |
             |  2026-09-29  The calls archive had the meeting log's defect, and
             |  worse: two Intl formats per row, not one.
             |  Measured before touching it, over the fifty rows the page shows
             |  at rest: 50 `toLocaleTimeString` + 50 `toLocaleDateString` per
             |  keystroke, and all 50 rows re-rendering. Now 0, 0 and 0.
             |  `callWhen` formats a TIME always and a DATE unless the call was
             |  today, so it is two per row where the log's was one. Benched
             |  against reused formatters — and the bench asserts both
             |  implementations return the same string for every fixture, so what
             |  was timed is not a behaviour change: 5.29ms -> 0.15ms at fifty
             |  rows, 35x. A search can fill the page to SEARCH_SCAN = 200, where
             |  the same arithmetic is 21.2ms: past a whole 16.7ms frame to
             |  redraw dates nobody changed.
             |  Three formatters, not one, because the options differ — a time, a
             |  date inside this year, and a date that needs its year spelled out.
             |  `CallRow` is memoized and takes `confirming`/`deleting` as
             |  BOOLEANS rather than the parent's selected id, so pressing delete
             |  on one row re-renders that row instead of all fifty. `remove`
             |  became a `useCallback` with an honest empty dep list: everything
             |  it closes over is a setState or a ref, so no ref-backed wrapper
             |  was needed.
             |  The two-counter discipline, third time and now routine: row
             |  RENDERS through `callClock` (pure arithmetic, so caching a
             |  formatter cannot move it), formatter usage through the `toLocale*`
             |  calls. Six injections, and the separation holds — memo removed and
             |  unstable handler fail only the render tests; either formatter
             |  reverted fails only the caching one; a parent-wide prop on every
             |  row fails only the per-row delete test; dropping the year
             |  distinction fails the correctness tests, one of which already
             |  existed.
             |  Got the doc-comment insertion right this time by anchoring the
             |  edit on `callWhen`'s OWN comment opening rather than on its
             |  `export function` line. That is the fix for the mistake made twice
             |  in #1154 and #1157: anchoring on the declaration puts the new
             |  block inside the comment that belongs to it.
             |  Confidence: Jest 7471 -> 7482 across 528 suites, typecheck and
             |  eslint clean, the archive's 5 visual checks green.
             |  Scope: this page's load-time half was done in #1146 — it used to
             |  re-fetch on mount the same fifty rows the server had just
             |  rendered. This is the render-time half. Three sibling list pages
             |  now share the shape: cached formatters in lib, a memoized row, and
             |  two counters that cannot cover for each other.
             |
             |  #1164 - Recorder page: one call, one name.
             |  Went looking for render cost and found a correctness defect
             |  instead. The recorder asked `defaultCallTitle()` twice: once for
             |  the placeholder and again, from the clock, when the call ended.
             |  But `/api/meetings/one-way` already resolves the title at START,
             |  stores it on the row and RETURNS it - and this screen threw that
             |  away. So an untitled hour-long call sat in the archive under the
             |  minute it began and in the report under the minute it finished:
             |  one call, two names. The route's title is now kept on `meeting`
             |  and used for the report, with the same rule as the fallback,
             |  evaluated at the start rather than the end.
             |  The suggested title is read ONCE, on mount, into `useState`. It
             |  used to be `defaultCallTitle()` in the placeholder, recomputed
             |  every render - so the suggestion moved while the person typed
             |  beside it, and each keystroke built two Intl formatters. Those
             |  are module-scope now: 0.124ms -> 0.0023ms per title, 54.8x,
             |  which the API route gets as well.
             |  Measure first, and this time measuring said DON'T. The interim
             |  words cost 0.07ms of React and 0.7ms of layout at 2,000 lines,
             |  and an elapsed tick runs zero row bodies in 0.021ms - #1152's
             |  memo already covers both. I nearly "fixed" `tickElapsed` on the
             |  strength of the hook's own doc comment; the profiler said there
             |  was nothing there. What WAS left: one settled sentence arriving
             |  re-ran 2,066 row bodies at 2,000 lines, because `FinishedLines`
             |  is memoized on the ARRAY and a new sentence is a new array. A
             |  memoized `TranscriptLine` taking the text takes that to 1.
             |  Chunking the list into sealed 64-row blocks measured WORSE (13.6
             |  vs 8.1ms) - 31 `slice()` calls per render cost more than the
             |  renders they saved - which is the second time this pass that the
             |  obvious structural fix was the wrong one.
             |  Two counters again, and the honest part: the transcript one has
             |  no CI guard. A keyed row with unchanged props writes nothing to
             |  the DOM either way, so every assertion available from outside the
             |  module passes on the unfixed code - verified by injection, not
             |  assumed. The test file says so in its header and the render count
             |  lives in the PR, measured with a Profiler. The counters that DO
             |  bite: the `toLocale*` call count in lib (1 failure when the
             |  formatters are reverted) and the two clock tests (2 failures when
             |  the title is recomputed at End, 1 when the placeholder is).
             |  Gave CallRecorder its first tests - 680 lines and none, like
             |  RecordingPlayer before #1154 - with a drivable fake
             |  SpeechRecognition, since jsdom has none and without one the
             |  screen takes its "cannot transcribe" path and shows no
             |  transcript at all.
             |  Confidence: Jest 7500 across 529 suites, typecheck and eslint
             |  clean. The reflow measurement needed real Chromium via
             |  test-utils/visual.ts - jsdom reports every rect as zero, so it
             |  cannot see layout cost at all, which is exactly why that harness
             |  exists.
             |
             |  #1165 - Meetings landing: the clock stops re-drawing the list.
             |  Two fixes, and the first measurement of each was the misleading
             |  one - twice in one pass.
             |  PastMeetingsList formatted a date AND a time per row with
             |  `toLocale*`, each constructing an Intl.DateTimeFormat for one
             |  value and discarding it. 0.4967ms the pair against 0.0037ms
             |  reused - 134x, the largest ratio this pass - so fifty finished
             |  meetings spent 24.83ms of a render building formatters and
             |  0.19ms using them. Now `pastMeetingDate`/`pastMeetingTime` in
             |  schedule.ts, beside the offset-formatter cache that exists for
             |  the same reason. Pure so the YEAR is testable: this list reaches
             |  back indefinitely and "Sep 23" across two years names two days,
             |  which is the one way it differs from the upcoming list.
             |  UpcomingMeetingsList had no memo at all and `useNow` re-renders
             |  it every fifteen seconds to keep countdowns right. Measured over
             |  ten minutes of ticks against the REAL meetingTimeState and
             |  deriveMeetingStatus: 93% of those row re-renders changed nothing
             |  on screen - "in 22 days" either side of a tick.
             |  The trap: benched with a one-line <li> row the saving was 2.16ms
             |  -> 0.24ms per tick, and I nearly wrote it off as not worth
             |  refactoring an untested 900-line component for. The real row is
             |  ~30 JSX tags. Re-benched at realistic weight: 13.97ms -> 0.52ms
             |  at twenty meetings, 64.58ms -> 2.83ms at sixty. 64ms every
             |  fifteen seconds is a stutter somebody can see. The toy fixture
             |  did not just understate it, it inverted the decision.
             |  What made the fix small: only ONE row is ever open, so the
             |  expanded panel costs one render rather than N. Extracting just
             |  the COLLAPSED row - eight primitives and a stable toggle - takes
             |  nearly all the per-tick cost for a fraction of the risk of
             |  moving 190 lines that close over nine handlers. Derivation stays
             |  in the parent, where it is cheap arithmetic over the new clock.
             |  Gave the file its first tests - 900 lines, none, including a
             |  delete confirmation that emails guests. They are characterisation
             |  tests and were run against the PRE-refactor component first: all
             |  12 green there too, which is what says the extraction changed no
             |  behaviour rather than me asserting it.
             |  And the honest gap, third time now: removing the memo leaves all
             |  12 green, as does making the toggle unstable. A memoised row with
             |  unchanged props writes nothing to the DOM either way, so no
             |  assertion available from outside the module can see it. Verified
             |  by injection, stated in the test header, measured with a Profiler
             |  instead. The counter that DOES bite is the formatter one in lib:
             |  one failure on the pre-fix code, nothing else.
             |  Confidence: Jest 7518 across 531 suites, typecheck and eslint
             |  clean.
             |  Scope: this page's load-time half was already done - #65 split
             |  the scheduling form out of the bundle, #66 stopped the clock in a
             |  hidden tab, #63 fixed the window that hid instant meetings, #96
             |  stopped 200 meetings of prose travelling with it. This is the
             |  render-time half, and the fifth page in the pass to get a cached
             |  formatter in lib plus a memoised row.
             |
             |  #1169 - Calendar overlay: the clock stops rebuilding 42 cells.
             |  Same shape as the two pages before it, one page deeper, and the
             |  measurement was wrong twice before it was right.
             |  Three formatters first: the month grid called `toLocale*` for a
             |  weekday, a month and a date-and-time on every render. 75x for
             |  the weekday label, 29x for the calendar date-and-time - each
             |  call built an Intl.DateTimeFormat for one string and threw it
             |  away. Now `weekdayLabel`/`monthLabel`/`calendarWhenLabel` in
             |  schedule.ts, beside the rules the landing page already uses.
             |  Then the grid itself. Over ten minutes of the fifteen-second
             |  clock, NOT ONE of the 40 ticks changed a single cell's label or
             |  text - and all 40 rebuilt all 42 cells. Nothing a cell draws
             |  comes from that clock: `today` is coarsened to the day and the
             |  buckets key on the data.
             |  Fixed in three parts. `weeks` memoised on the anchor, because
             |  `monthMatrix` minted 42 fresh Dates a render and no memo below
             |  could see through 42 new identities. A `buckets` map worked out
             |  once per data change: `eventsForDay` and the external lookups
             |  already cache by list identity but `blocksForDay` does not, and
             |  rescanning every block for each of 42 cells cost 0.61ms a render
             |  at thirty meetings and five blocks, 1.85ms at eighty and twenty,
             |  of which blocksForDay alone is 0.36ms. And the cell lifted out to
             |  a module-scope memo taking the answers rather than the questions.
             |  Result, Profiler actualDuration on the grid alone: 10.2ms a tick
             |  -> 4.3ms at thirty meetings, 18.4ms -> 6.9ms at eighty.
             |  Two wrong measurements on the way, both worth keeping.
             |  First, the Profiler wrapped the WHOLE overlay - sidebar, rails,
             |  both lists - and the grid is a small part of it, so the before
             |  and after differed by less than the run-to-run noise (290-474ms
             |  either way) and in two of six runs the refactor looked SLOWER.
             |  Instrumenting the grid alone is what made the signal visible.
             |  Second, and worse: the test stub for `useLivePresence` returned a
             |  fresh `{ presence: {} }` per call. The cell takes `presence`
             |  whole and deliberately - a room that just filled should redraw -
             |  so that one object invalidated all 42 cells on every tick, and
             |  the measured saving came out at 11% instead of 58%. A stub may be
             |  simpler than the thing it stands in for; it must not be less
             |  stable, or every number taken through it is wrong. The real hook
             |  holds it in useState, and that is now a test in hooks.test.tsx
             |  that fails when presence is rebuilt per call - the one part of
             |  this render-count story CI can hold, so it is held rather than
             |  left to a comment.
             |  Corrected in this pass: the first version of the overlay's test
             |  header claimed "30 of 40 ticks changed nothing", a figure carried
             |  over rather than measured here. Measured, it is 0 of 40 - a
             |  stronger claim, and the reason to measure rather than reuse.
             |  Gave the overlay its first tests - 2,400 lines, none - run
             |  against the PRE-refactor component first: all 8 green there too,
             |  which is what says the extraction changed no behaviour. The
             |  earlier attempt at them saw an empty grid and I wrongly told the
             |  user the chips were gated on calendar layers. They are not:
             |  `visibleEvents`/`layerIndex` only filter connected-calendar
             |  events. The overlay refetches `live_meetings` on mount and
             |  replaces `initialMeetings`, so a stub resolving empty WIPED the
             |  fixture. Verified at lib level before touching the component.
             |  And the honest gap, fourth time: removing the memo leaves all 8
             |  green, as does un-memoising `weeks` or the buckets. A memoised
             |  cell with unchanged props writes nothing to the DOM either way.
             |  Verified by injection, disclosed in the test header, measured
             |  with a Profiler. What the tests DO hold is the other half: that
             |  ten minutes of ticks redraw an identical grid, so the render the
             |  cells now skip was one that changed nothing.
             |  Confidence: Jest 7590 across 537 suites, typecheck and eslint
             |  clean.
             |  Not done, deliberately: `minutesToStart` is never read anywhere
             |  in the overlay, so the clock could in principle be coarsened
             |  further - but `phase` and `label` flip on minute boundaries, and
             |  a naive coarsening moves when "Starts now" appears. Left alone.
             |  Chunking the grid measured WORSE on the landing page (13.60 vs
             |  8.11ms, 31 slice() calls a render) and was not retried here.
             |
             |  2026-09-30  The meeting room's live half can be tested after all,
             |  and measuring it says the render path is already in good shape.
             |  Four MeetingRoom test files say some version of "reaching the live
             |  call means a camera, an ICE negotiation and a Realtime channel, and
             |  a test that mocked all of that would be testing its own mocks", and
             |  render CallParts directly instead. The first half is true; the
             |  conclusion did not follow. Everything the room reaches for on the
             |  way in is a browser API, and about eighty lines of stubs -
             |  getUserMedia, a peer connection, MediaStream, an AudioContext, the
             |  Realtime channel - opens the door. What a stub cannot fake is which
             |  state the room derives from a signal and which component it hands
             |  the answer to: the fake supplies the input and the real code does
             |  all the deciding. So the objection rules out asserting that
             |  negotiation works, and rules in asserting the wiring - which is
             |  where this file's shipped bugs have always been.
             |  MeetingRoom.live.test.tsx is that: 8 tests over the tile grid, the
             |  mic announcement, the speaker attribution, the sidebar's list and
             |  the clock. All five injections fail the test that names them -
             |  ringing every tile instead of the speaker's fails 1, ignoring a mic
             |  announcement 1, dropping an arriving peer 4, freezing the clock 1.
             |  What the measurement found, all of it through that harness with a
             |  Profiler. A conversation re-runs the room's 4,858-line body about
             |  three times a second (31 times per ten seconds, as `speaking` turns
             |  over), at 2.3ms a run with eight people and 3.8ms with twenty-six.
             |  Ten seconds of SILENCE re-runs it ONCE - which is #70's clock fix
             |  verified rather than assumed: the other ten commits in that window
             |  are MeetingClock's own leaf at 0.2ms each.
             |  #71's tile memo is load-bearing and now has a number: removing it
             |  takes a conversation from 1.97ms to 2.58ms a commit at eight people
             |  and from 2.76ms to 4.06ms at twenty-six, a 24-32% saving.
             |  And the fixture lied first, the same way the landing page's did.
             |  One shared loudness dial for every analyser made every tile's
             |  `speaking` flip on the same tick, so no memo ever got to bail out,
             |  and measured through it the tile memo looked useless - very
             |  slightly WORSE than none. A fixture in which nobody takes turns
             |  cannot see the cost of everyone re-rendering at once. Giving each
             |  analyser its own level, one speaker at a time, is what turned 12
             |  commits per ten seconds into 38 and the memo from noise into a
             |  third of the render. Second time in three passes that an
             |  unrealistic fixture inverted a conclusion.
             |  Also corrected a measurement of my own: a Profiler wrapping the
             |  room counts commits anywhere in its subtree, so the clock's leaf
             |  read looked like a room render until the body was counted directly.
             |  What is NOT worth doing, measured rather than assumed. The room's
             |  five unmemoised per-render derivations - activeReactions, raisedBy,
             |  handsUpLabel and two lookups - cost 7.4 MICROseconds together at
             |  twenty-six people, 0.27% of a 2.76ms render, even though each
             |  rebuilds an N-entry Map to answer "nobody is reacting". Memoising
             |  them would be padding. VoiceActivityLog already bounds itself with
             |  batched pruning. allPeers, participantList, livePeers, sharerId and
             |  recordingRoom are already memoised for identity; ControlBar is
             |  memoised with stabilised handlers; the sidebar's rows are memoised.
             |  The one real waste left, and it is not fixable with a memo: the
             |  sidebar takes `speaking` whole, re-renders its 290-line body three
             |  times a second, and on the default CHAT tab renders nothing that
             |  reads it - the People list that does is behind `tab === "people"`.
             |  A memo cannot help because `speaking` genuinely changes; the fix is
             |  to stop it being room state at all, the way #70 moved the clock to
             |  a ref a leaf reads. Left for a decision, with the numbers, rather
             |  than started: it is the app's most critical component and the win
             |  is around 1% of the main thread in jsdom, which has no layout and
             |  so measures a floor rather than a ceiling.
             |  Confidence: Jest 7619 across 538 suites, typecheck and eslint
             |  clean.
             |
             |  2026-09-30  And then the decision came back: take `speaking` out
             |  of the room's state. Done, and it is the cleanest result of the
             |  whole pass.
             |  The entry above left this open. It is now the same move #70 made
             |  for the second hand, for the same reason and three times as often:
             |  `speaking` is read ONLY by leaves - the ring on a tile, the dot on
             |  a sidebar row - and one person talking changes the answer for one
             |  of them. As room state it re-ran all 4,858 lines for every
             |  utterance boundary.
             |  Now a store in room-shared.tsx: publish a set, and only the ids
             |  whose membership actually MOVED are notified. VideoTile takes
             |  `watchId` and PersonRow reads its own id, both through
             |  useSpeaking(id, fallback) over useSyncExternalStore. The fallback
             |  is why nothing else broke: pass a boolean and you get a boolean,
             |  which is exactly how MeetingRoom.tile.test.tsx and
             |  CallParts.sidebar.test.tsx already render those two on their own.
             |  One interface, neither path a special case.
             |  Measured with the SAME probe on both arms, ten seconds of
             |  conversation with the floor passing every 600ms:
             |    8 people  - room body 31 -> 16 runs, subtree 71.5-77.0ms -> 33.4-36.4ms
             |    26 people - room body 32 -> 16 runs, subtree 105.7-112.4ms -> 41.4-48.1ms
             |    silence   - room body 1-2 -> 0 runs
             |  and the one that tells the story best: ONE person holding the floor
             |  for ten seconds re-renders the room ZERO times at twenty-six
             |  people, where it used to be thirty-one.
             |  The 16 that remain are not waste and were checked rather than
             |  assumed: there are exactly 8 real activeSpeakerId switches in that
             |  window, two renders each. `activeSpeakerId` feeds stageFocus, which
             |  changes the layout, so it stays state. The doubling per switch was
             |  not chased.
             |  What is different about this one, and it is worth saying because
             |  four PRs in a row have had to admit the opposite: THE EFFICIENCY
             |  CLAIM HAS A REAL GUARD. A memoised component that skips a render
             |  writes nothing to the DOM, so no assertion can see it. But "only
             |  the ids whose answer moved are notified" is plain logic about
             |  listeners, and counting calls on it is exact. Making publish wake
             |  every listener instead of the changed ones fails 3 tests. Five
             |  injections, each failing the test that names it: wake everyone 3,
             |  wake nobody 7, ignore the store 4, forget the provider in the room
             |  2, leak an unsubscribed listener 1.
             |  Confidence: Jest 7629 across 539 suites, typecheck and eslint
             |  clean. Still jsdom, which has no layout, so every figure above is a
             |  floor rather than a ceiling.
             |
             |  2026-09-30  useSpeaking kept a contract it documented but did not
             |  honour. CodeRabbit found it; the missing assertion is why I did not.
             |  `useSpeaking(id, fallback)` read `source.get(id)` whenever a store
             |  was provided, so an id of "" asked the store about a participant
             |  who cannot exist and got `false` forever. VideoTile's own
             |  documentation promised the opposite: a tile with no `watchId` falls
             |  back to its `speaking` prop. Inside the room, where a store always
             |  exists, it did not - the prop was silently overruled.
             |  Not a live bug: all six VideoTile call sites in the room pass a
             |  `watchId`, which is exactly why it survived review and a full suite.
             |  The next caller to leave it off would have got a tile that never
             |  rings, with nothing failing to say so.
             |  Fixed at the root rather than where it was reported. CodeRabbit
             |  proposed patching VideoTile (`watchId === undefined ? speaking :
             |  live`), which works and leaves the same trap for PersonRow and
             |  every future subscriber. One line in the hook instead: no store, OR
             |  nobody named, means the caller's own answer stands.
             |  Two guards, and the pair is not redundant - which was checked, not
             |  assumed. Reverting the exact shipped defect fails 2 (the hook test
             |  and the tile test). Making VideoTile pass a non-empty sentinel
             |  instead of "" fails only 1, the TILE test, so that one is catching
             |  something the hook test cannot see. And over-correcting so the
             |  fallback always wins fails 3, so the fix cannot be wrong in the
             |  other direction either.
             |  The lesson worth keeping: the test file had "falls back to the prop
             |  when nobody provides a store" and stopped there. The second half of
             |  that sentence - and when nobody is named, store or not - was the
             |  whole contract, and an assertion that covers half a rule reads as
             |  though it covers the rule.
             |  Confidence: Jest 7651 across 539 suites, typecheck and eslint
             |  clean.
             |
             |  2026-09-30  Transcript search: a keystroke re-rendered every turn
             |  in the transcript, most of which had nothing to highlight.
             |  The report page is the most worked-over page here - #87-#92 made
             |  it a server component with one load, #83-#85 dealt with the
             |  transcript and playhead, #45 stopped the five-second re-reads -
             |  and almost all of it holds up. The panel is collapsed by default,
             |  so a long transcript costs nothing until somebody opens it; four
             |  panels and the transcript turn are memoised; the turn's own doc
             |  explains why its match lookup is inside rather than hoisted.
             |  What was left was the search box. Every turn was handed the WHOLE
             |  match table, and that table is a new Map on every keystroke, so
             |  every memo missed and all N turns re-ran `partsFor` to produce
             |  the identical text they already showed. The find itself was never
             |  the problem: sweeping 1500 turns costs 5-9ms, and the render cost
             |  110-142ms.
             |  The giveaway was the SHAPE of the before numbers: flat in the
             |  number of matches. 1500 turns cost ~125ms a keystroke whether 5
             |  turns matched or 100, because the count that mattered was the
             |  count of turns, not of hits.
             |  Now `groupMatchesByTurn` buckets by turn first and the panel hands
             |  each row `byTurn.get(i)` - its own matches, or `undefined`. And
             |  `undefined` this keystroke is the same `undefined` as last
             |  keystroke, so the hundreds of rows with nothing to highlight hold
             |  still. One keystroke on 1500 turns: 110-142ms -> 14-25ms, and it
             |  stops depending on transcript length at all.
             |  THIRD fixture that lied, and this time twice in one sitting. The
             |  first cycled six sentences, so any query matched a third of all
             |  turns - and a third of turns genuinely matching means a third
             |  genuinely must re-render, which caps the possible gain at ~3x and
             |  made the fix look weak. The second tried a 100-word vocabulary and
             |  a hand-rolled PRNG, which was not uniform enough: still 41%
             |  matching. What worked was giving up on emergent match rates and
             |  PLANTING the needle in exactly K turns, so the variable that
             |  decides the cost is the one being set. A measurement whose
             |  dominant variable is accidental is not a measurement.
             |  Also made splitParagraph an independent oracle. It called
             |  groupMatches, and the test named "agrees with splitParagraph" was
             |  therefore checking the grouping against itself. It is a plain
             |  filter now. Nothing fails when that change is reverted - it is
             |  test architecture, not a guarded property, and worth saying so.
             |  The efficiency claim IS guarded, though, for the same reason as
             |  the speaking store: "a turn with no matches is absent from the
             |  map" is a fact about a pure function, not a render count. Keeping
             |  every turn in the map fails 1 test. Filing a speaker match under a
             |  paragraph fails 4; handing every row the same bucket fails 3.
             |  Not done: no debounce and no virtualisation. At 14-25ms a keystroke
             |  both would be complexity bought for nothing, and a debounced
             |  search box is its own kind of laggy.
             |  Confidence: Jest 7656 across 539 suites, typecheck and eslint
             |  clean.
             |
             |  2026-09-30  The log's row memo held for typing and was defeated
             |  for opening, and the test that should have caught it had one row.
             |  #105 memoised LogRow so a keystroke stops re-rendering 200 rows,
             |  and it works: measured at 200 meetings, a keystroke is 8.5ms and
             |  the rows hold still. #104's cached formatter is real too, with a
             |  counting test that fails if it is reverted.
             |  But `toggle` listed `openId` and `details` among its dependencies,
             |  so it was a NEW FUNCTION whenever either moved - and it is handed
             |  to every row. Opening one row re-rendered all 200, and the detail
             |  arriving a moment later re-rendered all 200 again. 95ms to open a
             |  row against 8.5ms for a keystroke: the same page doing eleven times
             |  the work for a smaller change.
             |  Fixed by reading both through refs, the pattern MeetingRoom already
             |  uses everywhere. Opening a row: 95ms -> 15.5ms at 200 meetings,
             |  25ms -> 13ms at 50. The shape is the tell, as usual: before, the
             |  cost climbed steeply with row count (25 -> 95 from fifty rows to
             |  two hundred); after, it barely moves (13 -> 15.5), because it is
             |  the two rows that changed plus the parent's own body.
             |  The test story is the interesting half. A render counter already
             |  existed - `countRowRenders`, spying on logDateLabel, one call per
             |  row render - and the typing path was genuinely guarded at ZERO
             |  re-renders. The open path had "still re-renders the row that was
             |  opened", which used a log of ONE ROW. With one row, "every row
             |  re-rendered" and "only the opened row re-rendered" are the same
             |  observation, so it passed identically with the bug present.
             |  Not an unguardable property, then, and not a missing counter: a
             |  fixture too small to tell the two cases apart. Thirty rows makes
             |  them different numbers, and the new test reports 60 when the
             |  dependency array goes back - 30 rows times the 2 commits.
             |  Three injections, each failing the test that names it: the shipped
             |  dependency array fails 1 (at 60 against a bound of 6), `openId`
             |  alone fails 1, and letting the refs go stale fails 1 - and that
             |  last is caught by the PRE-EXISTING "does not fetch the same detail
             |  twice when a row is reopened", which is the right place for it.
             |  The failure mode this fix introduces was already covered.
             |  Not touched: the 175-200ms mount of two hundred rows. That is one
             |  render of a bounded list on page load, not a frequent path, and
             |  virtualising it is a different change with a different risk.
             |  Confidence: Jest 7659 across 539 suites, typecheck and eslint
             |  clean.
             |
             |  2026-09-30  The public booking page built 833 date formatters to
             |  paint itself and 60 more for every character an invitee typed.
             |  Measured first, on a 336-slot window (21 days, 16 times a day,
             |  which is a 30-minute meeting over a normal working fortnight):
             |  mount 108ms over two commits, picking a time 10-37ms, and each
             |  keystroke in the name field 15-22ms. Instrumenting the
             |  Intl.DateTimeFormat constructor said why: 833 constructions to
             |  mount, 60 per keystroke. The 60 is exactly the page - 42 for the
             |  day rail (two formatters per day, built inline in SlotPicker's
             |  render body), 16 for the times in the open day, one for the day
             |  heading, one for the chosen slot's stamp.
             |  Two independent causes. Every function in lib/meetings/scheduling.ts
             |  constructed its formatter per call, and `dateInTimezone` is called
             |  once per slot by `groupSlotsByDate` - so grouping a fortnight built
             |  336 of them, twice, because the page renders at UTC for hydration
             |  and regroups once `detectTimezone` answers. And SlotPicker was not
             |  memoised while the form's state lives in the page above it, so
             |  typing a name re-rendered the whole grid to paint a character into
             |  an input beneath it.
             |  Fixed both. Six named shapes cached per zone, the idiom
             |  lib/meetings/schedule.ts already used for its offset formatters;
             |  the rail's two inline formatters moved into the module as
             |  formatSlotWeekday and formatSlotDayMonth (which also gave them the
             |  fallback they never had - an unknown zone used to throw mid-render);
             |  and memo on SlotPicker and on TimezoneSelect, whose option list is
             |  the runtime's whole IANA table, 418 elements rebuilt per keystroke.
             |  After: mount 55ms, picking a time 5-7ms, a keystroke 0.9-1.1ms and
             |  ZERO formatters. Twelve characters went from 233-345ms to 16-20ms.
             |  A failure cannot be cached - the constructor throws before the map
             |  is written - so a browser sending a junk zone still falls back and
             |  cannot grow the map. Tested, not just reasoned.
             |  What is guarded: the formatter count, which is the cost that was
             |  actually paid. One formatter for 336 slots, zero once a zone is
             |  warm, zero across twelve keystrokes end-to-end on the real page,
             |  and an oracle built in the test that checks the cached answers
             |  against a formatter it constructs itself.
             |  What is NOT, said plainly because both were injected and neither
             |  broke a thing: un-memoising SlotPicker passes all 7685 tests, and
             |  so does putting the quadratic bucket copy back into
             |  groupSlotsByDate. A component that skips a render writes nothing to
             |  the DOM, and an allocation count is not observable from outside.
             |  The render numbers are in the PR with a Profiler; the memo is
             |  defended by nothing but the comment explaining why its props are
             |  stable.
             |  Third call site, found by grep not by luck: SchedulingSettings
             |  passed TimezoneSelect an inline arrow, which would have defeated
             |  the new memo on the one screen where a host types into three text
             |  fields. patchDraft is a useCallback now. That is the same
             |  memo-defeated-by-one-prop shape as the calendar's presence object
             |  and the log's dependency array - a third instance, in a component
             |  shared by three screens.
             |  Confidence: Jest 7685 across 540 suites, typecheck and eslint
             |  clean. Eight injections, each breaking exactly what it should and
             |  nothing it should not.
             |
             |  2026-09-30  The manage-booking page showed a stranger nothing at
             |  all until a round trip it did not need to make.
             |  Measured the render path FIRST, and it was already fine - typing a
             |  cancellation reason costs 1.1ms and builds zero formatters, which
             |  is #1187's shared SlotPicker/TimezoneSelect work paying off on a
             |  page I had not touched. There was no render work to do here and I
             |  did not invent any.
             |  The cost was the SHAPE of first paint: commit one was a 0.3ms
             |  spinner, commit two was 39-45ms and arrived only after
             |  /api/scheduling/booking/[token] answered. Instrumented that GET
             |  with a 25ms-per-read stub: SEVEN reads at a SERIAL DEPTH OF FOUR -
             |  booking, then (page, event type), then the room code, then
             |  (meetings, bookings, blocks) - about 100ms, plus 7-9ms generating
             |  slots. All of it after the HTML had been delivered and hydrated,
             |  on the one page a stranger reaches from the one email they have.
             |  The page holds the token. The server could always have made that
             |  request. So page.tsx is a server component now: it reads the view
             |  and hands it over, and the route keeps serving the same thing
             |  through the SAME function - the browser still needs it after a
             |  cancel or reschedule, and as the fallback when the server read
             |  fails. One loader, so the two cannot disagree about the shape.
             |  After: ZERO fetches on mount, and the booking is in the FIRST
             |  commit. Honesty about my own harness: the "before" fetch was a
             |  jsdom mock that resolved instantly, so the wall-clock numbers
             |  understate this - the round trip IS the win, and it was measured
             |  separately rather than inferred.
             |  Three states, not two, because they are three different sentences:
             |  a view means paint it, `null` means this token names no booking so
             |  say the link is dead, `undefined` means the server could not look
             |  so fetch as before. Collapsing the last two would tell somebody
             |  holding a perfectly good link that it is invalid because a
             |  deployment is missing its keys.
             |  Two bugs found on the way, one pre-existing and one I would have
             |  introduced. Pre-existing: the zone was re-resolved on every load,
             |  so cancelling threw away the zone the invitee had picked from the
             |  dropdown; it resolves once now, on the first view to arrive.
             |  Introduced-and-caught: `isPast` read Date.now() in the render body,
             |  which is fine for a client-only page and a hydration mismatch the
             |  moment the server renders it - a meeting ending between the two
             |  renders would change which controls exist. The server's instant is
             |  passed in and used for that first render; the real clock takes over
             |  on mount.
             |  EIGHT injections, and the eighth is the point. Reverting page.tsx
             |  to `<ManageBooking token={token} />` - undoing the entire change -
             |  passed everything, because a server component has no component
             |  test. So I wrote page.test.tsx, following report/page.test.tsx:
             |  await the page, render what it returned, assert which of the three
             |  answers it handed over. That injection now fails 3 tests.
             |  This is the first change in this pass with NOTHING unguarded. The
             |  other four each had a claim resting only on the PR's numbers. The
             |  difference is not that I tried harder: it is that "the server did
             |  the read" leaves a trace a test can see - a fetch that did not
             |  happen - where "a component skipped a render" does not.
             |  The page had no tests at all before this. It has 17 now, plus 5 on
             |  the shared loader.
             |  Confidence: Jest 7725 across 545 suites, typecheck and eslint
             |  clean.
             |
             |  2026-09-30  A finished meeting now writes itself onto the CRM
             |  record of everyone who was in it. First CRM slice, and almost none
             |  of it was new.
             |  Surveyed before designing, which changed the request: "turn
             |  meetings and inbox into a CRM feature" was not a CRM to build.
             |  network_contacts, stages, relationship scoring, opportunities,
             |  tasks and a per-contact timeline all worked already.
             |  network_activities has had `meeting` as an activity type, an
             |  is_system flag documented "system entries come from the engine and
             |  are not user-editable", and a metadata column documented for
             |  "machine-generated entries (from/to stage, message id, DURATION)"
             |  since the day it was created. Nothing had ever written one.
             |  live_meetings.related_contact_id is selected in every meetings
             |  query, typed in four files, writable through the API - and set by
             |  nothing, read by nothing. The schema anticipated this feature down
             |  to the word "duration" and then nobody wired it.
             |  So: connective tissue. crm-activity.ts holds every rule and is
             |  pure; crm-activity.server.ts does the three things needing a
             |  database; the report route gains a fourth sibling in a Promise.all
             |  it already had.
             |  Four decisions, all the author's: system-flagged and always shown;
             |  EXACT EMAIL ONLY; the entry carries summary + decisions and links
             |  the rest; sentiment stays in the report.
             |  That last one is worth keeping. The report holds an AI reading of
             |  how a meeting went. Putting it on a named person's permanent
             |  record, org-wide and invisible to them, is a different claim from
             |  "this meeting happened" - so it was raised as a question rather
             |  than shipped as a field, and the answer was no.
             |  Two things found rather than assumed. loadPresentPeople already
             |  resolves attendance to addresses, handles guests, the row ceiling
             |  and the NULL-distinct rejoin case, and never throws - so it was
             |  reused instead of a second resolver being written. And a
             |  booking-link meeting is indistinguishable by
             |  live_meetings.source (both read "fundexecs"), so `inbound` needs a
             |  scheduling_bookings lookup; it runs in parallel and reads as
             |  outbound if it fails.
             |  The unsafe part, fixed first: network_activities has NO unique
             |  constraint, and the report path runs more than once
             |  (/report/regenerate, the room's retry, two call sites). Without a
             |  key, a regenerate would add a second copy of one meeting to every
             |  attendee's record, then a third - and relationship scoring reads
             |  this table, so duplicates move numbers people decide on. A partial
             |  unique index on (org, contact, metadata->>'meeting_id') where
             |  is_system and type='meeting', and the writer upserts on it: a
             |  regenerate now CORRECTS the entry.
             |  TWELVE injections, all breaking the test that names them - but
             |  only after a fix. The first pass had ELEVEN of twelve: stripping
             |  the URL validation, so a `javascript:` value in metadata would
             |  render as an href on the contact record, broke NOTHING. That is a
             |  security guard with no test, found by injecting rather than by
             |  reading, and five tests now hold it. metadata is jsonb and this
             |  value becomes a link; only server code writes it today, which is
             |  exactly the kind of fact that stops being true quietly.
             |  Also: the contact timeline already rendered system entries - with a
             |  grey dot instead of a gold one and nothing saying what grey meant.
             |  It says "Automatic" now. And network-active.ts's comment claiming
             |  the feed is "meetings people logged by hand" became false with this
             |  change, so it carries is_system on the event and says so.
             |  Confidence: Jest 7786 across 547 suites, typecheck and eslint
             |  clean.
             |
             |  2026-09-30  And then CodeRabbit found that the CRM slice did not
             |  work at all, and that my test said it did.
             |  Waited for the review instead of merging on green, because this one
             |  touched a migration and wrote to people's permanent records. It
             |  returned two findings, both mine, both real.
             |  CRITICAL: PostgREST's on_conflict takes a comma-separated list of
             |  COLUMN NAMES. It cannot carry an expression, and cannot carry the
             |  WHERE predicate Postgres needs to infer a PARTIAL index. My upsert
             |  named `(metadata->>'meeting_id')`, so every call would have failed
             |  with "there is no unique or exclusion constraint matching the ON
             |  CONFLICT specification" - and because the writer logs and carries
             |  on by design, it would have failed SILENTLY, forever, with no
             |  meeting ever reaching a timeline. The feature was dead on arrival.
             |  Confirmed independently before acting: every other onConflict in
             |  this repo, all nineteen of them, is a plain column list. Mine was
             |  the only expression.
             |  And my test asserted the conflict target EQUALLED the string my own
             |  migration named. Both were wrong together, so it passed. That is an
             |  oracle checking code against the assumption the code was written
             |  from - the exact mistake I named and avoided in the report search
             |  earlier this same session, then walked into here. The rewritten test
             |  asserts the property POSTGREST imposes, which is external to both:
             |  every element of the target matches /^[a-z_][a-z0-9_]*$/, so any
             |  expression fails whatever the migration says.
             |  MAJOR: network_contacts.email is stored as given, and there is an
             |  index on (organization_id, lower(email)) precisely because it holds
             |  mixed case. I filtered `.in("email", addresses)` with lowercased
             |  addresses - missing every contact stored capitalised, and missing
             |  the index. A miss that reads exactly like "not in the CRM".
             |  Both fixed with real columns rather than cleverness: `meeting_id`
             |  generated from the metadata (one source of truth) with a PLAIN
             |  unique index - hand-logged rows have a NULL there and NULLs are
             |  distinct, so they need no predicate to exempt them - and
             |  `email_lower` generated from lower(email), indexed, which makes the
             |  lookup both correct and fast.
             |  Injected both original bugs back: the expression target fails 1
             |  test, the raw-email lookup fails 8.
             |  The lesson is not "run the reviewer". It is that TWELVE injections
             |  and 7786 tests did not catch a feature that could never write a
             |  row, because every one of my checks was downstream of the same
             |  wrong belief about PostgREST. An injection can only disprove what
             |  its author thought to doubt.
             |  Confidence: Jest 7787 across 547 suites, typecheck and eslint
             |  clean.
             |
             |  2026-09-30  And the other half: an inbox conversation now writes
             |  itself onto the CRM record of the person on the other end of it.
             |  ONE ROW PER THREAD, not per message. A conversation of forty
             |  replies is one relationship, and a row per message would bury every
             |  hand-logged note under a wall of email. So the entry is upserted on
             |  the thread and kept CURRENT: subject, newest summary, instant of the
             |  latest message.
             |  Which makes the same key the meetings writer needed - real columns,
             |  because PostgREST's on_conflict carries column names and nothing
             |  else - and `thread_id` generated from the metadata the writer
             |  already sets. Hand-logged rows have NULL there and NULLs are
             |  distinct, so nothing a person types is constrained by it.
             |  Two write points, deliberately. The ingest writes the entry as the
             |  thread lands, carrying only the raw preview, because the
             |  intelligence pass has not run yet. refreshThreadSummary then writes
             |  it AGAIN with the model's summary, and the upsert makes that a
             |  CORRECTION to the same entry rather than a second copy of the
             |  conversation. A record should read "Ana asked for the updated pacing
             |  model", not "Hi - could you send over".
             |  Extracted contact-match.ts on the way: the matching rule was in
             |  lib/meetings, and "lib/meetings owns the rule lib/inbox depends on"
             |  is the wrong shape. The rule belongs to the CRM; both are consumers.
             |  Exact addresses only, again, held there by the same near-miss list.
             |  The ingest path never fails on this. A thread that cannot reach the
             |  CRM must still reach the inbox - a webhook that reports failure is a
             |  provider retry and then a message the operator never sees. Asserted
             |  from the ingest's own side, with a CRM write that fails: the ledger
             |  still says the thread landed.
             |  ONE TEST WORTH NAMING. activity_type has a CHECK constraint, so
             |  every channel must map to something the column accepts. The pure
             |  test asserts against a copy of that list; the server test reads the
             |  list OUT OF THE MIGRATION and checks what the writer actually puts
             |  in the payload. That is what caught the injection where an unknown
             |  channel falls through to its own name - the kind of value a new
             |  provider added in six months would produce.
             |  15 injections, 15 caught, no misses this time. Worth being precise
             |  about why: the ones that matter (the expression conflict target, the
             |  raw-email lookup) were caught because they had already SHIPPED
             |  BROKEN on the meetings side earlier today, and the tests here were
             |  written from that. An injection pass measures the author's
             |  imagination, and mine had just been corrected by a reviewer.
             |  WHAT THESE TESTS CANNOT DO: the index and generated-column tests
             |  read SQL text out of supabase/migrations. They prove the migration
             |  says the right thing. They cannot prove it was APPLIED, and they
             |  cannot prove Postgres accepts the generated expression. Only a run
             |  against a real database does that.
             |  Confidence: Jest 7835 across 549 suites, typecheck and eslint
             |  clean.
             |
             |  2026-09-30  CodeRabbit passed the inbox slice with zero actionable
             |  comments and MINIMAL merge risk, and then its security section
             |  raised the thing that was actually wrong with it.
             |  `counterparty_email` comes from the message's From header. The Svix
             |  signature proves RESEND sent the delivery; it proves nothing about
             |  who the message says it is from, and the payload slice this app
             |  reads carries no SPF/DKIM/DMARC result. So a forged
             |  `From: ana@acme.com` that happens to match a contact exactly lands
             |  as a row on Ana's permanent record - and the timeline badged every
             |  is_system row "Automatic", which a reader takes to mean the app
             |  observed it.
             |  That badge conflated two different claims. WHO WROTE THE ROW (the
             |  engine, not a person) and WHETHER THE APP HAD GROUNDS TO BELIEVE THE
             |  PERSON IT NAMED WAS INVOLVED. For a meeting the second is true: the
             |  host built the invite list, the room watched people join. For
             |  inbound mail it is not.
             |  I did not fix sender authentication. That needs a provider contract
             |  - which auth results Resend exposes, what the other channels mean -
             |  and guessing at it would be worse than not having it. What IS
             |  fixable from here is the overclaim: identity-assurance.ts, one
             |  marker on the provenance, and a second badge that says "Sender
             |  unverified" beside "Automatic". The record now says what it knows.
             |  The test worth naming asserts across the TWO WRITERS rather than
             |  against the marker string: every row threadActivity returns reads as
             |  asserted, and no row meetingActivities returns does. A marker only
             |  works if producer and consumer agree, and comparing each of them to
             |  a literal I typed in the test would prove neither.
             |  5 injections, 5 caught, including the two that matter most: a reader
             |  that calls everything asserted (marks observed meetings unverified)
             |  and a UI that marks every automatic row (same effect from the other
             |  end). Both would train a reader to ignore the words on the rows
             |  where they are true, which is worse than silence.
             |  A cast hid a real type error on the way - `as ContactRecord` over a
             |  fixture with stage: "active", which is not a stage. Second time
             |  today a cast covered drift the type would have caught. Removed the
             |  cast rather than widening it.
             |  WHAT THIS DOES NOT DO: a forged sender can still write that row. It
             |  can still land on a private contact - matching has no visibility
             |  predicate. And because the activity is keyed on the thread, a forged
             |  message that hits the same threadKey (same From, same subject)
             |  updates the genuine conversation's entry rather than adding one.
             |  That last one is inherited from the inbox's own threading, not
             |  introduced here, but it is now reaching the CRM.
             |  Confidence: Jest 7842 across 551 suites, typecheck and eslint
             |  clean.
             |
             |  2026-09-30  A way to take a machine-written entry off the wrong
             |  person's record. CodeRabbit's second hardening point on #1195, and
             |  the better one: it is useful even when nothing is forged, because a
             |  summary can simply be about the wrong person.
             |  The reason there was no way: network_activities_update restricts a
             |  member to their OWN, non-system entries, and that restriction is
             |  what makes the timeline evidence rather than opinion. Correct in
             |  itself, and its consequence was that a machine-written entry on the
             |  wrong record was PERMANENT for everyone who could see it.
             |  MARK, do not edit and do not delete. Editing the body would destroy
             |  what is_system is for. And DELETING WOULD BE SILENTLY UNDONE - the
             |  inbox writer re-matches on the address every time the thread gets a
             |  reply, so a deleted row returns on the next message, unmarked.
             |  Keeping the row WITH its contact_id is what makes the correction
             |  durable: the next reply conflicts with the marked row and updates
             |  its content, and the mark survives because PostgREST's ON CONFLICT
             |  DO UPDATE sets only the columns in the payload, and neither writer
             |  mentions it. That is now the most important test in the set.
             |  Recency too, or it is half a fix. network_contact_touch_activity is
             |  an AFTER INSERT trigger that pushes network_contacts
             |  .last_activity_at forward, indexed and feeding relationship
             |  scoring - so hiding the entry while leaving the contact looking that
             |  recently active corrects nothing a person reads. The function
             |  recomputes it from the entries that remain, and leaves it alone when
             |  none do, because it was backfilled for contacts that never had an
             |  activity and clearing it would destroy rather than correct.
             |  Authorization is deliberately NOT ordinary edit rights. A system
             |  entry belongs to no member - actor_id is whoever happened to end the
             |  meeting, or null for an ingest - so "your own entries" has no
             |  meaning. Org admin, through a SECURITY DEFINER function following
             |  merge_network_contacts: over PostgREST the update would match zero
             |  rows, report no error, and the route would say it worked.
             |  Did not copy the merge route's `as any` on the client, which is how
             |  it reaches an unregistered RPC. Registered the function in
             |  database.types.ts instead, which then made a cast in my own route
             |  unnecessary - removed rather than kept.
             |  12 injections, 11 caught, AND THE MISS IS THE INTERESTING ONE.
             |  Dropping `security definer` from the function broke nothing, because
             |  my test asserted /security definer/i against the whole migration and
             |  the migration's OWN COMMENT explains why it is SECURITY DEFINER. The
             |  oracle matched prose, not the clause. Third time this session that a
             |  test passed by agreeing with something other than the code under it.
             |  Rewritten to match the clause structurally, between `language
             |  plpgsql` and the body; injection 6 then failed as it should.
             |  WHAT IS NOT BUILT: restoring a mistaken correction. The function
             |  takes flag=false and the route exposes it, but a marked entry is
             |  hidden from every reader, so there is no way to FIND one in the UI
             |  to restore. Irreversibility-in-the-UI is the same shape as the
             |  problem this slice fixes, and it is deferred rather than
             |  half-built - it wants the timeline to show corrected entries to
             |  admins, which is its own piece.
             |  Also left: the dashboard's org-wide activities_week count still
             |  counts corrected rows. It is not a record about a person, and
             |  re-creating that rollup function to filter one number was not worth
             |  the noise. Said rather than skipped.
             |  Confidence: Jest 7851 across 552 suites, typecheck and eslint
             |  clean.

2026-10-09  |  The microphone that went quiet and nobody noticed  |  Asked to
             |  harden camera and microphone handling so both sides of a call
             |  are seen and heard. Audited the whole media path first: join
             |  (combined then split getUserMedia, device walk, preview
             |  adoption), repair (sender re-attachment on connect, the
             |  liveness check, the reacquire loop, the device-loss listener)
             |  and rendering (always-mounted tiles, one audio element per
             |  peer). Most of what the request names was already built, so
             |  the work was the gaps between those pieces.
             |  THREE GAPS. (1) A microphone that STALLS - track live, goes
             |  `muted`, never ends - had no watcher. The camera had one, and
             |  it only tells; the microphone's reopens first (being heard is
             |  the floor), once per minute, then tells. Stands down while the
             |  page is hidden, because a phone in a pocket mutes its capture
             |  and un-mutes it on return. (2) A phone put down and picked up
             |  again leaves every <video>/<audio> paused on a live stream and
             |  the analyser context interrupted; `play()` only ran on attach
             |  and `canplay`. One hook listens for the page coming back and
             |  plays what is paused; the meter resumes its context the same
             |  way. (3) A preview track that ENDS while a guest waits (iOS
             |  stops capture in the background) was never reopened: the
             |  preview went black, the meter flat, and the device check
             |  blamed a working camera. Ended is now turned into missing and
             |  the per-device effects run again - never for a track the call
             |  has taken, never while a join is in flight.
             |  AND ONE THE TESTS FOUND. Writing the stall test with the
             |  camera off, the stall notice never appeared: a red "Nobody can
             |  see you - your camera could not be started" was pinned over
             |  it. Joining with the camera off opens no camera, `standingOf`
             |  read no-track as cannot, and every camera-off member in every
             |  meeting has sat under that banner - undismissable, hiding every
             |  other media notice. The pure module's own test for "chose to
             |  be off" used a present-but-disabled track, which is not what a
             |  camera-off join produces. `standingOf` now takes `wanted`;
             |  the room mirrors `camWantedRef` into state to supply it.
             |  Confidence: new suites for mic-liveness (pure), the resume
             |  hook (tile and peer audio), the green-room ended path, and
             |  five mic-stall cases plus the camera-off banner in the live
             |  room test; each DOM suite shown failing against the unfixed
             |  component first. Typecheck and eslint clean.
             |  REVIEW FOLLOW-UP, same day: the ended-track reopen had no
             |  cumulative bound, so hardware that opens and then ends on its
             |  own (a failing cable, a virtual camera crash-looping) was
             |  reopened once per cycle for as long as a guest waited. Added
             |  a per-device ledger (preview-recovery.ts): three short-lived
             |  replacements, then stop; a replacement that stayed up thirty
             |  seconds starts the count over, as does a Try again press or a
             |  different device. The first draft reset the ledger on the
             |  retry key - which the automatic reopen itself bumps - so the
             |  count never passed one. The test written for the cap caught
             |  it on the first run. The reset now belongs to the member's
             |  own actions only.

2026-10-09  |  The pipeline that lost its last sentence  |  Asked to inspect
             |  microphone → live meeting → transcript → report for errors
             |  and friction, and to ask before fixing where a decision was
             |  needed. Three parallel audits, every high finding re-verified
             |  by hand; nine decisions put to the owner one at a time.
             |  THE CHAIN BROKE AT THE EXITS. The remote `end` handler — the
             |  exit most non-hosts take — settled nothing and drained
             |  nothing; a guest's closing sentence, interim when the host
             |  pressed End, had no other copy. The drain gave up on its
             |  first failed request. The report existed only if the host
             |  pressed End; a closed tab stranded the meeting as "active"
             |  with its transcript unreachable behind a Regenerate button
             |  gated on a report row. A guest who attended could never open
             |  the report, against three comments saying otherwise.
             |  AND LIED IN BETWEEN. The recognizer's status was written on
             |  start and never on end, so a `network` error on every run was
             |  "Live" for the whole call; a run that never started restarted
             |  at zero delay (the backoff's own test pinned the loop as
             |  intended). A refused save retried every thirty seconds in
             |  silence while the room was told the member was covered.
             |  Dismissing the deaf notice re-announced "transcribing" to
             |  every peer. A suspended AudioContext recorded zeros as
             |  measured silence and marked real speech a hallucination.
             |  speaker_id was "local" on every stored row.
             |  Decisions, all on the recommendation: Generate-report button
             |  now and an hourly sweep for meetings nobody ended; a signed
             |  report link from the guest key; a mute mid-sentence judged by
             |  where the press fell (a sentence cannot be cut at a
             |  timestamp); summary email host-only, attended-only, with a
             |  sent marker; a notice after three refused saves; signaling id
             |  as speaker_id; utterance-start timestamps; a Safari notice at
             |  pick time; an unsummarised state for empty transcripts.
             |  Room side in this entry (transcript-drain, transcript-saving,
             |  recognizer status, meter guard, attribution); report side in
             |  the next.

2026-10-09  |  The report that only existed if the host pressed End  |  The
             |  report side of the same audit, built in parallel on a
             |  worktree by a second engineer and merged here.
             |  ONE WRITE PATH. report-generation.server.ts now holds the
             |  generate-from-stored-rows, unsummarised-row and close-meeting
             |  steps, used by the End route, the Regenerate route and the
             |  new hourly sweep. End is idempotent (a report seconds old is
             |  returned, not regenerated); maxDuration pinned against the
             |  client's wait. Participants come from attendance plus the
             |  transcript's speakers in both routes - the invite list named
             |  people who never came and omitted guests who did. The prompt
             |  no longer tells the model a speaker called "You" is the host;
             |  nobody was ever labelled "You".
             |  NOTHING TO SUMMARISE is a state, not a report. A silent or
             |  noise-only transcript writes a row that says so and closes
             |  the meeting; the model is not called and the page does not
             |  show "ready" over an empty report.
             |  A MEETING NOBODY ENDED is found twice: the log offers
             |  "Generate report" whenever transcript rows exist (an RPC
             |  answers "which of these meetings have rows" under the
             |  caller's own RLS), and an hourly sweep closes meetings three
             |  hours past their last sign of life - one model call per pass,
             |  booked-but-never-joined meetings untouched.
             |  A GUEST CAN READ THE REPORT. The thank-you screen asks a
             |  public route, with the key the browser knocked with, for a
             |  signed expiring link; the token carries a digest of the key,
             |  never the key, and is minted only for an admitted one. The
             |  link's page waits politely while the report is still being
             |  written. Four comments that said guests had this already, or
             |  could never have it, now agree with the code.
             |  THE SUMMARY EMAIL went from any attendee to everyone invited,
             |  twice if pressed twice, to host-only, attended-only, with a
             |  sent marker on the meeting and a deliberate resend.
             |  Also: the export gains the host's open questions and the
             |  meeting's real date; the gated follow-up writes the status
             |  the chip reads; inbox threads are filed under the meeting's
             |  org, not the sender's.
             |  Confidence: two new migrations; new suites for report
             |  generation, the sweep, the guest link (route, signer, page,
             |  thank-you screen), the log and the generate button; the
             |  route suites extended. Full Jest, typecheck and eslint clean
             |  on the merged tree.
2026-10-09  |  The transcript that turned to noise on one browser  |  Asked
             |  to work on the microphone; the owner answered questions one
             |  at a time and gave a report link (sed-nu9-73). Read the stored
             |  rows against the deploy history before touching code.
             |  WHAT THE ROWS SAID. The guest's lines: 25 words each, real
             |  engine scores, lowercase (Chrome). The host's: 3-4 words of
             |  punctuated nonsense ("Bob Popcorn.", "Washoe surgery Power.")
             |  at confidence 1.0, i.e. no engine score (Edge on Windows, per
             |  the owner). Every host meeting since 2 October 17:59 UTC reads
             |  the same; every one before reads 14-28 words a line. And in
             |  the 17:20 meeting that day the host's transcript was perfect
             |  for six minutes, then noise, while the guest said "I was able
             |  to hear you, perfect" - the owner changed nothing.
             |  WHAT CHANGED AT THAT MINUTE. #1265 (16:26 UTC) began handing
             |  the recogniser the call's own track, start(track), to stop a
             |  second raw capture breaking echo cancellation. That first
             |  version fell through to a bare start() when the track was not
             |  yet live at join, so the host's first run was still bare and
             |  clean; the engine restarts itself every few minutes, and the
             |  restart took the track and the transcript turned. Since 5
             |  October the room waits for the track, so now every call is
             |  noise from the first word. Edge is Chromium with its own
             |  speech backend: it exposes available(), so this morning's
             |  engine check counts it as following the track and says
             |  nothing, and the audio it gets by that path comes out as
             |  nonsense with no confidence. Chrome guests on the same code
             |  are fine. Microsoft's docs describe track support only under
             |  their on-device mode (Canary/Dev behind a flag).
             |  THE OWNER CHOSE DIAGNOSTICS FIRST over an Edge-specific
             |  bare start. Every own final line now carries, in a new
             |  `recognizer` jsonb (migration 20261009180000): browser brand
             |  (client hints, else UA), whether the engine exposes
             |  available(), the run's path (track/bare), ordinal and age, the
             |  engine's RAW confidence (zero kept as zero - "said zero" and
             |  "said nothing" are different answers), the track label and
             |  the language. The route keeps only those keys. The console
             |  logs each run's path and brand. After one Edge call the rows
             |  will say whether the track path is the whole story.
             |  FOUND ON THE WAY: the DB Migrate workflow has failed since
             |  16:36 UTC today on "Invalid access token" - SUPABASE_ACCESS_TOKEN
             |  is dead - so 20261009100000 (summary_sent_at) and
             |  20261009100100 (the transcript-rows RPC) are not in production
             |  while the code that reads them is. Reported to the owner.
             |  Confidence: new pure suite; buffer, route and live-room tests
             |  extended; full Jest, typecheck and eslint clean.
```

---

*This file is the Associate Agent's memory before the Associate Agent exists.*
*When the agent is built, it will read this file first.*
*When the system learns, it will write back to this file.*
*The prompt and the product are the same thing.*
