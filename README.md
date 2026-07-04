# FundExecs OS

> **An AI-native operating system for private-market participants — unifying relationships, deals, and capital into a single intelligence layer, with AI agents that execute workflows end-to-end.**

---

## The Problem

4+ years running advisory for PE funds and family offices taught me one thing:

**The work that kills you isn't the decisions — it's the information movement before them.**

I spent 3 hours every day sourcing deals, chasing data across a dozen tools, only to find out the opportunity was smoke and mirrors. DealCloud for pipeline. Notion for notes. Excel for underwriting. Slack for follow-ups. Carta for cap tables. None of it talked to each other. None of it got smarter over time.

There has to be a better way.

FundExecs OS is that way.

---

## What It Is

FundExecs OS is the **system of record for private-market operators** — combining multi-agent AI, real-time data graphs, and an animated workspace to replace 30+ point solutions.

It automates the **80% of time spent moving information** so you can focus on the **20% that drives decisions**.

### Wallet and Earn Copilot Visual Refresh

The visual system now has an electric-blue enterprise console treatment:
day/night themes, compute-grid panels, glowing hierarchy, CSS-only activation
streams, and an Earn copilot drawer that reads like an active operating-agent
terminal.

![FundExecs OS wallet neural preview](./public/fundexecs-wallet-neural-preview.svg)

The animated SVG below is a lightweight demo placeholder for the README and
marketing surfaces. It shows the Pro selection flow and Earn routing feedback
without adding video binaries or capture tooling.

![FundExecs OS Earn copilot demo loop](./public/fundexecs-earn-copilot-demo.svg)

Visual implementation guardrails live in
[`docs/VISUAL_SYSTEM.md`](./docs/VISUAL_SYSTEM.md): blue accents for the
operating shell, neural blue for compute/copilot surfaces, status tokens for
semantic states, and centralized logo usage.

|    What it replaces     |         What it becomes         |
|-------------------------|---------------------------------|
| DealCloud / Dynamo      | Native deal pipeline + graph    |
| Carta / Juniper Square  | Fund admin + waterfall engine   |
| Affinity / HubSpot      | Relationship intelligence graph |
| Hebbia / AlphaSense     | AI-native document analysis     |
| Notion + Slack + Zapier | Unified workflow + agent layer  |
| Visible / Passthrough   | LP reporting + capital events   |

---

## Project Status

```
🔴 Pre-Alpha — Seeking Contributors
```

**What exists today:**
- ✅ Full database schema (PostgreSQL / Supabase)
- ✅ API contract layer (native REST)
- ✅ WebSocket event stream architecture
- ✅ Agent definitions and capability specs
- ✅ UI component library spec
- ✅ Avatar animation protocol
- ✅ DevOps observability spec

**What landed in the first build (2026-06-18):**
- ✅ Next.js + TypeScript + Tailwind repo scaffold (single app: `app/` + `lib/`)
- ✅ Full Postgres/Supabase schema as 11 versioned migrations, RLS on every table
- ✅ Org-membership tenancy model + six-agent seed catalog
- ✅ Typed data layer and hub/agent/event catalogs in `lib/`

**What is being built next:**
- 🔧 Deploy schema to a live Supabase project
- 🔧 Backend API services — the `/prompt → /task → internal handoff → /approve` loop
- 🔧 AI agent engine (Analyst, Associate, IR, Portfolio Ops, Diligence, Fund Admin)
- 🔧 WebSocket event gateway (Realtime over `task_events`)
- 🔧 Animated 3D workspace (Three.js + GSAP)

---

## Architecture Overview

FundExecs OS is structured around four operational hubs, six AI agents, and three native data graphs.

### The Four Hubs

|     Hub     |              Purpose               |                            Key Modules                             |
|-------------|------------------------------------|--------------------------------------------------------------------|
| **Build**   | Define identity and foundation     | Profile · Thesis · Brand · Entity · Track Record · Team            |
| **Source**  | Manage pipelines and relationships | LP Pipeline · Debt & Hybrid · Partners · Providers · Deal Pipeline |
| **Run**     | Evaluate and manage active deals   | Strategy · Diligence · Underwriting · Stress Test · Comms · Risk   |
| **Execute** | Operate assets post-closing        | Closing · Capital Events · Asset Management · Reporting · Exit     |

### The Six AI Agents

|         Agent          |                                       Role                                       |
|------------------------|----------------------------------------------------------------------------------|
| **Analyst**            | Ingests deal data, financials, market comps — produces pro formas and valuations |
| **Associate**          | Coordinates workflows and task execution across all hubs                         |
| **Investor Relations** | Manages LP communications, capital calls, and reporting                          |
| **Portfolio Ops**      | Monitors asset KPIs, budgets, capex, and variance alerts                         |
| **Diligence**          | Parses documents, flags risks, produces diligence memos                          |
| **Fund Admin**         | Handles waterfall calculations, fund accounting, and audit prep                  |

### The Three Graphs

```
Relationship Graph  →  Who knows whom; who invested or financed what
Deal Graph          →  Deals, targets, portfolio companies, SPVs, funds
Capital Graph       →  LPs, investors, lenders, family offices, banks
```

All graphs are **native, first-party data structures** — no external dependencies.

---

## Tech Stack

|     Layer      |                          Technology                           |
|----------------|---------------------------------------------------------------|
| Frontend       | Next.js · React · Tailwind CSS · Three.js · GSAP              |
| Backend        | Node.js · Python · Native REST · Event-driven task engine     |
| Database       | PostgreSQL · Supabase · Redis                                 |
| Storage        | S3 for documents                                              |
| Infrastructure | Vercel · Cloudflare · AWS · GitHub Actions                    |
| Observability  | Prometheus · Grafana · OpenTelemetry · Sentry                 |
| Security       | JWT · Row-level security · Encryption at rest · Audit logging |

---

## Database Schema

The core schema covers the full private-market lifecycle:

```sql
-- Core entities (excerpt)
principals · organizations · investors · deals
assets · capital_events · relationships · ai_agents · tasks · marketplace
```

Full schema lives as versioned migrations in
[`/supabase/migrations`](./supabase/migrations) — applied locally with
`npm run db:start`. Every table is org-scoped and protected by row-level
security.

---

## API Contract

All endpoints are native REST. No external SDKs.

|         Endpoint          | Method |                 Description                  |
|---------------------------|--------|----------------------------------------------|
| `/api/prompt`             | POST   | Accepts user prompt; routes to hub and agent |
| `/api/task`               | GET    | Lists workflows and status                   |
| Internal handoff packet   | —      | Transfers structured context between agents  |
| `/api/approve`            | POST   | Captures user approval; triggers automation  |
| `/api/report`             | GET    | Retrieves task output and analytics          |
| `/api/agents`             | GET    | Lists active agents and workloads            |
| `/api/graph/relationship` | GET    | Returns relationship graph                   |
| `/api/graph/deal`         | GET    | Returns deal graph                           |
| `/api/graph/capital`      | GET    | Returns capital graph                        |

Full API spec available in [`/docs/api-contract.md`](./docs/api-contract.md)

---

## User Flow

```
User enters prompt
  ↓
AI parses intent → routes to hub + agent
  ↓
Task engine creates structured tasks
  ↓
Agents execute → animated avatars visualize progress
  ↓
Agents hand off work between each other
  ↓
AI recommends next move → requests user approval
  ↓
User approves / disapproves / regenerates
  ↓
Loop continues until new prompt
```

---

## WebSocket Event Model

The workspace is **live** — every agent action triggers a visible event.

```json
{
  "event": "task.progress",
  "agent": "Analyst",
  "hub": "Run",
  "task_id": "uuid",
  "progress": 0.65,
  "message": "Underwriting model updated"
}
```

Key event types: `task.created` · `task.progress` · `task.completed` · `task.handoff` · `approval.requested` · `approval.response` · `graph.update`

---

## Animated Workspace

Agents are visualized as avatars in a 3D spatial workspace built with **Three.js + GSAP**.

|       Agent        | Color  |      Motion Style      |
|--------------------|--------|------------------------|
| Analyst            | Cyan   | Precise, analytical    |
| Associate          | Indigo | Coordinated, rhythmic  |
| Investor Relations | Gold   | Smooth, communicative  |
| Portfolio Ops      | Green  | Grounded, operational  |
| Diligence          | Red    | Sharp, investigative   |
| Fund Admin         | Silver | Structured, methodical |

Each avatar responds to WebSocket events in real time — spawning, executing, handing off, and awaiting approval visually.

---

## Local Development

Prerequisites: **Node 20+**, **npm**, and the **Supabase CLI**.

```bash
npm install                 # install dependencies
cp .env.example .env.local  # fill in Supabase URL + keys
npm run db:start            # local Postgres + Auth + Realtime; applies migrations + seed
npm run dev                 # http://localhost:3000
```

`npm run typecheck` and `npm run lint` keep the tree healthy. See
[`CONTRIBUTING.md`](./CONTRIBUTING.md) for the build-order discipline and
migration workflow.

---

## Roadmap

- [x] Frontend scaffold (Next.js + Tailwind)
- [x] Database schema + RLS (versioned migrations)
- [x] Auth + organization onboarding
- [x] Backend API (prompt → plan → approve → automate loop)
- [x] WebSocket event gateway (Realtime over `task_events`)
- [x] **Real AI agent engine** — Claude-powered multi-step plans (`claude-opus-4-8`)
- [x] **AI Agent Copilot** — primary surface (prompt → plan → step cards → approve & automate)
- [x] **Command Center dashboard** — organizes the Copilot's output
- [x] Product visual system (warm-black/gold, Space Grotesk / DM Sans / JetBrains Mono)
- [x] Build Hub — Profile module
- [x] **Surface step deliverables as first-class artifacts** (IC memos, models, risk reports)
- [x] **Persist deals/assets from workflows** so the Command Center populates from real work
- [x] **Capital Map** — relationship temperature, thesis fit, warm-intro pathfinding + gated next actions (Affinity, rebuilt native)
- [x] **Gate layer** — Tier 1/2/3 control primitive so no action reaches a counterparty without sign-off
- [x] **Unified Inbox** — one AI-triaged stream for booking, messaging, and video; gated next actions, deep links into Command Center context, and a dashboard digest (mock-or-real channel adapters: Gmail, Slack, Calendly, Google Calendar, Zoom, Google Meet)
- [ ] Three-graph data architecture (query layer + `/graph/*`)
- [ ] Three.js avatar workspace
- [ ] Remaining Source / Run / Execute hub modules
- [ ] Build Hub — Profile, Thesis, Entity modules
- [ ] Source Hub — LP Pipeline, Deal Pipeline
- [ ] Run Hub — Underwriting, Diligence, Stress Test
- [ ] Execute Hub — Capital Events, Asset Management, Reporting
- [ ] Marketplace layer
- [ ] Public beta

---

## Contributing

This is an **open build**. If you've felt the same pain in private markets — or if you're a developer who wants to work on something with real-world complexity and domain depth — this is the place.

**We are actively looking for:**
- Full-stack engineers (Next.js / Node / Python)
- AI/ML engineers (agent orchestration, LLM integration)
- Private-market operators willing to test and give feedback
- Designers with experience in data-dense interfaces

### To contribute:

1. Fork the repository
2. Check open issues and the roadmap
3. Open a discussion before starting large features
4. Submit a pull request with a clear description

Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before submitting.

---

## Philosophy

> *Every tool in private markets was built to solve one problem. FundExecs OS is built to solve the system.*

This platform is designed with three commitments:

1. **No external dependencies for core intelligence** — AI agents, graphs, and workflows run natively inside the platform.
2. **Operators first** — every design decision is made through the lens of someone who has actually run a deal or managed an LP relationship.
3. **Transparency** — built in public, versioned openly, governed by a clear contribution model.

---

## License

MIT License — see [`LICENSE`](./LICENSE) for details.

---

## Contact

Built by a private-market operator.
Questions, partnerships, or early access: **[your contact / email / Twitter]**

---

*FundExecs OS is pre-alpha. The architecture is designed. The build has begun. If you see what this becomes — come build it.*

![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/Bey-Group-International/fundexecs-os?utm_source=oss&utm_medium=github&utm_campaign=Bey-Group-International%2Ffundexecs-os&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews)
