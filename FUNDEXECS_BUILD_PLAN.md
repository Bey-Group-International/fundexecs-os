# FundExecs OS — Build Plan (Competitive Synthesis → Live Product)

Source of truth for the multi-agent build that turns the competitive-synthesis
prototype into shipped capability **inside the live app** (not a rebuild).

> **Positioning.** Legacy platforms help established firms manage what already
> exists. FundExecs OS helps emerging managers become institutional before the
> market gives them permission. **BGI Fund I is the proof; FundExecs OS is the
> scalable product. Earn is the front door.**

---

## 1. Adoption approach (decided)

- **Extend the live Next.js app** — keep the working auth/RLS/integrations/Earn
  stack. Port the prototype's _ideas and visuals_ into the existing design
  system module by module. Do **not** drop the bundled prototype in as-is.
- **Adopt the demo dashboard**, reconciling the **current side rail + the demo's
  side rail into one intentional navigation**, optimized for **use and execution
  per user type** (each member type gets a purpose-built desk, not a generic one).
- Everything stays **Earn-guided** and connected to the capital-formation pathway.

## 2. Agent split (decided)

| Agent        | Lane                                                                                                      | Branch prefix |
| ------------ | --------------------------------------------------------------------------------------------------------- | ------------- |
| **Claude**   | Core app, Earn wiring, data model, auth/RLS, the Diligence Intelligence Layer orchestration, review/merge | `claude/*`    |
| **Emergent** | Net-new UI from its prototype: **LP Room**, the **demo dashboard + unified side rail** visuals            | `emergent/*`  |
| **Codex**    | Backend/data: diligence document ingest + RAG, scoring functions, migrations                              | `codex/*`     |

Coordination: feature branches → squash-merge to `main` after CI green
(format, typecheck, lint, build). Keep the 15 AI-brain slugs stable; migrations
additive + idempotent; secrets server-side. No "cleanup"/destructive passes
without explicit sign-off.

## 3. What already exists vs. net-new

| Capability (prompt)                                          | Live today                                                | Status                       |
| ------------------------------------------------------------ | --------------------------------------------------------- | ---------------------------- |
| Earn copilot (orb/dock/chat, 15 specialists)                 | `EarnOrb`/`EarnDock`/`ask-earn`                           | ✅ adopt/reframe             |
| LP Capital Map (Affinity)                                    | `/connections` (warmth scoring, warm intros)              | ✅ extend                    |
| Capital Formation Command Center (DealCloud)                 | `/command-center` + `/pipeline`                           | ✅ extend                    |
| Thesis cadence / task engine                                 | `/strategy` (100/30/10), notifications, next-best-actions | ✅ extend                    |
| Meeting copilot ingest (Zocks)                               | integrations (Gmail/Cal/Zoom/Meet/Slack/Calendly)         | 🟡 add flow                  |
| Fund Readiness spine (Carta)                                 | Chain of Trust / Proof of Truth                           | 🟡 reframe as Fund Readiness |
| Earn front-door routing                                      | member-type onboarding                                    | ✅ extend                    |
| **Earn Diligence Brain + 7-agent layer**                     | Voyage RAG over 15 brains                                 | 🟡 extend to user docs       |
| LP Fit / Fund Readiness / Outreach / Deck review / Objection | partial inputs exist                                      | 🟡 build flows               |
| **LP Room / Fund Room** (Juniper Square)                     | —                                                         | 🔴 new (Emergent)            |
| **Commitment-to-Close tracker** (Passthrough)                | allocations table                                         | 🔴 new                       |
| Target Company Scout (Grata)                                 | Apollo integration                                        | 🔴 new                       |
| Business Submission Intake                                   | —                                                         | 🔴 new                       |
| ⌘K command palette                                           | top-nav search                                            | 🔴 new                       |
| Pricing/billing tiers                                        | —                                                         | ⏸ deferred                   |

≈ **60% has a real foundation; ~40% net-new.**

---

## 4. Centerpiece — Earn Diligence Intelligence Layer (7 agents)

**Promise:** Ask your fund/deal documents what matters — and get an
institutional-grade answer. _Six layers automate; the seventh is why you get paid._

**Inputs (Supabase Storage → ingest → chunk → Voyage embeddings):** decks, CIMs,
PPMs, DDQs, financials, operating agreements, call notes, business submissions,
LP objections.

**Pipeline:** per-agent Claude prompts run over retrieved context, each emitting
a structured finding + a 0–100 sub-score + cited evidence; the Synthesis agent
weighs them into the memo + recommendation + conviction score.

| #   | Agent                            | Automates                                              | Output                                                                   |
| --- | -------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| 1   | **Market Size**                  | TAM/SAM/SOM, growth, tailwinds                         | sizing + growth thesis, score                                            |
| 2   | **Competitive Intelligence**     | incumbents, moats, positioning, threats                | competitive map, score                                                   |
| 3   | **Customer & Demand**            | demand signals, retention, concentration, pipeline     | demand quality, score                                                    |
| 4   | **Pricing & Unit Economics**     | pricing power, margins, CAC/LTV, payback               | unit-economics read, score                                               |
| 5   | **Stress Test**                  | downside scenarios, sensitivities, break-evens         | resilience, score                                                        |
| 6   | **Red Flags**                    | inconsistencies, gaps, governance/legal/financial risk | risk register, score                                                     |
| 7   | **Synthesis** _(the paid layer)_ | weighs 1–6 into judgment                               | **IC-grade memo, recommendation, conviction 1–100, follow-up questions** |

**Wiring:** a diligence run attaches to a pipeline **deal** and writes evidence
into **Chain of Trust** (Proof of Concept / Execution layers), so diligence
_compounds_ the auditable record. Outputs surface in the deal drawer + a new
"Diligence" surface, all invokable from Earn ("review this deck like an
institutional LP").

**Data model (Codex):** `diligence_runs` (deal_id, status, conviction, created_by),
`diligence_documents` (run_id, storage_path, kind), `diligence_findings`
(run_id, agent, score, summary, citations jsonb). RLS: org-scoped, members read,
service-role writes from the orchestrator.

---

## 5. Roadmap (priority order, per decisions)

**Sprint 1 — Fast wins on existing data (Claude)**
LP Fit Score · Fund Readiness Score · Investor Outreach Generator · Deck/Memo
Review · Objection Handling Assistant — all Earn-driven over current data.

**Sprint 1 (parallel) — Dashboard + unified side rail (Emergent + Claude)**
Adopt demo dashboard visuals; merge the two side rails into one; per-user-type
desks built on the existing 5 member-type layouts.

**Sprint 2 — Earn Diligence Intelligence Layer (Claude orchestration + Codex data)**
Doc upload → ingest/RAG → 7 agents → synthesis memo → Chain-of-Trust wiring.

**Sprint 2 (parallel) — LP Room for BGI Fund I (Emergent)**
Fund overview, document vault, update feed, commitment tracker, LP Q&A (Earn over
approved materials only).

**Sprint 3 — Commitment-to-Close tracker (Claude + Codex)**
Soft-circle → diligence → subscription prep → closing checklist → post-close,
extending allocations.

**Later** — Target Company Scout, Business Submission Intake, ⌘K palette, billing.

---

## 6. Pricing (deferred build; reference only)

Tiers: **Standard / Pro / Institutional** (80%-off early pricing as specified).
**BGI Capital Room is NOT a paid tier** — it is an internal, application-based
surface for the **BGI team** (and strategic LPs/partners/operators/targets it
routes), not a public price point. Billing (Stripe + gating) is built _after_ the
product modules deliver value.

---

_Maintained by the Claude session. Owns the agreed scope from the competitive-
synthesis prompt + the uploaded prototype; updated as modules land._
