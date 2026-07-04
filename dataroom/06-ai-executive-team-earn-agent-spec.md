# The AI Executive Team & the Earn Agent — Specification

*Confidential · July 2026*

---

## 1. Concept

FundExecs OS does not ship "AI features." It ships an **executive team**: fifteen named agents, each owning a domain of private-market work, coordinated by one orchestrator — **Earn**. The operator's mental model is managerial, not technical: you brief an executive team, review its plan, approve, and receive work product.

Three properties make this trustworthy enough for fiduciaries:

1. **Every agent action flows through the approval-gated task loop** (document 05, §4).
2. **Every step produces a typed, provenance-tracked artifact** — the work is inspectable and durable.
3. **The team learns from the operator** — accept/reject signals and feedback are recorded in an `operator_feedback` ledger and injected into future runs.

## 2. The roster

### Orchestration

| Agent | Role | Capabilities |
|---|---|---|
| **Earn** | Coordinates workflows and task execution across all hubs — the operator's chief of staff | orchestration · routing · handoff · task management |

### Run hub

| Agent | Role | Capabilities |
|---|---|---|
| **Analyst** | Ingests deal data, financials, market comps; produces pro formas and valuations | pro_forma · valuation · sensitivity · comps |
| **Diligence** | Parses documents, flags risks, produces diligence memos | doc_parsing · risk_flags · diligence_memo |

### Execute hub

| Agent | Role | Capabilities |
|---|---|---|
| **Investor Relations** | LP communications, capital calls, reporting | lp_comms · capital_calls · reporting |
| **Portfolio Ops** | Asset KPIs, budgets, capex, variance alerts | kpis · budgets · capex · variance |
| **Fund Admin** | Waterfall calculations, fund accounting, audit prep | waterfall · fund_accounting · audit_prep |

### Source hub

| Agent | Role | Capabilities |
|---|---|---|
| **Executive Advisor** | Researches investors, family offices, and partners before first contact | investor_research · targeting · relationship_intel · first_contact |
| **Capital Raiser** | LP fundraising and capital formation campaigns; founding-circle and anchor-LP pipelines | lp_fundraising · capital_formation · founding_circle · investor_pipeline |
| **Capital Connector** | Deal financing and capital-stack structuring; lender and equity-partner selection | deal_financing · capital_stack · lender_relations · sponsor_finance |
| **Deal Sourcer** | Identifies acquisition targets; structures creative financing; positions the buyer | deal_flow · acquisition_strategy · seller_outreach · creative_financing |
| **Rainmaker** | Converts high-value prospects into commitments; qualification and closing | prospect_conversion · capital_closing · qualification · outreach_sequencing |

### Build hub

| Agent | Role | Capabilities |
|---|---|---|
| **Lead Generator** | Digital funnels capturing investors, owners, operators, connectors | funnel_design · lead_capture · crm_integration · campaign_ops |
| **PR Director** | Investor materials, pitch decks, CIMs, executive summaries, brand narrative | investor_materials · pitch_decks · cim · brand_narrative · pr |
| **SEO Disruptor** | Search authority and organic lead generation | seo_strategy · content_authority · organic_leads · category_creation |
| **Curator** | Private investor rooms and capital-formation salons; post-event conversion | event_curation · private_rooms · rsvp_management · post_event_conversion |

Each agent has a color and motion identity for the live workspace (e.g., Analyst — cyan, precise; Diligence — red, investigative), a seeded catalog row, and a domain knowledge base ("Brain").

## 3. Earn — the orchestrator specification

Earn is the intelligence that turns an operator's objective into coordinated, gated, durable work. It is governed by a living development prompt (`AGENT.md`) whose prime directive is:

> *"Does this save a private-market operator time they would otherwise spend moving information?" If yes, build/do it. If no, question it.*

### 3.1 Responsibilities

1. **Intent → plan.** Parse the operator's prompt (or a fired automation's instruction), route it to the right hub, and materialize a **workflow**: a parent task with ordered child steps, each assigned to the right specialist agent. Planning uses structured LLM outputs with a deterministic fallback.
2. **Gatekeeping.** Present the plan for approval. Execute nothing counterparty-facing without sign-off; respect the Tier 1/2/3 gate layer. Trusted automations with `auto_approve` may run unattended — an explicit, per-automation, revocable operator grant.
3. **Execution management.** Run steps in order, stream progress events, manage inter-agent handoffs (implicit in multi-agent step plans), and classify + persist each step's output as a typed artifact.
4. **Record-keeping.** On workflow completion, seed or update system-of-record entities (Source → Deal, Execute → Asset) with structured field extraction; idempotent on re-approval.
5. **Learning.** Read the learned operator digest (from `operator_feedback`) before planning; record acceptance/rejection signals after execution; carry sourcing-preference signals into target generation.
6. **Human coordination.** Own the team task loop: work assigned to human principals surfaces in the Earn dock, launches through the same session loop, and completion feeds learning.

### 3.2 Session model

Operators interact with Earn in **sessions** — a conversation theater with a live 2D workspace: clickable agent avatars, status/progress lanes, computation panels, an active-model display, attachment manifests, and voice transcript capture. Sessions can be pinned, carry unread state, and link to the tasks and artifacts they produce.

### 3.3 Automations ("agents that own the work")

An automation = **a natural-language instruction + a trigger + an `auto_approve` flag**.

- Triggers live today: cron schedule (hourly sweep via a secret-guarded endpoint, per-sweep spend cap) and manual run-now. Reserved by design: email, webhook, internal-event.
- A fired trigger plans the instruction through the same `materializePlan` path as a live prompt; trusted automations execute end-to-end, untrusted ones queue the normal approval gate.
- Every run links back to its automation for audit (`tasks.automation_id`).

### 3.4 Constraints (what Earn must never do)

- ❌ Bypass the task loop or the approval gate for counterparty-facing actions
- ❌ Import external SDKs for core intelligence — agents, graphs, and workflows are native
- ❌ Treat chat as the record — every meaningful step must leave a typed artifact
- ❌ Act on the graphs without emitting the corresponding events

### 3.5 Learning & memory architecture

| Layer | Mechanism | Status |
|---|---|---|
| Domain knowledge | Per-agent Brain knowledge bases (reference corpus) | Live |
| Operator preference | `operator_feedback` ledger + learned digest injection | Live |
| Sourcing personalization | Accepted/rejected candidate signals with fit scores | Live |
| Org memory | Vectorized recall of the org's own completed artifacts | Next (roadmap H2 2026) |

## 4. Cost and model governance

- Default execution model is cost-efficient (Haiku-class), overridable per deployment via `CLAUDE_MODEL`; planning/extraction use structured outputs at low effort where possible.
- Metered **credits** tie agent execution to billing (document 07) — usage-based cost passes through to usage-based revenue.
- Automation sweeps carry per-sweep caps to bound spend.

## 5. Why this design wins adoption

Fiduciaries do not adopt autonomy; they adopt **control with leverage**. The Earn spec operationalizes that: plans are visible before execution, autonomy is granted per-instruction and revocable, every output is a durable artifact with provenance, and the system demonstrably learns the operator's judgment. The result is an AI executive team an LP-facing firm can actually put in production.
