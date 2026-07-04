# FundExecs Technologies — Pitch Deck

*Confidential · July 2026 · Seed round*

> Format note: this is the deck in narrative form, one section per slide. Each slide states the headline and the supporting content that appears on it.

---

## Slide 1 — Title

**FundExecs OS**
*The AI-native operating system for private capital.*

Fifteen AI executives. One system of record. Nothing ships without your approval.

FundExecs Technologies · Seed round · July 2026

---

## Slide 2 — The problem

**Private-market operators don't drown in decisions. They drown in the information movement before them.**

- A typical GP runs on **30+ disconnected tools**: DealCloud, Carta, Affinity, Juniper Square, Excel, Notion, Slack, Zapier…
- ~**80% of operator time** is spent moving information between them; ~20% on the decisions that create value.
- Founder's lived experience: 4+ years advising PE funds and family offices, **3 hours a day** sourcing deals that turned out to be smoke and mirrors.
- None of these tools share context. None of them get smarter over time.

---

## Slide 3 — The insight

**The work in private markets is executable.** Sourcing, screening, underwriting, diligence memos, LP updates, capital calls, waterfall math — these are structured workflows with known inputs and outputs.

Agentic AI can now *own* these workflows end-to-end. But operators will only delegate if two conditions hold:

1. **Control** — nothing reaches an LP, a seller, or a lender without sign-off.
2. **Memory** — the work has to compound into a system of record, not evaporate in a chat window.

No incumbent is built for either. That is the opening.

---

## Slide 4 — The product

**FundExecs OS: one operating system, four hubs, fifteen agents, three graphs.**

- **Four hubs** cover the full lifecycle: **Build** (identity, thesis, brand) → **Source** (LP + deal pipeline, capital partners) → **Run** (diligence, underwriting, stress tests) → **Execute** (closing, capital events, asset management, reporting, exit).
- **Fifteen AI agents** organized as an executive team, coordinated by **Earn**, the orchestrator: state an objective in plain language, get an ordered multi-agent plan, approve it, and receive durable deliverables — IC memos, pro formas, risk reports, LP updates.
- **Three native graphs** — Relationship, Deal, Capital — every workflow enriches who-knows-whom, deal state, and capital intelligence.

*Demo line: "Source multifamily targets in Texas under $50M" → Earn plans it → agents execute → deliverables and a pipeline deal appear in the Command Center.*

---

## Slide 5 — The trust architecture (why operators adopt)

**Approval-gated by default. Autonomous by choice. Auditable always.**

- The sacred loop: `prompt → plan → approve → execute → deliver → record`.
- Tiered gate layer: no action reaches a counterparty without sign-off.
- **Automations**: save an instruction once; trusted automations run unattended on schedule — the operator opts in to autonomy, never gets bypassed by default.
- Every run leaves typed, provenance-tracked artifacts; org-scoped row-level security on every table; full audit logging.

---

## Slide 6 — What's built (this is code, not a concept)

- ✅ Full Postgres/Supabase schema — **66+ versioned migrations**, RLS everywhere, multi-tenant
- ✅ Live Claude-powered planning + execution loop with deterministic fallback
- ✅ Fifteen-agent catalog with per-agent knowledge bases and operator-feedback learning
- ✅ Artifacts as first-class records; completed workflows seed Deals and Assets automatically
- ✅ Capital Map (relationship temperature, thesis fit, warm-intro pathfinding)
- ✅ Unified Inbox, data room, investor portal, valuations, outreach sequences
- ✅ Scheduled Automations, team task loop, live billing (plans + credit packs)
- 🔧 In flight: three-graph query layer, remaining hub modules, marketplace, 3D agent workspace

---

## Slide 7 — Market

**Private markets are the largest under-softwared professional vertical.**

- ~**$15T** global private-market AUM; **18,000+ GPs** and **10,000+ family offices** worldwide.
- Front-to-back software spend for private markets estimated in the **$10B+ range and growing double digits** — before the AI-labor budget shift.
- The real prize: AI agents don't compete for the software budget, they compete for the **analyst/associate/IR payroll budget** — 10–50x larger per firm.
- Beachhead: **lower-middle-market GPs, emerging managers, independent sponsors, and family offices** — massive in count, underserved by enterprise incumbents priced at $50K–$250K/yr.

(Full sizing: document 10.)

---

## Slide 8 — Competition

**Everyone owns a fragment. Nobody owns the loop.**

|     Category      |           Players           |    What they are    |                     What they aren't                     |
|-------------------|-----------------------------|---------------------|----------------------------------------------------------|
| Deal CRM          | DealCloud, Affinity, Dynamo | Pipeline databases  | Don't do the work                                        |
| Fund admin        | Carta, Juniper Square       | Back-office records | No sourcing, no diligence                                |
| AI research       | Hebbia, AlphaSense          | Document Q&A        | No execution, no system of record                        |
| Horizontal glue   | Notion, Slack, Zapier       | Generic tools       | No domain model, no compounding                          |
| Horizontal agents | Generic AI agent platforms  | Broad autonomy      | No private-markets domain, no approval-gated trust model |

**FundExecs OS is the only AI-native, approval-gated, full-lifecycle OS purpose-built for private-market operators.** (Full analysis: document 11.)

---

## Slide 9 — Business model

- **SaaS + usage:** per-seat plans with metered agent-execution credits. Live in-product today: Starter / Pro / Scale + credit packs (early-access pricing; institutional repricing as value lands).
- **Expansion layers:** marketplace take-rate, data/API grants, and a specified access-reputation-attestation layer that makes standing and verified outcomes portable — deepening lock-in with every closed deal.
- Model dynamics: credits tie revenue to work performed; agents doing more work = revenue expansion without sales touches.

---

## Slide 10 — Go-to-market

**Wedge: capital formation for emerging managers — the moment of maximum pain and budget.**

1. **Design partner in-house:** BGI Fund I (a $100M lower-middle-market PE platform) runs its raise on FundExecs OS — live proving ground, demanding user, credible case study.
2. **Founder-led sales into the founder's world:** LMM GPs, independent sponsors, family offices — reached through capital-formation salons ("The $100M Room" format), advisory networks, and warm paths already mapped in the Capital Map.
3. **Product-led expansion:** demo seed + guided tour make the product self-demonstrating; credits create a natural free-to-paid ramp.

(Full plan: document 12.)

---

## Slide 11 — Why we win

1. **Operator-founder** — the product is built through the lens of someone who has run deals and LP relationships, with a live fund as the first customer.
2. **Architecture head start** — event-driven task engine, artifact provenance, approval gates, and three graphs are foundational here; incumbents must rebuild to match.
3. **Compounding data moat** — every workflow enriches the graphs and the org's Brain; switching cost grows with every deliverable.
4. **Trust as product** — approval gates + audit trails are what makes fiduciaries adopt AI at all.

---

## Slide 12 — Team

- **Sheik Astin Simmons-Bey — Founder.** 4+ years running advisory for PE funds and family offices; founder of Bey Group International; architect and operator of the BGI Fund I capital formation program. Built FundExecs OS from schema to shipped agent loop.
- **Hiring with this round:** founding full-stack engineers (Next.js/Node), AI engineer (agent orchestration), design partner success lead. (See document 09.)

---

## Slide 13 — Financial snapshot

Illustrative plan (full model: document 08):

|                  |  Y1   |  Y2   |  Y3   |   Y4   |  Y5   |
|------------------|-------|-------|-------|--------|-------|
| Customers (orgs) | 40    | 160   | 450   | 1,000  | 1,900 |
| ARR              | $0.3M | $1.4M | $5.0M | $13.5M | $28M  |

Drivers: institutional pricing tiers, credit expansion as agents take on more of the work, marketplace and data layers from Y3.

---

## Slide 14 — The ask

**$2.5M seed** · 21–24 months runway

|                     Use                      |  %  |
|----------------------------------------------|-----|
| Product & engineering                        | 55% |
| GTM & design-partner success                 | 20% |
| Founder & ops                                | 15% |
| Infrastructure, AI compute, legal/compliance | 10% |

**Milestones:** GA of the four-hub platform → 25+ paying orgs → ~$1M ARR run-rate → Series A position.

---

## Slide 15 — Closing

**Every tool in private markets was built to solve one problem. FundExecs OS is built to solve the system.**

The firms of the next decade will run on an AI executive team. We're building the operating system they'll run it on.

*sheikastinsimmonsbey@gmail.com*
