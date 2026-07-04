# FundExecs OS — Platform Architecture Map

*Confidential · July 2026*

> This document is written from the working codebase. Component names correspond to real modules, tables, and endpoints in the repository.

---

## 1. System overview

```
                        ┌──────────────────────────────────────────────┐
                        │                OPERATOR SURFACES              │
                        │  Command Center · Copilot Sessions · Hubs     │
                        │  Capital Map · Unified Inbox · Investor Portal│
                        │  Data Room · Automations · Wallet             │
                        └───────────────┬──────────────────────────────┘
                                        │  Realtime events (task_events)
┌───────────────┐       ┌───────────────▼──────────────────────────────┐
│  FOUR HUBS     │       │              THE SACRED LOOP                 │
│  Build         │◄─────►│  /api/prompt → intent → hub router           │
│  Source        │       │   → task engine → agent assignment           │
│  Run           │       │   → execution → handoff → /api/approve       │
│  Execute       │       │   → /api/report → graph update → loop        │
└───────────────┘       └───────────────┬──────────────────────────────┘
                                        │
                 ┌──────────────────────┼──────────────────────┐
                 ▼                      ▼                      ▼
        ┌───────────────┐     ┌───────────────┐      ┌───────────────┐
        │ FIFTEEN AGENTS │     │ THREE GRAPHS  │      │  ARTIFACTS +  │
        │ orchestrated   │     │ Relationship  │      │  RECORDS      │
        │ by Earn        │     │ Deal          │      │  (provenance- │
        │ (+ Brains KBs) │     │ Capital       │      │   tracked)    │
        └───────────────┘     └───────────────┘      └───────────────┘
                 │
                 ▼
        ┌────────────────────────────────────────────┐
        │ DATA LAYER — Postgres/Supabase, 66+         │
        │ migrations, RLS on every table, org tenancy │
        └────────────────────────────────────────────┘
```

## 2. The four hubs

| Hub | Purpose | Key modules |
|---|---|---|
| **Build** | Identity and foundation | Profile · Thesis · Brand · Entity · Track Record · Team |
| **Source** | Pipelines and relationships | LP Pipeline · Deal Pipeline · Debt & Hybrid · Partners · Providers |
| **Run** | Evaluate active deals | Strategy · Diligence · Underwriting · Stress Test · Comms · Risk |
| **Execute** | Operate post-closing | Closing · Capital Events · Asset Management · Reporting · Exit |

## 3. The fifteen agents (grouped by hub)

```
Orchestration   Earn — workflow coordination and task execution across all hubs

Run             Analyst — pro formas, valuations, sensitivities, comps
                Diligence — document parsing, risk flags, diligence memos

Execute         Investor Relations — LP comms, capital calls, reporting
                Portfolio Ops — asset KPIs, budgets, capex, variance
                Fund Admin — waterfalls, fund accounting, audit prep

Source          Executive Advisor — investor research, targeting, first-contact intel
                Capital Raiser — LP fundraising, capital formation, investor pipeline
                Capital Connector — deal financing, capital stack, lender relations
                Deal Sourcer — deal flow, acquisition strategy, seller outreach
                Rainmaker — prospect conversion, qualification, capital closing

Build           Lead Generator — funnels, lead capture, CRM, campaign ops
                PR Director — investor materials, decks, CIMs, brand narrative
                SEO Disruptor — search authority, content, organic leads
                Curator — private investor rooms, salons, post-event conversion
```

Each agent carries a knowledge base ("Brain") and a capability list; the catalog is seeded in the database and mirrored in `lib/agents.ts`. Full behavioral spec: document 06.

## 4. The task engine (the sacred loop)

Every user action flows through one spine — the Copilot, scheduled Automations, and future email/webhook/event triggers all reuse it:

```
User prompt (or trigger fires)
  → Intent parse + hub routing
  → materializePlan: Claude structured-output plan → workflow (parent task) + ordered steps (child tasks)
  → Approval gate (/api/approve)          ← or opt-in auto_approve for trusted automations
  → Per-step execution (per-agent, adaptive thinking)
  → Typed artifact persisted per step (artifact.created event)
  → Workflow completion → records seeded (Source→Deal, Execute→Asset), idempotent
  → /api/report → graphs updated → loop
```

- **Events:** `task.created · task.progress · task.completed · task.handoff · approval.requested · approval.response · artifact.created · graph.update` — streamed to the client via Supabase Realtime over the `task_events` table.
- **Gate layer:** Tier 1/2/3 gating so no action reaches a counterparty without sign-off.
- **Model routing:** live loop defaults to a cost-efficient model (`CLAUDE_MODEL`-overridable); planning and extraction use structured outputs; a deterministic fallback keeps the loop functional without an API key.

## 5. The three graphs

| Graph | Contents | Feeds |
|---|---|---|
| **Relationship** | Who knows whom; who invested in / financed what | Capital Map temperature, warm-intro pathfinding |
| **Deal** | Deals, targets, portfolio companies, SPVs, funds | Pipeline, underwriting context, deal intelligence workspace |
| **Capital** | LPs, investors, lenders, family offices, banks | LP pipeline, capital stack, allocator portfolios |

All three are **native, first-party structures** in the schema (no external graph dependency). The dedicated `/graph/*` query layer and visualizations are the current build focus.

## 6. Data model

- **PostgreSQL via Supabase**, authored as **66+ versioned migrations** covering: identity & orgs, the four hubs, capital, deals, relationship graph, task engine, marketplace, audit log, artifacts, automations, sessions, brains/KBs, mandates, data room, investor portal & valuations, inbox, sourcing intelligence & entities, deal shares, tokenization, team tasks & operator feedback, integrations, outreach sequences, funnel snapshots, artifact provenance/grounding.
- **Tenancy:** every table is org-scoped with **row-level security**; membership checked via helper functions. Member-read / writer-write policy pattern throughout.
- **Ledgers:** wallet + append-only `credit_ledger` (billing), `operator_feedback` (learning), audit log, dispatch log — the platform is event-sourced where trust matters.
- **Tokenization abstraction** (specified): every token-like unit = balance + append-only movement log + `settlement` field (`internal` today; `anchored`/`onchain` as future per-unit migrations, not a rewrite).

## 7. API surface

Native REST, no external SDKs for core intelligence:

| Endpoint | Role |
|---|---|
| `POST /api/prompt` | Accepts an objective; plans it into a workflow |
| `GET /api/task` | Workflow and step status |
| `POST /api/approve` | Approval gate; triggers execution |
| `GET /api/report` | Deliverables and analytics for a workflow |
| `GET /api/agents` | Agent catalog and workloads |
| `GET /api/cron` | Secret-guarded automation sweep (hourly) |
| `GET /api/graph/*` | Relationship / Deal / Capital graph queries (in flight) |

Plus: API keys and scoped data-API grants for programmatic org access.

## 8. Frontend

- **Next.js / React / Tailwind**; warm-black/gold institutional visual system (Space Grotesk / DM Sans / JetBrains Mono) with a documented governance model (`docs/VISUAL_SYSTEM.md`)
- **Copilot session surface** with a live 2D agent workspace (avatars, status lanes, computation panels); Three.js/GSAP spatial workspace is the planned upgrade on the same event model
- Command Center dashboard aggregating pipeline, assets, deliverables, and automations

## 9. Infrastructure, security, observability

| Layer | Technology |
|---|---|
| Hosting | Vercel (+ Railway/Docker option), Cloudflare, AWS/S3 for documents |
| Auth | Supabase Auth — email/password + Google OAuth; JWT; middleware session refresh |
| Security | RLS everywhere · org tenancy · encryption at rest · audit logging · secrets never in-repo |
| Automation | Vercel Cron → `/api/cron` (CRON_SECRET-guarded, per-sweep spend cap) |
| Observability (spec) | Prometheus · Grafana · OpenTelemetry · Sentry |
| CI | GitHub Actions; typecheck/lint/test gates |

## 10. Architectural principles

1. **Data model first** — schema, migrations, RLS before API; API before agent logic; events before frontend. Never inverted.
2. **One spine, many entry points** — Copilot, automations, and future triggers share the plan→gate→execute path, so every new trigger inherits trust and audit for free.
3. **Everything durable** — steps leave artifacts, workflows leave records, actions leave ledger entries. Chat is never the system of record.
4. **Autonomy is opt-in** — the default is a gate; trust is granted per-automation and revocable.
