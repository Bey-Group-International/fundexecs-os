# Tool Integration Blueprint — Data, Search & Agent Infrastructure for FundExecs OS

> **Scope:** evaluation + feature-adoption blueprint for ~30 external tools, mapped onto
> the live FundExecs OS architecture (the Agentic Execution Layer shipped in Phase 1:
> Action Queue / `task_runs` spine, Desk Agent executors, the credits meter, Mandate
> Memory RAG over `knowledge_chunks`, the sourcing brief + match inbox, the 7-agent
> diligence orchestrator, and the provider-agnostic `integration_connections` layer).
>
> **Lenses (locked):** deliver as a repo doc; verify ambiguous tools against the web;
> frame every integration against real OS primitives; **weight priority toward
> sourcing + enrichment** — the nearest-term, highest-compounding wins that plug into
> the match inbox and sourcing brief already in `main`.
>
> **The six OS pillars:** Sourcing Intelligence · Diligence Acceleration · Execution
> Automation · Portfolio Operations · LP Relations & Distribution · Core Infrastructure.

---

## 0. The architectural recommendation that comes first

Most of the tools below fall into four interchangeable commodities — **web
search/RAG**, **contact/company enrichment**, **deal signals**, and **scraping**. Wiring
30 vendors one-by-one is the wrong shape. Two structural moves make everything else
cheaper and reversible:

1. **Adopt a provider-agnostic adapter per category, not per vendor.** FundExecs already
   has this pattern in `lib/integrations/` + `integration_connections`. Define four
   internal interfaces — `EnrichmentProvider`, `WebResearchProvider`, `SignalProvider`,
   `ScrapeProvider` — and let vendors be swappable implementations behind them. Every
   call is metered (`meterAction`) and audited (`trust_events`), so cost and provenance
   are uniform regardless of vendor.

2. **Front the commodity vendors with a unified API where one exists.** **Orthogonal**
   (orthogonal.com) is a single pay-per-call endpoint for GTM/investor/enrichment data
   that aggregates many of the vendors below; **Dome** is the same idea for prediction
   markets. Integrating one aggregator buys breadth on day one and lets you A/B vendors
   without code churn — then drop to a direct vendor only where depth/price justifies it.

This blueprint therefore scores aggregators and the adapter-fit tools highest.

---

## 1. Master table

Priority 1–5 (5 = ship first): weighted on immediate value · ease of integration ·
compounding effect · roadmap fit (sourcing/enrichment-biased).

| Tool                         | Function                                                                               | OS Pillar(s)                | Proposed features                                                                      | User value                                         | Priority |
| ---------------------------- | -------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------- | -------- |
| **Orthogonal**               | Unified pay-per-call API aggregating GTM/investor/enrichment vendors for agents        | Core Infra · Sourcing       | One adapter → many enrichment/search vendors; vendor A/B; metered passthrough          | One integration, many sources; no per-vendor churn | **5**    |
| **Exa**                      | Neural/embeddings web search + page-contents API built for RAG                         | Diligence · Sourcing        | Diligence web-research executor; "find similar companies"; RAG ingestion               | Evidence-grounded research at agent speed          | **5**    |
| **People Data Labs**         | Person + company data enrichment (B2B dataset, enrich + search)                        | Sourcing · LP Relations     | Contact/company enrichment pipeline; LP/contact backfill; firmographic match factors   | Clean, deduped records feed match scoring + IR     | **5**    |
| **Apollo**                   | Sales-intelligence DB + engagement (contacts, intent, sequences)                       | Sourcing · Execution        | Deepen the existing Apollo adapter: intent signals → sourcing brief; sequence drafts   | Already wired; deepening compounds fast            | **5**    |
| **Crustdata**                | Real-time company + people data API (headcount, jobs, firmographics)                   | Sourcing · Portfolio Ops    | Portfolio headcount/hiring monitor; real-time firmographic match factor; growth alerts | Live company health without manual pulls           | **4**    |
| **Perplexity**               | Web-grounded AI answer engine (Sonar API) with citations                               | Diligence · Sourcing        | "Quick read" research answers in deal/diligence; market-map Q&A                        | Cited answers in seconds, in-context               | **4**    |
| **Parallel**                 | Deep-research + search API for agents, evidence-backed with provenance                 | Diligence                   | Long-running diligence research runs; memo evidence with source provenance             | Provenance maps onto Chain of Trust                | **4**    |
| **Hunter.io**                | Email finder + verifier (domain search, verification)                                  | Execution · LP Relations    | Verify LP/contact emails before send; find decision-maker emails for outreach          | Higher deliverability, fewer bounces               | **4**    |
| **Coresignal**               | Large firmographic / employee / job-posting datasets                                   | Sourcing · Portfolio Ops    | Bulk sourcing universe; employee-growth signal; competitor headcount maps              | Breadth for top-of-funnel + monitoring             | **4**    |
| **PredictLeads**             | Company buying/growth signals: news, jobs, technologies, partnerships                  | Sourcing Intelligence       | Signal feed → sourcing brief proposals; "company is hiring/expanding" alerts           | On-thesis timing signals, automated                | **4**    |
| **Aviato**                   | Private-market people + company data (funding, headcount, revenue, vesting)            | Sourcing · Diligence        | Private-market enrichment for deal cards; comps + funding-history in memo              | Purpose-built private-market depth                 | **4**    |
| **SixtyFour**                | AI people/company intelligence agents + enrichment API                                 | Sourcing · Diligence        | Agentic "research this company/person" executor; gap-filling enrichment                | Finds prospects conventional tools miss            | **4**    |
| **Jina (Search Foundation)** | Embeddings, reranker, Reader (URL→LLM text), DeepSearch                                | Core Infra · Diligence      | Cheap embeddings/reranker for RAG; Reader for clean doc/URL ingestion                  | Lower-cost RAG infra; better recall                | **4**    |
| **AgentMail**                | Programmatic email inboxes built for AI agents (send/receive/webhooks)                 | Execution · LP Relations    | Per-agent inbox so outreach/IR agents send + parse replies; reply-driven workflows     | True autonomous, two-way email loops               | **4**    |
| **Textbelt**                 | Simple SMS-sending API                                                                 | Execution · LP Relations    | Capital-call / notice SMS nudges; approval + 2FA codes; deadline reminders             | Time-sensitive nudges that get read                | **4**    |
| **Tavus**                    | AI-generated personalized + conversational video (digital twins)                       | LP Relations & Distribution | Personalized LP video updates; a conversational "fund concierge" avatar                | High-touch LP experience at scale                  | **4**    |
| **Nyne**                     | Agent-native people-data company (real-time person signals, life events, webhooks)     | Sourcing · LP Relations     | Real-time contact-change webhooks → CRM; life-event triggers for IR outreach           | Relationships stay fresh automatically             | **3**    |
| **Tomba**                    | Email finder + verifier (Hunter alternative)                                           | Execution · LP Relations    | Fallback in the email-find/verify waterfall behind Hunter                              | Coverage + redundancy on email data                | **3**    |
| **ContactOut**               | Email/phone finder (LinkedIn-oriented contact data)                                    | Sourcing · Execution        | Phone/email enrichment for warm-intro + outreach targets                               | Adds phone channel + coverage                      | **3**    |
| **Captain Data**             | No-code data extraction + GTM automation (LinkedIn/Sales Nav, multi-source)            | Sourcing · Execution        | Prebuilt LinkedIn/Sales-Nav extraction + multi-step enrichment workflows               | Fast-to-stand-up sourcing automations              | **3**    |
| **FiberAI**                  | AI outbound/prospecting automation (waterfall enrichment + outreach)                   | Execution · Sourcing        | Waterfall enrichment + sequenced outreach behind the outreach agent                    | One pipe for find→verify→send                      | **3**    |
| **Linkup**                   | Web search API for LLMs (grounded answers + sources)                                   | Diligence · Sourcing        | Alt/secondary `WebResearchProvider` behind the research interface                      | Vendor diversity, EU-data option                   | **3**    |
| **Seltz**                    | Web search/knowledge optimized for LLMs + RAG (clean structured web)                   | Diligence · Core Infra      | Clean-web ingestion for `knowledge_chunks`; RAG-ready research                         | Less noise into the RAG layer                      | **3**    |
| **Olostep**                  | Fast web-scraping API for AI (any URL → markdown, at scale)                            | Diligence · Core Infra      | Bulk page → markdown ingestion for diligence/data-room enrichment                      | Scale ingestion without scraper upkeep             | **3**    |
| **Brand.dev**                | Brand data API (logo, colors, fonts, description from a domain)                        | LP Relations · Core Infra   | Auto-brand deal rooms / materials / public raise pages from a domain                   | Polished, on-brand surfaces, zero effort           | **3**    |
| **Tako**                     | Knowledge-search API returning embeddable, cited data-viz cards                        | Diligence · LP Relations    | Embed live cited charts in memos, dashboards, LP updates                               | Trusted visuals without a charting build           | **3**    |
| **Notte**                    | Web-browser automation API for AI agents (act on the web)                              | Execution · Diligence       | Gated browser-agent runs for portal data pulls / form fills                            | Reach data with no API — carefully gated           | **3**    |
| **ScrapeCreators**           | API for social/creator data across platforms (TikTok, IG, YouTube, X)                  | Diligence · Sourcing        | Consumer-brand traction signals; founder/creator footprint in diligence                | Demand signal for consumer deals                   | **2**    |
| **Dome AI**                  | Unified API for prediction markets (Polymarket, Kalshi)                                | Sourcing Intelligence       | Prediction-market odds as a macro/event alt-signal in the intelligence feed            | Differentiated, niche market signal                | **2**    |
| **Fundable**                 | Startup fundraising / crowdfunding platform (company + raise pages)                    | Sourcing Intelligence       | Crowdfunding raises as an inbound deal-source feed                                     | Extra top-of-funnel; niche quality                 | **2**    |
| **Influencers Club**         | Creator/influencer data + consumer email enrichment                                    | Diligence (consumer)        | Creator-economy traction + audience data for consumer-brand diligence                  | Niche; only consumer mandates                      | **2**    |
| **Andi**                     | Consumer AI search/answer engine                                                       | Diligence                   | Tertiary answer source; low enterprise/API fit                                         | Marginal vs Exa/Perplexity                         | **2**    |
| **Context**                  | Ambiguous — no single clear vendor identified ("context" maps to MCP / context layers) | TBD                         | Validate identity before scoping                                                       | Unknown until confirmed                            | **1**    |

---

## 2. Detailed analysis (grouped by category)

Each entry: **Function · Pillar · Proposed features · Value · Technical notes · Priority.**

### A. Unified data layer (integrate these first — they front many others)

#### Orthogonal — `Priority 5`

- **Function.** A unified, pay-per-call API that aggregates GTM/investor/enrichment data vendors behind one agent-native endpoint.
- **Pillars.** Core Infrastructure · Sourcing Intelligence.
- **Proposed features.** (1) A single `EnrichmentProvider`/`SignalProvider` implementation in `lib/integrations/` that fronts multiple underlying vendors; (2) vendor A/B + failover without app changes; (3) metered passthrough via `meterAction('enrichment')`.
- **Value.** GPs/analysts get broad data coverage immediately; the OS avoids 10+ separate vendor integrations and contracts.
- **Technical notes.** REST + pay-per-call (free starter credits); store the key in `integration_connections`; normalize responses into the internal `EnrichmentRecord` shape; no per-vendor auth to manage.
- **Why it leads.** Maximum compounding for minimum integration surface — the cleanest first move.

#### Dome AI — `Priority 2`

- **Function.** Unified API for prediction markets (Polymarket, Kalshi) — normalized odds + historical data.
- **Pillars.** Sourcing Intelligence (alt-signal).
- **Proposed features.** (1) Ingest event/odds shifts as `market_signals` rows; (2) surface macro/event probabilities in the intelligence feed for relevant theses.
- **Value.** A differentiated, forward-looking signal for macro- or event-sensitive mandates; niche for classic PE.
- **Technical notes.** REST + webhooks/websockets; map to the existing `market_signals` ingestion path; low volume.

### B. Web search, research & RAG (Diligence Acceleration)

#### Exa — `Priority 5`

- **Function.** Neural/embeddings web search + page-contents retrieval API designed for AI/RAG.
- **Pillars.** Diligence Acceleration · Sourcing Intelligence.
- **Proposed features.** (1) A **diligence web-research executor** (Action Queue run) that gathers cited sources into a diligence run; (2) "find similar companies" for sourcing off a seed company; (3) contents endpoint → `knowledge_chunks` ingestion.
- **Value.** Analysts get on-thesis sources and comparable-company sets in seconds, with links for the Chain of Trust.
- **Technical notes.** REST; pairs with Voyage embeddings already in the OS; rate-limited per key; cache results to control spend; meter `web_research`.

#### Perplexity — `Priority 4`

- **Function.** Web-grounded answer engine (Sonar API) returning cited answers.
- **Pillars.** Diligence · Sourcing.
- **Proposed features.** (1) "Quick read" Q&A inside a deal/diligence surface; (2) market-map / competitor-landscape questions in the Earn dock.
- **Value.** Fast, cited answers in-context — less tab-switching for GPs/analysts.
- **Technical notes.** REST chat-style API; never-block (degrade to no-answer); meter per query; store citations alongside answers.

#### Parallel — `Priority 4`

- **Function.** Deep-research + search APIs for agents, evidence-backed with source provenance.
- **Pillars.** Diligence Acceleration.
- **Proposed features.** (1) Long-running, multi-step diligence research runs that feed the memo; (2) provenance attached as Proof-of-Concept evidence.
- **Value.** Provenance-first output maps cleanly onto the Chain of Trust; depth beyond a single query.
- **Technical notes.** REST + SDKs + MCP; async/long-running → run as a gated Action Queue executor with status polling; meter `deep_research`.

#### Linkup — `Priority 3`

- **Function.** Web search API for LLMs with grounded answers + sources.
- **Pillars.** Diligence · Sourcing.
- **Proposed features.** Secondary `WebResearchProvider` behind the research interface for diversity / EU-data routing.
- **Value.** Vendor redundancy; regional data option.
- **Technical notes.** REST; swap-in under the research adapter; meter shared.

#### Seltz — `Priority 3`

- **Function.** Web search/knowledge optimized for LLMs — clean, structured, RAG-ready web data.
- **Pillars.** Diligence · Core Infrastructure.
- **Proposed features.** Clean-web ingestion feeding `knowledge_chunks` with less noise; MCP server option.
- **Value.** Higher-signal RAG corpus → better diligence answers.
- **Technical notes.** REST/MCP; route through the ingestion + embedding pipeline.

#### Jina (Search Foundation) — `Priority 4`

- **Function.** Embeddings, reranker, Reader (URL→clean text), DeepSearch, classifier APIs.
- **Pillars.** Core Infrastructure · Diligence.
- **Proposed features.** (1) Reader for clean URL/doc → text ingestion; (2) reranker to sharpen `match_knowledge_chunks` recall; (3) low-cost embeddings option alongside Voyage.
- **Value.** Cheaper, better RAG plumbing benefits every AI surface.
- **Technical notes.** REST; reranker slots in after vector retrieval; keep embeddings model consistent per corpus to avoid mixed vector spaces.

#### Olostep — `Priority 3`

- **Function.** Fast web-scraping API (any URL → markdown) at scale.
- **Pillars.** Diligence · Core Infrastructure.
- **Proposed features.** Bulk page → markdown ingestion for diligence/data-room enrichment behind a `ScrapeProvider`.
- **Value.** Scale ingestion without maintaining scrapers.
- **Technical notes.** REST; respect target ToS/robots; meter per page; dedupe by URL hash.

#### Tako — `Priority 3`

- **Function.** Knowledge-search API returning embeddable, cited data-visualization cards.
- **Pillars.** Diligence · LP Relations & Distribution.
- **Proposed features.** Embed live, cited charts ("funding history", "M&A", market size) into memos, dashboards, and LP updates.
- **Value.** Trusted, source-cited visuals with no in-house charting build.
- **Technical notes.** REST → JSON/iframe cards; sanitize embeds; cache; attribution preserved for Chain of Trust.

#### Andi — `Priority 2`

- **Function.** Consumer AI search/answer engine.
- **Pillars.** Diligence (tertiary).
- **Proposed features.** Optional tertiary answer source.
- **Value.** Marginal over Exa/Perplexity/Parallel; limited enterprise/API fit.
- **Technical notes.** Validate API availability before scoping; likely deprioritize.

### C. Contact & company enrichment (Sourcing + LP Relations) — the deepest near-term win

#### People Data Labs — `Priority 5`

- **Function.** Person + company data enrichment (large B2B dataset; enrich + search).
- **Pillars.** Sourcing Intelligence · LP Relations.
- **Proposed features.** (1) Enrichment pipeline that hydrates `contacts`/companies on create; (2) LP/contact backfill job; (3) firmographic fields feed `generate_signal_matches` factors.
- **Value.** Clean, deduped records make match scoring, warm-intro paths, and IR all sharper.
- **Technical notes.** REST enrich/search; respect PII handling + retention; store under `integration_connections`; meter `enrichment`; cache by canonical identity.

#### Apollo — `Priority 5` (already integrated — deepen)

- **Function.** Sales-intelligence database + engagement (contacts, companies, intent, sequences).
- **Pillars.** Sourcing · Execution.
- **Proposed features.** (1) Promote Apollo **intent signals** into the sourcing brief → Action Queue proposals; (2) draft outreach sequences for operator approval; (3) enrich match-inbox candidates.
- **Value.** It's already wired (`apollo_enrich` meter, paid-integration gating) — deepening is the fastest compounding move.
- **Technical notes.** Existing adapter + meter; add intent + sequence endpoints; keep all sends operator-gated (propose-only).

#### Crustdata — `Priority 4`

- **Function.** Real-time company + people data API (headcount trends, job postings, firmographics, decision-makers).
- **Pillars.** Sourcing · Portfolio Operations.
- **Proposed features.** (1) **Portfolio headcount/hiring monitor** with anomaly alerts → Command Center; (2) real-time firmographic match factor; (3) growth-spike sourcing signals.
- **Value.** Live company health and growth timing without manual pulls — strong for both sourcing and the Phase-2 portfolio-monitoring agent.
- **Technical notes.** REST + (near-)real-time; schedule via the existing intelligence cron; store deltas as `market_signals`/portfolio KPIs.

#### Coresignal — `Priority 4`

- **Function.** Large firmographic / employee / job-posting datasets (company, employee, jobs).
- **Pillars.** Sourcing · Portfolio Operations.
- **Proposed features.** (1) Bulk sourcing universe builder; (2) employee-growth + hiring signal; (3) competitor/portfolio headcount maps.
- **Value.** Breadth for top-of-funnel and ongoing monitoring.
- **Technical notes.** REST + bulk datasets; heavier volume → batch ingestion + dedupe; meter by record.

#### SixtyFour — `Priority 4`

- **Function.** AI people/company intelligence agents + a proprietary enrichment API.
- **Pillars.** Sourcing · Diligence.
- **Proposed features.** (1) An agentic "research this company/person" executor; (2) gap-filling enrichment behind the waterfall.
- **Value.** Surfaces prospects and context conventional tools miss.
- **Technical notes.** REST; agentic calls can be slow → run as gated Action Queue runs; meter per research.

#### Nyne — `Priority 3`

- **Function.** Agent-native people-data company — real-time person signals, life events, webhooks into CRM.
- **Pillars.** Sourcing · LP Relations.
- **Proposed features.** (1) Real-time contact-change webhooks → keep `contacts`/relationships fresh; (2) life-event triggers (job change, raise) → IR/outreach proposals.
- **Value.** Relationships and contact data stay current automatically.
- **Technical notes.** REST + webhooks; newer vendor → pilot behind the enrichment adapter; verify coverage before depth.

#### Hunter.io — `Priority 4`

- **Function.** Email finder + verifier (domain search + verification).
- **Pillars.** Execution · LP Relations.
- **Proposed features.** (1) Verify LP/contact emails pre-send (deliverability gate); (2) find decision-maker emails for approved outreach.
- **Value.** Fewer bounces, better sender reputation across IR + outreach.
- **Technical notes.** REST; cheap; cache + TTL on verifications; primary node in the email-find/verify waterfall.

#### Tomba — `Priority 3`

- **Function.** Email finder + verifier (Hunter alternative).
- **Pillars.** Execution · LP Relations.
- **Proposed features.** Fallback provider in the email waterfall behind Hunter.
- **Value.** Coverage + redundancy; price arbitrage.
- **Technical notes.** REST; same adapter as Hunter; meter shared.

#### ContactOut — `Priority 3`

- **Function.** Email/phone finder with LinkedIn-oriented contact data.
- **Pillars.** Sourcing · Execution.
- **Proposed features.** Phone/email enrichment for warm-intro and outreach targets (adds a phone channel for Textbelt).
- **Value.** Channel + coverage breadth for relationship building.
- **Technical notes.** REST; PII/consent handling; cache by identity.

#### Captain Data — `Priority 3`

- **Function.** No-code data extraction + GTM automation (LinkedIn/Sales Nav, multi-source enrichment, workflows).
- **Pillars.** Sourcing · Execution.
- **Proposed features.** Prebuilt LinkedIn/Sales-Nav extraction + multi-step enrichment workflows feeding the sourcing brief.
- **Value.** Fast-to-stand-up automations without building scrapers.
- **Technical notes.** REST + hosted workflows/webhooks; mind source-platform ToS; orchestrate via Action Queue.

#### FiberAI — `Priority 3`

- **Function.** AI outbound/prospecting automation (waterfall enrichment + outreach).
- **Pillars.** Execution · Sourcing.
- **Proposed features.** A single find→verify→send pipe behind the outreach agent (operator-gated sends).
- **Value.** Consolidates the outbound stack; overlaps Apollo/Captain Data — pick one primary.
- **Technical notes.** REST; keep sends propose-only; avoid double-metering overlapping vendors.

### D. Private-market & deal signals (Sourcing Intelligence)

#### Aviato — `Priority 4`

- **Function.** Private-market people + company data (funding rounds, headcount, revenue estimates, vesting) — a PitchBook/Crunchbase-style API.
- **Pillars.** Sourcing · Diligence.
- **Proposed features.** (1) Private-market enrichment on deal cards; (2) funding-history + comps auto-inserted into the IC memo; (3) thesis-fit prefilter.
- **Value.** Purpose-built private-market depth — core to a fund OS's sourcing and diligence.
- **Technical notes.** REST people/company API; map to deal + company records; meter per enrichment; reconcile identity with PDL/Crustdata.

#### PredictLeads — `Priority 4`

- **Function.** Company buying/growth signals: news events, job openings, technologies, partnerships.
- **Pillars.** Sourcing Intelligence.
- **Proposed features.** (1) Signal feed → sourcing-brief proposals ("hiring spike / new partnership on thesis"); (2) timing alerts on watched companies.
- **Value.** Turns the sourcing brief from a thesis match into a _timing_ engine.
- **Technical notes.** REST + webhooks; ingest as `market_signals`; route through `generate_signal_matches`; cron-scheduled.

#### Fundable — `Priority 2`

- **Function.** Startup fundraising / crowdfunding platform (company profiles + raise pages).
- **Pillars.** Sourcing Intelligence.
- **Proposed features.** Inbound deal-source feed of active raises matching the mandate.
- **Value.** Extra top-of-funnel; quality varies — niche.
- **Technical notes.** Confirm API/data availability (may require scraping → `ScrapeProvider`); low priority.

#### ScrapeCreators — `Priority 2`

- **Function.** API for social/creator data across platforms (TikTok, IG, YouTube, X).
- **Pillars.** Diligence (consumer) · Sourcing.
- **Proposed features.** Consumer-brand traction signals; founder/creator digital footprint in diligence.
- **Value.** Demand signal for consumer-facing deals; irrelevant for most B2B.
- **Technical notes.** REST; platform ToS care; gate to consumer mandates.

#### Influencers Club — `Priority 2`

- **Function.** Creator/influencer data + consumer email enrichment.
- **Pillars.** Diligence (consumer).
- **Proposed features.** Creator-economy traction + audience data for consumer-brand diligence.
- **Value.** Niche; only consumer mandates.
- **Technical notes.** REST; consumer-PII care; deprioritize for institutional PE.

### E. Communications & agent infrastructure (Execution · LP Relations · Core Infra)

#### AgentMail — `Priority 4`

- **Function.** Programmatic email inboxes built for AI agents (create inboxes, send/receive, webhooks).
- **Pillars.** Execution · LP Relations.
- **Proposed features.** (1) Per-agent inbox so the outreach/IR agents **send and parse replies**; (2) reply-driven Action Queue proposals ("LP replied — draft response"); (3) capital-call/notice send + bounce handling.
- **Value.** Upgrades agents from draft-only to genuine two-way email loops — the missing piece for autonomous IR/outreach.
- **Technical notes.** REST + inbound webhooks; DKIM/SPF + sending-domain setup; keep consequential sends operator-approved (propose-only, D3); log every send to `trust_events`.

#### Textbelt — `Priority 4`

- **Function.** Simple SMS-sending API.
- **Pillars.** Execution · LP Relations.
- **Proposed features.** (1) Capital-call / investor-notice SMS nudges; (2) approval + 2FA codes; (3) diligence/closing deadline reminders.
- **Value.** Time-sensitive nudges that actually get read; trivial to ship.
- **Technical notes.** REST one-call send; consent/opt-out tracking; meter per message; quiet-hours guard.

#### Tavus — `Priority 4`

- **Function.** AI-generated personalized + conversational video (digital twins / real-time avatars).
- **Pillars.** LP Relations & Distribution.
- **Proposed features.** (1) Personalized LP video updates generated from the quarterly report; (2) a conversational "fund concierge" avatar for the LP room.
- **Value.** High-touch, differentiated LP experience at scale — a standout vs dashboard-only competitors.
- **Technical notes.** REST + webhooks (async render); store/stream video via Storage; gate generation behind operator review; meter per render.

#### Notte — `Priority 3`

- **Function.** Web-browser automation API for AI agents (perceive + act on web pages).
- **Pillars.** Execution · Diligence.
- **Proposed features.** Gated browser-agent runs for portal data pulls / form fills where no API exists.
- **Value.** Reaches data behind no-API portals — powerful, but higher-risk.
- **Technical notes.** REST; run only as **explicitly gated** Action Queue executors with tight scopes + audit; never auto-authenticate to third-party accounts without consent.

### F. Brand & surfaces

#### Brand.dev — `Priority 3`

- **Function.** Brand data API (logo, colors, fonts, description from a domain).
- **Pillars.** LP Relations & Distribution · Core Infrastructure.
- **Proposed features.** Auto-brand deal rooms, generated materials, and public raise pages from a company domain.
- **Value.** Polished, on-brand surfaces with zero manual design.
- **Technical notes.** REST; cache brand assets; sanitize/whitelist image domains; cheap.

### G. Validate before scoping

#### Context — `Priority 1`

- **Function.** Ambiguous — web verification did not resolve a single clear vendor ("context" returns MCP / context-layer concepts, not one product).
- **Action.** Confirm the exact product/URL with the requester before scoping. Do not build against an unverified identity.

---

## 3. Recommended adoption sequence

**Wave 1 — Enrichment + research spine (compounds into match inbox + diligence).**
Orthogonal (or PDL + Apollo deepen directly) → Exa → Jina (Reader + reranker) → Hunter.io.
These light up the sourcing brief, match scoring, and the diligence research executor immediately.

**Wave 2 — Signals + private-market depth.**
PredictLeads + Crustdata + Aviato → richer, time-aware sourcing proposals and memo auto-fill;
Coresignal/SixtyFour for breadth.

**Wave 3 — Two-way comms + distribution.**
AgentMail (reply loops) + Textbelt (nudges) + Tavus (LP video) → turns draft-only agents into
autonomous IR/outreach and a standout LP experience.

**Wave 4 — Surfaces, scraping, niche, browser agents.**
Brand.dev, Olostep/Seltz/Linkup (research diversity), Tako (viz), Notte (gated browsing),
ScrapeCreators/Influencers Club/Fundable/Dome (mandate-specific signals). Validate Context first.

---

## 4. Cross-cutting technical requirements

- **Adapters, not vendors.** Four internal interfaces (`EnrichmentProvider`, `WebResearchProvider`,
  `SignalProvider`, `ScrapeProvider`) in `lib/integrations/`; vendors are swappable behind them.
- **Auth + secrets.** Keys live in env + `integration_connections` (provider-agnostic), never client-side.
- **Metering (D4).** Every external call goes through `meterAction` with a per-category cost; paid
  vendors gated by plan via the existing `PAID_INTEGRATIONS` pattern; fail-open on infra, fail-closed
  on insufficient balance.
- **RAG layer.** Reader/scrape output → `knowledge_documents` → `knowledge_chunks` (keep one embedding
  model per corpus); rerank before synthesis.
- **Signals.** Deal/company signals normalize into `market_signals` and flow through
  `generate_signal_matches` → match inbox → sourcing-brief Action Queue proposals.
- **Orchestration + guardrails.** Slow/agentic calls (Parallel, SixtyFour, Notte, Tavus) run as **gated
  Action Queue executors** (propose-only, D3); consequential sends (AgentMail, Textbelt) require operator
  approval; everything writes `trust_events`; all reads RLS-scoped; never-block on every vendor.
- **Rate limits + cost.** Cache aggressively by canonical identity / URL hash; batch bulk datasets
  (Coresignal); set per-org spend caps via the credits wallet.
- **Data governance.** PII handling, consent/opt-out (email + SMS), retention windows, and source ToS
  respected per vendor — a vendor-risk review before any contact-data vendor goes live.

---

## 5. Positioning

Integrated behind clean adapters and the credits meter, these tools turn FundExecs OS from a
platform that _reasons over the operator's data_ into one that _continuously gathers, enriches, and
acts on the whole private market_ — sourcing on live signals, diligence on cited evidence, outreach
and IR through real two-way channels, and LP distribution that feels bespoke. The discipline is
constant: aggregate where possible, meter every call, gate every consequential action, and keep
everything on the Chain of Trust.
</content>
