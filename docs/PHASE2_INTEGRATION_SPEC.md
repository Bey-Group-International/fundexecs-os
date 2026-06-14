# Phase 2 — External Data & Research Integration Spec

> **Scope:** the file-level implementation plan for the Priority-5 picks from
> `docs/TOOL_INTEGRATION_BLUEPRINT.md`, built on the Phase-1 Agentic Execution Layer
> (Action Queue `task_runs` + executors, the credits meter, Mandate Memory RAG over
> `knowledge_chunks`, the sourcing brief + match inbox, the diligence orchestrator,
> and the provider-agnostic `integration_connections` layer). Plan only — no code here.
>
> **Locked lenses (from the blueprint):** adapter-not-vendor; aggregate where possible;
> meter every call; gate every consequential action (propose-only, D3); everything on
> the Chain of Trust. **Priority bias: sourcing + enrichment first.**
>
> **First vendors (blueprint P5):** Orthogonal (aggregator) or People Data Labs direct
> for enrichment · Exa for web research/RAG · deepen the existing Apollo adapter ·
> PredictLeads for deal signals. All others slot in behind the same interfaces later.

---

## 0. Headline: build four interfaces, not many vendors

The blueprint's core recommendation is architectural. Phase 2 adds **four provider
interfaces** in `lib/integrations/` — each a metered, RLS-safe, never-block seam — and
ships **one vendor behind each**. Adding the next vendor later is a new file, not a new
subsystem.

| Interface               | First vendor                       | Feeds                                           | Pillar                  |
| ----------------------- | ---------------------------------- | ----------------------------------------------- | ----------------------- |
| `EnrichmentProvider`    | Orthogonal **or** People Data Labs | `contacts`/companies, match factors             | Sourcing · LP Relations |
| `WebResearchProvider`   | Exa                                | diligence runs, `knowledge_chunks`              | Diligence               |
| `SignalProvider`        | PredictLeads                       | `market_signals` → match inbox → sourcing brief | Sourcing Intelligence   |
| (deepen) Apollo adapter | Apollo                             | intent → sourcing brief; sequence drafts        | Sourcing · Execution    |

What already exists and is reused unchanged: the `Provider`/`FetchContext` pattern
(`lib/integrations/types.ts`, `providers/apollo.ts`), `integration_connections` for keys,
`lib/credits/meter.ts` + `costs.ts` for metering + plan gating, the Voyage + pgvector
RAG (`knowledge_documents`/`knowledge_chunks`/`match_knowledge_chunks`), the EDGAR
intelligence cron + `generate_signal_matches`, `sourcing_briefs` (P1-B), and
`lib/agents/executors.ts` (P1-A) for gated runs.

---

## 1. Cross-cutting foundation (do first)

**Metered actions.** Extend `lib/credits/costs.ts`:

- Add to `MeteredAction` + `ACTION_COST`: `enrichment` (≈2), `web_research` (≈5),
  `deep_research` (≈15), `company_signal_pull` (≈3).
- Treat paid vendors via the existing `PAID_INTEGRATIONS` + `INTEGRATION_ACCESS` plan
  gating where a contract requires it; otherwise plain `meterAction`.

**Provider keys.** Store per-org API keys in `integration_connections` (provider-agnostic,
service-role read only) — no new secret surface, no client exposure. Add catalog entries
in `lib/integrations/catalog.ts` + `providers.ts` so they appear in `/integrations`.

**Caching (additive migration).** `provider_cache { id, org_id, provider, kind, cache_key,
payload jsonb, fetched_at, expires_at, unique(provider, kind, cache_key) }` — RLS
org-scoped; dedupes enrichment/research/signal calls by canonical identity / URL hash /
query so spend stays bounded. Additive + idempotent, mirrors `sourcing_briefs`.

**Guardrail invariants (carried):** never-block on every vendor (degrade to empty);
all reads RLS-scoped; consequential actions stay propose-only via the Action Queue;
every external call writes a `trust_events` row; respect vendor ToS + PII/consent.

---

## 2. Workstreams

Sequence: **P2-A → P2-B → P2-C → P2-D → P2-E** (foundation first; enrichment + research
are the deepest near-term wins; comms/loops follow).

---

### P2-A — `EnrichmentProvider` interface + first vendor

**Goal.** A metered, swappable enrichment seam that hydrates contacts/companies and
feeds match scoring — fronted by an aggregator (Orthogonal) or PDL directly.

**Builds on.** `lib/integrations/types.ts` (`NormalizedContact`), `integration_connections`,
`lib/credits/meter.ts`, `contacts`/companies + `generate_signal_matches`,
`org_profile_embeddings` + `match_scoring_weights`, `providers/apollo.ts` (pattern).

**Add / extend.**

- `lib/integrations/enrichment/types.ts` — `EnrichmentProvider { id; enrichPerson(input):
EnrichedPerson; enrichCompany(input): EnrichedCompany }` + normalized result shapes.
- `lib/integrations/enrichment/orthogonal.ts` (or `people-data-labs.ts`) — first impl;
  never-throw (returns `{ found: false }` on miss/no-key).
- `lib/integrations/enrichment/index.ts` — registry + `enrich(orgId, kind, input)` wrapper
  that meters (`enrichment`), checks `provider_cache`, calls the active provider, caches,
  and audits.
- `lib/actions/enrichment.ts` — `enrichContact` / `enrichCompany` server actions
  (RLS-scoped) that persist hydrated fields onto `contacts`/companies.
- Wire into the match scorer: enriched firmographics become factors in
  `generate_signal_matches` (additive, never-block).

**Data model.** `provider_cache` (foundation). No change to `contacts`/companies beyond
filling existing columns.

**Monetization.** `meterAction(orgId, 'enrichment', refId)` per lookup; fail-open infra,
fail-closed on balance.

**Acceptance.** Enriching a contact/company fills fields + caches; second call hits cache
(no debit); missing key degrades silently; factors flow into match scores; CI green.

**Priority: 5.**

---

### P2-B — `WebResearchProvider` + Exa, wired to diligence + RAG

**Goal.** A diligence web-research executor that gathers cited sources into a run and the
RAG corpus — propose-only, provenance-first.

**Builds on.** `lib/diligence/orchestrator.ts` + `diligence_runs`/`diligence_findings`,
`knowledge_documents`/`knowledge_chunks` + Voyage + `match_knowledge_chunks`,
`lib/agents/executors.ts` (P1-A), `lib/ai/memo.ts` (P1-C).

**Add / extend.**

- `lib/integrations/research/types.ts` — `WebResearchProvider { id; search(query, opts):
ResearchResult[]; contents(urls): PageContents[] }` (each result carries url + snippet
  - score for provenance).
- `lib/integrations/research/exa.ts` — first impl; never-throw.
- `lib/integrations/research/index.ts` — registry + metered wrapper (`web_research`),
  cache by query/URL hash.
- `lib/agents/executors.ts` — register a **`research` executor**: on an approved research
  run, fetch sources, embed page contents into `knowledge_chunks` (one model per corpus),
  and attach citations as Chain-of-Trust Proof-of-Concept evidence on the diligence run.
- Optional "find similar companies" path: Exa similarity → staged sourcing tasks (reuse
  the P1-A sourcing executor's task-staging).

**Data model.** Reuse `knowledge_documents`/`knowledge_chunks`, `diligence_*`,
`trust_events`. `provider_cache` for query/URL dedupe.

**Monetization.** `web_research` per query; `deep_research` when routed to a deep-research
vendor (Parallel) behind the same interface later.

**Acceptance.** An approved research run produces cited sources on the run + embeds clean
contents into RAG; every claim links a real URL; no-key degrades to empty; CI green.

**Priority: 5.**

---

### P2-C — Deepen the Apollo adapter (intent + sequences)

**Goal.** Turn the existing Apollo integration from enrichment-only into a **sourcing
signal + outreach-draft** source — all sends operator-gated.

**Builds on.** `lib/integrations/providers/apollo.ts`, the `apollo_enrich` meter +
`PAID_INTEGRATIONS` gating, `sourcing_briefs` + match inbox, the outreach specialist.

**Add / extend.**

- Extend `providers/apollo.ts` (or `lib/integrations/enrichment/apollo.ts`) with intent +
  contact-search endpoints.
- Intent signals → `market_signals` → `generate_signal_matches` → sourcing-brief Action
  Queue proposals (reuse the P1-B cron path).
- Draft outreach sequences as **proposals** (never auto-send) routed to the outreach
  agent; sends remain propose-only pending P2-E comms.

**Data model.** None new (reuse `market_signals`, `task_runs`).

**Monetization.** Existing `apollo_enrich`; add a metered intent pull if needed.

**Acceptance.** Apollo intent appears as sourcing proposals; sequence drafts are
operator-gated; CI green.

**Priority: 5.**

---

### P2-D — `SignalProvider` + PredictLeads (timing engine)

**Goal.** Turn the sourcing brief from thesis-match into a **timing** engine: company
growth/buying signals raise proposals when the moment is right.

**Builds on.** `lib/ai/intelligence-pipeline.ts` (the cron + `market_signals` ingestion),
`generate_signal_matches`, `sourcing_briefs` (P1-B), the match inbox.

**Add / extend.**

- `lib/integrations/signals/types.ts` — `SignalProvider { id; fetchCompanySignals(domain,
since): CompanySignal[] }` (news, jobs, tech, partnerships).
- `lib/integrations/signals/predictleads.ts` — first impl + webhook intake route
  `app/api/integrations/predictleads/webhook`.
- Cron phase (extend the intelligence cycle): for watched companies / active briefs, pull
  signals → normalize into `market_signals` → score → raise sourcing proposals.

**Data model.** Reuse `market_signals`; optional `watched_companies { org_id, domain }`
(additive) if watch-lists are needed beyond the brief.

**Monetization.** `company_signal_pull` per company; webhook intake free.

**Acceptance.** A watched company's hiring/partnership event raises one Action Queue
sourcing proposal; idempotent; no-key degrades; CI green.

**Priority: 4.**

---

### P2-E — Two-way comms (AgentMail + Textbelt), gated

**Goal.** Upgrade agents from draft-only to **two-way** email + SMS — every send
operator-approved.

**Builds on.** the unified inbox (`app/inbox`, `inbox_items`), IR/outreach specialists,
`integration_connections`, `lib/agents/executors.ts`.

**Add / extend.**

- `lib/integrations/comms/agentmail.ts` — programmatic inbox: send + inbound webhook
  (`app/api/integrations/agentmail/webhook`) → inbound replies become `inbox_items` and
  raise "draft a response" Action Queue proposals.
- `lib/integrations/comms/textbelt.ts` — SMS send for capital-call/notice nudges + 2FA;
  consent/opt-out + quiet-hours guard.
- All sends are **approved runs** (propose-only); every send writes `trust_events`.

**Data model.** Reuse `inbox_items`/`interactions`; consent tracking column (additive).

**Monetization.** Per message (SMS) / per send; gate to paid tiers.

**Acceptance.** An inbound LP reply lands in the inbox + raises a draft-response proposal;
no message sends without approval; opt-outs honored; CI green.

**Priority: 4** (3 for SMS).

---

## 3. Dependency graph

```
P2-A foundation (meter actions, provider_cache, integration_connections keys)
  ├─ EnrichmentProvider + first vendor        → match scoring, IR
  ├─ P2-B WebResearchProvider + Exa           → diligence runs + RAG
  ├─ P2-C deepen Apollo                        → sourcing proposals + outreach drafts
  ├─ P2-D SignalProvider + PredictLeads        → timing-based sourcing proposals
  └─ P2-E comms (AgentMail/Textbelt)           → two-way loops (depends on outreach drafts)
```

The foundation (§1) is the only hard prerequisite. P2-A/B/C/D are independent and can run
in parallel once it lands; P2-E builds on the outreach drafts from P2-C.

---

## 4. Guardrails (carried from Phase 1 + blueprint §4)

- **Adapters, not vendors** — four interfaces; vendors swappable; aggregator (Orthogonal)
  can satisfy multiple at once.
- **Meter everything** — `meterAction` per external call; fail-open infra / fail-closed
  balance; plan-gate paid vendors.
- **Propose-only** — research, enrichment-driven outreach, and all sends run as gated
  Action Queue executors; nothing consequential is autonomous.
- **On the record** — every call + decision writes `trust_events`; research/memo evidence
  carries source URLs.
- **Never-block** — every provider degrades to empty on missing key / timeout / error.
- **Additive + idempotent** migrations (`provider_cache`, optional `watched_companies`,
  consent column); RLS on all new tables; one embedding model per corpus.
- **Data governance** — PII/consent (email + SMS), retention, and source ToS respected;
  a vendor-risk review before any contact-data vendor goes live.

---

## 5. Open questions (resolve before P2-A code)

1. **Aggregator vs direct:** integrate **Orthogonal** first (breadth, one key) or go
   **People Data Labs** direct (depth, known schema)? _Recommend: Orthogonal behind the
   `EnrichmentProvider` interface, with PDL as the second impl for A/B._
2. **Research vendor default:** **Exa** as the single `WebResearchProvider` first, adding
   Perplexity/Parallel later? _Recommend: yes — Exa first; deep-research (Parallel) is a
   separate metered action._
3. **Signals scope:** drive PredictLeads off the **sourcing brief** only, or add an
   explicit **watch-list**? _Recommend: brief-driven first; watch-list if demand appears._
4. **Comms in Phase 2 or 3:** ship AgentMail/Textbelt now, or after enrichment+research
   prove out? _Recommend: defer P2-E to the end of Phase 2 (it depends on P2-C drafts)._
   </content>
