# FundExecs Agentic Execution Layer — Strategic Adoption Plan

> **Status:** Strategy + roadmap (no code in this deliverable). Grounds every
> proposal in surfaces that already ship: the **Source → Build → Execute → Run**
> lifecycle, the **15-member AI Executive Team** led by **Earn** (Chief
> Operating Officer), the **Chain of Trust**, and the live integration +
> intelligence layers documented in `README.md`,
> `memory/INTELLIGENCE_LAYER_PROPOSAL.md`, and `docs/ADOPTION_PLAN.md`.
>
> Inherits the repo's guardrails: additive + idempotent migrations,
> never-block AI, tokens-only UI, server-side actions under RLS, the 15 brain
> slugs frozen, and "specialist / executive team" wording (never "copilot").

---

## 0. Thesis — root and fruit

**Bey Group International Fund I is the root; FundExecs OS is the fruit.**

Fund I is the live institution — its mandate, its deals, its LPs, its
compliance posture, its operating rhythm. Everything FundExecs OS knows how to
do, it learned from running a real fund. The **Agentic Execution Layer** is what
turns that knowledge into work: it transforms FundExecs from a _passive
platform_ — screens an operator looks at and forms an operator fills in — into
an **active operating system** that performs institutional-grade work on the
operator's behalf, on the record, and audit-ready.

Today the Executive Team **advises**: Earn and the 15 specialists answer
questions, score matches, validate evidence, and route work (`app/earn`,
`/inbox-intelligence`, `/match-inbox`, Chain-of-Trust validation). The shift
this plan proposes is from **advice to autonomy** — the same desk that tells you
what to do next now _does it_, drafts it, files it, follows up on it, and brings
you the finished work for one-click approval.

We frame the new capability as a proprietary **Desk Agent** layer:
autonomous, goal-driven workers operated by the specialists who already own each
function. Marcus doesn't just surface a deal — his **Sourcing Agent** builds the
target list, screens it, and drafts the outreach. Eleanor doesn't just remind
you an LP update is due — her **IR Agent** drafts it from live portfolio data and
queues it for send. Every agent runs **never-block** and **human-in-the-loop**:
it does the work, the operator approves the consequential step, and the Chain of
Trust records who decided what and why.

This is the moat. Competitors ship dashboards. FundExecs ships a desk that
works.

---

## 1. The capability we are adopting (named proprietarily)

We are adopting a class of capability — **autonomous, tool-using AI agents that
plan multi-step work, call external systems, and run to a goal with
human-in-the-loop checkpoints** — and expressing it entirely as FundExecs IP:

| Layer              | FundExecs name                    | What it is                                                                                                          | Built on (already in repo)                                                                      |
| ------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Orchestration      | **Earn Orchestrator**             | The COO plans a goal, decomposes it into steps, routes each to the owning specialist, and assembles the result      | `lib/ai/earn.ts`, `brain_routing_rules`, the 15-brain roster                                    |
| Workers            | **Desk Agents**                   | One autonomous agent per specialist function (Sourcing, IR, Diligence, Compliance, …)                               | `lib/team/*` (frozen slugs), `lib/ai/brains.ts`                                                 |
| Memory & retrieval | **Mandate Memory**                | pgvector RAG over the org's mandate, knowledge, and signals so agents act on the _operator's_ thesis                | `knowledge_documents`, `knowledge_chunks`, `match_knowledge_chunks()`, `org_profile_embeddings` |
| Tools              | **Connected Desk**                | The agents' hands — read/write into Gmail, Calendar, Drive, Slack, QuickBooks, HubSpot, Salesforce, Carta, DocuSign | `lib/integrations/`, `integration_connections`, the Phase-6 adapter pattern                     |
| Trust & control    | **Chain of Trust + Action Queue** | Every autonomous action is proposed, approved, and logged as an auditable event                                     | `trust_events`, Chain-of-Trust records, `/action-queue`, `tasks`                                |

The **Action Queue** is the spine: agents never act silently on consequential
steps. They produce a proposed action (a memo, an email, a wire instruction, a
KYC decision), it lands in the operator's queue with the evidence and the
specialist's rationale, and the operator approves or edits. Low-stakes work
(data reconciliation, draft generation, KPI pulls) runs autonomously; high-stakes
work (send, sign, move money, accept/reject an LP) is always gated.

---

## 2. The ten Desk Agents

Each agent below follows the same template: **the user problem**, **the
capability applied**, **the FundExecs flow** (mapped to real surfaces), **value
by persona**, **monetization**, and **phase**.

Personas, using the platform's five `member_type` values:
**FM** = fund manager / GP (`investment_firm`), **FO** = family office,
**AE** = acquisition entrepreneur / searcher, **LP** = investor
(`individual_investor`). (Service providers and students inherit read-only or
funnel-side touchpoints.)

---

### Agent 1 — Sourcing Agent (target sourcing & screening)

_Owner: Marcus (Head of Deal Origination), with Camille (Top-of-Funnel)_

- **User problem.** Sourcing is manual, biased toward inbound, and inconsistent.
  Operators miss on-thesis targets and waste hours screening off-thesis ones.
- **Capability applied.** An autonomous agent that runs a standing sourcing
  brief — pulls candidates from connected sources and signals, screens each
  against the org's mandate, and ranks them before they reach the desk.
- **FundExecs flow.** Operator sets a sourcing brief in **Source → Pipeline /
  Capital Map / Leads** (`app/source/*`). The agent ingests EDGAR Form D + ADV
  (already wired via `/api/cron/intelligence`), web/press signals, and CRM
  contacts, scores each with `generate_signal_matches` against the mandate
  vector (`org_profile_embeddings`), and writes ranked candidates into
  `/match-inbox` with a fit rationale and Marcus's read. Operator triages
  accept/dismiss; feedback re-weights the scorer (`match_scoring_weights`).
- **Value.** **FM/FO:** proprietary, always-on origination tuned to thesis.
  **AE:** a tireless deal-finder for a solo searcher who can't afford an
  analyst. **LP:** better top-of-funnel quality flows through to allocation.
- **Monetization.** Core to paid tiers; **sourcing volume** (briefs, screens/mo)
  as a usage meter; premium signal sources as add-ons.
- **Phase 1.**

### Agent 2 — Diligence Agent (CIMs, financials & documents)

_Owner: Dalia (Head of Data Operations), with Adrian (Compliance)_

- **User problem.** Reading CIMs and tearing down financials is slow, and
  inconsistency between deals makes comparison unreliable.
- **Capability applied.** A document-analysis agent that ingests a CIM,
  financial statements, and a data room, extracts a normalized financial and
  risk record, and flags gaps and inconsistencies.
- **FundExecs flow.** Operator drops documents into **Run → Diligence**
  (`app/run/diligence`) or a deal's data room. The agent (Dalia owns ingestion)
  parses to a decision-ready record, embeds it into `knowledge_chunks` for RAG,
  produces a structured teardown (revenue quality, margins, customer
  concentration, working-capital, add-backs), and routes legal/structural flags
  to Adrian. Findings attach as **Chain-of-Trust** evidence (Proof of Concept).
- **Value.** **FM/FO:** consistent, comparable diligence at a fraction of the
  hours. **AE:** institutional-grade diligence without an institutional team.
  **LP:** verifiable, on-the-record analysis behind each deal.
- **Monetization.** **Per-document / per-data-room** usage metering; a clear
  ceiling for enterprise (unlimited diligence on top tier).
- **Phase 1.**

### Agent 3 — Memo & Scorecard Agent (investment memos & acquisition scorecards)

_Owner: Theodore (Chief Strategy Advisor), with Marcus_

- **User problem.** Writing the IC memo and scorecard is the bottleneck between
  "interesting" and "decision." It's slow and varies by author.
- **Capability applied.** A generation agent that turns the diligence record into
  a structured, house-style investment memo and a weighted acquisition
  scorecard, with the strategist's framing of trade-offs.
- **FundExecs flow.** From a deal in **Source → Pipeline** or **Run →
  Diligence**, the operator clicks _Draft memo_. The agent assembles the memo
  from Agent 2's record + Mandate Memory, scores the deal on the org's rubric,
  and drops it into the deal's **Build → Data Room** as a versioned, citable
  document. Theodore pressure-tests the thesis; the memo carries source
  citations and a Chain-of-Trust stamp.
- **Value.** **FM/FO:** IC-ready memos in minutes, consistent house style.
  **AE:** a credible memo to take to lenders and co-investors. **LP:** decisions
  documented as they form.
- **Monetization.** Bundled with paid tiers; **template/rubric customization**
  and brand-styled memo export as a premium feature.
- **Phase 1.**

### Agent 4 — LP Onboarding Agent (onboarding, KYC, AML, accreditation)

_Owner: Adrian (General Counsel & Compliance), with Eleanor (IR)_

- **User problem.** LP onboarding is a high-friction, high-liability slog —
  collecting docs, running KYC/AML, verifying accreditation, chasing signatures.
- **Capability applied.** A workflow agent that drives each LP from invite to
  funded: collects subscription docs, runs KYC/AML checks, verifies accreditation
  (506(b)/(c) aware), and routes signatures.
- **FundExecs flow.** Initiated from **Build → Formation** + **Run → Compliance**
  (`app/build/formation`, `app/run/compliance`). The agent generates a
  per-LP onboarding checklist, requests docs, runs identity/AML screening via the
  Connected Desk, gates the **public raise CTA** on accreditation
  (the 506(c) gating already planned in `docs/ADOPTION_PLAN.md` §W4), and routes
  the sub-doc to DocuSign for signature. Every step writes a Chain-of-Trust
  Proof-of-Truth/Execution event; Adrian reviews exceptions.
- **Value.** **FM/FO:** compliant onboarding without a fund-admin headcount.
  **AE:** a clean, investor-grade intake for first-time fund formers.
  **LP:** a fast, professional onboarding experience.
- **Monetization.** **Per-LP onboarded** metering (mirrors fund-admin
  pricing); KYC/AML as a passthrough + margin; premium compliance audit pack.
- **Phase 2.** (Regulated workflow — ships after the Phase-1 spine proves out.)

### Agent 5 — Capital Calls & Notices Agent (calls, notices, follow-ups)

_Owner: Eleanor (Head of Investor Relations), with Sloane (Capital Formation)_

- **User problem.** Capital calls and investor notices are manual, error-prone,
  and the follow-up on unfunded calls is inconsistent.
- **Capability applied.** A scheduling + dunning agent that drafts pro-rata
  capital-call notices, sends them, tracks funding, and runs polite, escalating
  follow-ups until each commitment is funded.
- **FundExecs flow.** From **Execute → Capital / Wires** (`app/execute/capital`,
  `app/execute/wires`) and the **LP Room** (`app/lp-room`). The agent computes
  pro-rata amounts from commitments, drafts per-LP notices, sends via the
  Connected Desk, reconciles funding against wires, and queues follow-ups for
  unfunded LPs. The operator approves the send and any escalation; statements
  flow into the LP capital-account view (the `distributions` /
  `capital_account_entries` extension in `docs/ADOPTION_PLAN.md` §W3).
- **Value.** **FM/FO:** calls go out on time, follow-ups never slip.
  **AE:** professional capital ops from day one. **LP:** clear, timely notices
  and a live capital account.
- **Monetization.** Part of the **fund-admin tier**; usage by calls/notices
  processed; premium reconciliation + statement automation.
- **Phase 2.**

### Agent 6 — Portfolio Monitoring Agent (KPI monitoring via integrations)

_Owner: Dalia (Data Operations), with Theodore (Strategy)_

- **User problem.** Portfolio data lives in QuickBooks, HubSpot, Salesforce,
  Drive, and email. Pulling it together for monitoring is constant manual labor,
  so problems surface late.
- **Capability applied.** A monitoring agent that connects to portfolio-company
  systems, pulls KPIs on a schedule, normalizes them, and raises anomaly alerts.
- **FundExecs flow.** Via **Integrations** (`app/integrations`,
  `lib/integrations/`, `integration_connections`) the operator connects
  QuickBooks (financials), HubSpot/Salesforce (pipeline/revenue), Google Drive
  (board decks), and email. The agent (Dalia owns ingestion) syncs on the
  existing cron, normalizes into a KPI record, and promotes threshold breaches
  into `DashboardData.majorAlerts[]` and the activity feed. Theodore frames what
  a breach means. Trends feed the executive dashboards (Agent 10).
- **Value.** **FM/FO:** live portfolio health without chasing founders.
  **AE:** post-close monitoring of the acquired business in one place.
  **LP:** confidence the GP is watching, with evidence.
- **Monetization.** **Per connected portfolio company** metering — the cleanest
  expansion-revenue lever in the plan; premium connectors (Salesforce, NetSuite).
- **Phase 2.**

### Agent 7 — Deal & Diligence Rooms Agent (AI-powered rooms)

_Owner: Sterling (Chief of Staff), with Adrian (Compliance)_

- **User problem.** Data rooms are passive file folders. Counterparties can't get
  answers without emailing; operators can't see who's serious.
- **Capability applied.** An agent that stands up a structured deal/diligence
  room, auto-organizes uploads, answers counterparty questions from the
  documents (RAG), and reports engagement back to the host.
- **FundExecs flow.** Built on **Build → Data Room** (`app/build/data-room`) and
  the existing token-gated public surface pattern (`app/p/[token]`,
  safe-subset loaders). The agent auto-files uploads into a diligence index,
  embeds them, and powers a room-scoped Q&A (extending the `LpQAChat` pattern in
  `components/lp-room/*`) that answers only from approved docs. Host sees an
  engagement/heat view; sensitive Q&A routes to Adrian. Access and every answer
  are Chain-of-Trust logged.
- **Value.** **FM/FO:** a self-serve, always-on diligence room that qualifies
  interest. **AE:** a professional room for lenders and sellers. **LP:** instant,
  document-grounded answers.
- **Monetization.** **Per active room** + per external participant; premium
  branded/light-theme public rooms (`docs/ADOPTION_PLAN.md` §5).
- **Phase 2.**

### Agent 8 — Chief of Staff Agent (AI Chief of Staff / Family Office Concierge)

_Owner: Earn (COO) + Sterling (Chief of Staff)_

- **User problem.** The operator is the bottleneck — too many threads, decisions,
  and follow-ups across functions, with no one holding the operating rhythm.
- **Capability applied.** A personal orchestration agent that owns the operator's
  daily rhythm: triages inbox and signals, drafts the day's priorities, prepares
  decisions, and dispatches the other nine agents on the operator's behalf.
- **FundExecs flow.** This is the **Earn Orchestrator** made personal, living on
  the **Command Center** (`app/command-center`) and the **Earn dock**
  (`app/earn`, `EarnContextKind`). It reads the unified inbox (`app/inbox`),
  Action Queue, and KPIs; produces a morning brief ("3 Form D matches on thesis,
  2 capital calls unfunded, 1 LP update due"); and lets the operator delegate in
  one line ("send the Q2 update," "screen these three") which it routes to the
  owning specialist agent. For family offices, this is the **Family Office
  Concierge** — a single executive across deals, entities, and household.
- **Value.** **FM/FO:** leverage of a full back office through one interface.
  **AE:** the team a solo searcher doesn't have. **LP:** (lightweight) a concierge
  for their own portfolio of commitments.
- **Monetization.** The **flagship seat** — the headline reason to buy a paid
  seat; per-seat pricing; family-office concierge as a premium SKU.
- **Phase 1 (read + brief) → Phase 2 (delegate + dispatch).**

### Agent 9 — Outreach & CRM Agent (outreach, CRM updates, meeting prep, reporting)

_Owner: Vivian (Demand Generation), with Camille + Sienna (Communications)_

- **User problem.** Outreach is inconsistent, CRMs go stale, and meeting prep
  eats hours that should go to the meeting itself.
- **Capability applied.** A relationship agent that drafts and personalizes
  outreach sequences, keeps the CRM current from email/calendar activity, and
  prepares a brief before every meeting.
- **FundExecs flow.** Built on **Connections** + **Source → Leads/Partners** and
  the relationship-intelligence layer (`contacts`, `interactions`, auto-scored
  `relationships`, `warm_introductions`). The agent drafts on-brand sequences
  (Sienna owns voice), logs activity from Gmail/Calendar/Slack into the CRM
  automatically, refreshes warmth scores, and assembles a pre-meeting brief
  (who, history, last touch, talking points) from Granola/Read.ai notes + CRM.
  Sends are operator-approved.
- **Value.** **FM/FO:** a living CRM and warm pipeline without manual hygiene.
  **AE:** disciplined seller/lender outreach. **LP:** GPs who show up prepared.
- **Monetization.** Usage by **contacts enriched / sequences sent**; premium
  meeting-intelligence connectors.
- **Phase 2.**

### Agent 10 — Reporting Agent (executive dashboards, LP updates, board reports)

_Owner: Eleanor (IR), with Theodore (Strategy) + Sienna (Communications)_

- **User problem.** Quarterly LP updates and board decks are a recurring fire
  drill — assembling numbers, writing narrative, formatting, every period.
- **Capability applied.** A reporting agent that compiles live data into
  executive dashboards, drafts the LP update and board-ready report in house
  style, and queues them for review and distribution.
- **FundExecs flow.** Pulls from Agent 6's KPI record, capital accounts, and the
  pipeline. Produces the executive dashboard on **Command Center**, drafts the
  LP update into the **LP Room** `UpdateFeed`, and generates a board deck export
  (light/branded theme). Theodore frames performance narrative; Sienna polishes
  voice; the operator approves before LPs see it. Each report is versioned and
  Chain-of-Trust stamped.
- **Value.** **FM/FO:** quarterly reporting from a fire drill to a review-and-send.
  **AE:** investor-grade reporting for first-time managers. **LP:** consistent,
  on-time, verifiable updates.
- **Monetization.** Part of the **IR / fund-admin tier**; premium branded
  exports; usage by reports generated.
- **Phase 1 (dashboards + draft) → Phase 2 (full board/LP report automation).**

---

## 3. Coverage map — agents across the lifecycle

| Lifecycle stage            | Surfaces (`app/*`)                                         | Agents primarily acting here                          |
| -------------------------- | ---------------------------------------------------------- | ----------------------------------------------------- |
| **Source**                 | `pipeline`, `capital-map`, `leads`, `partners`             | 1 Sourcing, 9 Outreach/CRM                            |
| **Build**                  | `formation`, `data-room`, `governance`, `brand`            | 3 Memo/Scorecard, 4 LP Onboarding, 7 Rooms            |
| **Execute**                | `capital`, `wires`, `closings`, `chain-of-trust`           | 5 Capital Calls, 4 Onboarding (close)                 |
| **Run**                    | `diligence`, `compliance`, `ir`, `workflows`, `objections` | 2 Diligence, 4 Compliance, 6 Monitoring, 10 Reporting |
| **Across (orchestration)** | `command-center`, `earn`, `inbox`, `action-queue`          | 8 Chief of Staff / Concierge (dispatches all)         |

Every agent strengthens the **Chain of Trust** rather than bypassing it: its
output becomes evidence, its decisions become `trust_events`, and its
consequential steps pass through human approval. The agent layer doesn't replace
the operator's judgment — it removes everything _before_ the judgment.

---

## 4. Monetization model

The agent layer changes FundExecs's revenue shape from flat SaaS seats to
**seat + usage + outcome**, which is how institutional buyers expect to pay.

| Lever                       | What's metered                                                                                     | Why it fits                                                |
| --------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Agent seats**             | Chief of Staff / Concierge per operator (flagship)                                                 | The headline value; clean per-seat anchor                  |
| **Usage meters**            | Screens, documents analyzed, LPs onboarded, calls sent, reports generated, portfolio cos connected | Scales with the work the desk performs — expansion revenue |
| **Connected-company fee**   | Per portfolio company monitored                                                                    | The cleanest land-and-expand lever (Agent 6)               |
| **Fund-admin tier**         | Onboarding + capital ops + reporting bundle (Agents 4, 5, 10)                                      | Displaces fund-admin spend with software margin            |
| **Concierge SKU**           | Premium family-office concierge (Agent 8)                                                          | High-touch FO segment, premium price                       |
| **Marketplace passthrough** | KYC/AML, signatures, data sources                                                                  | Passthrough + margin, no extra build risk                  |

Pricing posture: **agents are the reason to upgrade.** The advisory desk (chat,
match scoring) anchors lower tiers; **autonomous execution** is the paid line.

---

## 5. Recommended product roadmap

### Phase 1 — The spine + first proof (sourcing → decision)

_Prove that autonomous work, gated by the Action Queue and logged to the Chain
of Trust, is trustworthy on the lowest-liability functions._

- **Earn Orchestrator + Action Queue spine** — goal → plan → route → propose →
  approve → log. Extends `lib/ai/earn.ts`, `brain_routing_rules`, `/action-queue`,
  `trust_events`. The control plane every later agent reuses.
- **Agent 1 — Sourcing** (on the live EDGAR cron + match scorer).
- **Agent 2 — Diligence** (document teardown → `knowledge_chunks` + evidence).
- **Agent 3 — Memo & Scorecard** (diligence record → IC memo).
- **Agent 8 (read tier) — Chief of Staff brief** on Command Center.
- **Agent 10 (dashboard tier)** — executive dashboard + draft LP update.

**Why this set:** all low-liability (no money moved, no LP accepted, nothing
sent without approval), all built on surfaces and data that already ship, and
together they deliver one complete loop — _source → screen → analyze → memo →
brief_ — that an operator can feel on day one.

### Phase 2 — The back office (capital ops + IR + monitoring)

_Move into regulated and money-touching work once the spine is proven._

- **Agent 4 — LP Onboarding** (KYC/AML/accreditation, 506(c) gating).
- **Agent 5 — Capital Calls & Notices** (+ capital-account statements, §W3).
- **Agent 6 — Portfolio Monitoring** (QuickBooks/HubSpot/Salesforce/Drive).
- **Agent 7 — Deal & Diligence Rooms** (RAG Q&A + engagement heat).
- **Agent 8 (delegate tier)** — one-line dispatch to specialist agents.
- **Agent 9 — Outreach & CRM** (sequences, auto-hygiene, meeting prep).
- **Agent 10 (full)** — board-ready report + LP report automation.

### Phase 3 — The autonomous operating system

_Compounding, cross-agent autonomy and the family-office concierge._

- **Multi-agent workflows** — standing playbooks that chain agents (e.g.
  "new on-thesis Form D → screen → memo → outreach → room") via `workflows`.
- **Family Office Concierge SKU** — Agent 8 across entities, deals, and
  household; cross-fund and cross-entity rollups.
- **Proactive autonomy** — agents propose work before being asked (renewals,
  drifting KPIs, stale relationships, compliance deadlines).
- **Trust-graded autonomy** — operators raise an agent's autonomy ceiling per
  function as its track record (logged in `trust_events`) earns it.

---

## 6. Ideal MVP (the first thing to ship)

The smallest build that proves the thesis — _the platform performs
institutional-grade work, on the record_ — is the **Phase-1 sourcing-to-memo
loop with the Chief of Staff brief on top**:

1. **Action Queue + approval spine** — the one piece everything else reuses.
2. **Sourcing Agent** on the live EDGAR cron + mandate-tuned match scorer →
   ranked candidates in `/match-inbox`.
3. **Diligence Agent** → drop a CIM/financials, get a normalized teardown +
   Chain-of-Trust evidence.
4. **Memo Agent** → one click turns the teardown into an IC-ready memo in the
   data room.
5. **Chief of Staff brief** on Command Center → "here's what your desk did
   overnight, here's your next decision."

This MVP is fully grounded in shipped surfaces (Source pipeline, Run diligence,
Build data room, Command Center, the EDGAR cron, the match scorer, Chain of
Trust). It moves **no money and accepts no LP**, so it clears the trust bar
before the regulated Phase-2 work — yet it already demonstrates a desk that
_works_ rather than a dashboard that watches.

**MVP success signal:** an operator wakes up to a screened pipeline, a finished
teardown, and a draft memo they only had to approve — work that used to take an
analyst a week.

---

## 7. Positioning statement

> **FundExecs is the AI-native operating system for funds and family offices —
> a desk that doesn't just track your work, it does it.**
>
> Built on the discipline of a real institution (Bey Group International
> Fund I) and run by a 15-member AI executive team under a single Chief
> Operating Officer, FundExecs turns capital formation, deal sourcing,
> diligence, investor relations, compliance, and back-office operations into
> autonomous, audit-ready work. Every action is proposed by a specialist,
> approved by you, and recorded on the Chain of Trust.
>
> Other platforms give you screens to fill in. FundExecs gives you a desk that
> shows up with the work already done.
>
> **The fund is the root. The OS is the fruit. The agents are the harvest.**

---

## 8. Guardrails (carried from the codebase)

- **Never-block AI:** every agent degrades gracefully on missing key / timeout /
  API failure and never blocks an approval path (`README.md` invariants).
- **Human-in-the-loop:** consequential actions (send, sign, move money,
  accept/reject an LP) are always gated through the Action Queue.
- **Everything on the record:** agent actions write `trust_events`; outputs
  attach as Chain-of-Trust evidence with citations.
- **Additive + idempotent** migrations; **server-side actions under RLS**;
  service role only for ingestion + signed URLs.
- **Frozen:** the 15 brain slugs and `lib/team/*`; "specialist / executive team"
  wording; tokens-only UI.
- **Safe-subset** pattern for any public agent surface (rooms, raise pages) —
  zero sensitive fields in public payloads.

---

## 9. Locked decisions

These were confirmed with the product owner and govern how this strategy
converts into build work.

| #   | Decision         | Locked choice                                                                                                                                                                                                |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | **Deliverable**  | This PR ships the **strategy + roadmap only**. Implementation lands in separate, scoped PRs per phase (mirrors the `docs/ADOPTION_PLAN.md` discipline).                                                      |
| D2  | **First MVP**    | Build the full Phase-1 loop: **Action Queue spine → Sourcing → Diligence → Memo + Chief-of-Staff brief** (§6). Lowest liability, one complete loop an operator feels on day one.                             |
| D3  | **Autonomy**     | **Propose-only, human approves.** Every agent output lands in the Action Queue for one-click approval; nothing sends, signs, moves money, or accepts an LP autonomously. (Trust-graded autonomy is Phase 3.) |
| D4  | **Monetization** | Lead with **seat + usage + outcome** (§4): the Chief-of-Staff seat anchors price; usage meters and the per-portfolio-company fee drive expansion.                                                            |

**Next step (separate PR):** convert the Phase-1 MVP (D2) into a file-level
implementation spec — the Action Queue spine first (the control plane every
agent reuses), then Sourcing → Diligence → Memo on top — under the §8
guardrails.
