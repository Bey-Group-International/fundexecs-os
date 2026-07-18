# Native Intelligence Layer + Signal Bureau Connector

**Status:** Phase 1 (native core) + Phase 2 seed (Signal Bureau REST connector) landed, behind flags (off by default).
**Author:** Native Intelligence increment.
**Scope principle:** the smallest high-value extension that fits the existing architecture. FundExecs owns intelligence; Signal Bureau is an optional, removable feed. No active FundExecs capability was duplicated.

---

## 1. Current-state capability matrix

Audit of the existing repo against the intelligence surface. Classifications: `ACTIVE` (implemented + connected), `PARTIAL`, `MOCKED`, `PLANNED`, `ABSENT`, `BLOCKED` (needs config).

| Capability | Status | Where | Reused / built |
|---|---|---|---|
| Earn orchestration (plan → gate → execute) | ACTIVE | `lib/engine.ts`, `lib/intelligence.ts` (routing), `lib/earn-plan.ts` | **Reused** — intelligence feeds it, never replaces it |
| Executive-agent registry (15 agents) | ACTIVE | `lib/agents.ts` (`AgentKey`) | **Reused** — routing matrix targets these keys |
| Approval gates (Tier 1/2/3, ActionKind, Mandate) | ACTIVE | `lib/gates.ts` | **Reused** — `routing.ts` derives tiers from it |
| Mandate-scoped autonomy | ACTIVE | `lib/mandates.ts`, `lib/autonomy.ts` | **Reused** |
| Proactive pipeline (Signal→Prioritize→Gate→Learn) | PARTIAL | `lib/proactive/*` (cold-LP live; UI unmounted; flag off) | **Reused as target** — `signal-bridge.ts` maps assessments into it |
| PMI source registry (`PmiSource`) | PARTIAL | `lib/proactive/pmi/*` (Carta live, rest scaffold) | **Pattern mirrored** for `IntelligenceProvider` |
| Provider abstraction (signing/payment rails) | PARTIAL | `lib/providers/*` | Not the seam (capital rails, not data) |
| Source cache (TTL + provenance) | ACTIVE | `lib/source-cache.ts` | Available for connector caching |
| Secret vault (AES-256-GCM, server-only) | ACTIVE | `lib/vault.ts`, `lib/org-secrets.ts` | **Reused** — provider tokens encrypted with it |
| MCP support | PARTIAL | `lib/mcp/registry.ts` (registry only), `lib/integrations/carta/mcp-client.server.ts` (one JSON-RPC client) | Pattern available for connector MCP mode (declared, follow-on) |
| Rate limiting | PARTIAL | `lib/rate-limit.ts` (in-memory) | Connector carries its own backoff/retry-after |
| Provider connection model (health/last-sync) | ABSENT | closest: `integration_connections` (no health/sync) | **Built** — `intelligence_provider_connections` |
| **IntelligenceObservation / TrackedEntity / EntityObservationLink / Exposure / Assessment / Watchlist** | **ABSENT** | — | **Built** — this increment |
| Signal / propensity / radar machinery | ACTIVE | `lib/sourcing-signals.ts`, `lib/source-radar.ts`, `entity_signals`, `deal_signals` | Complemented, not duplicated (signal-centric; new layer is observation/assessment-centric) |
| Operating brief | ACTIVE (pure) | `lib/operating-brief.ts` | Read model available; intelligence section = follow-on |
| Notifications / inbox | PARTIAL | `lib/inbox/*`, `components/TopNavAlerts.tsx` | Available surface |
| Audit log | ACTIVE | `audit_log`, `lib/dashboard/audit.ts` | Available for provider admin actions |
| Usage metering | ACTIVE | `lib/credits.ts`, `lib/agent-costs.ts` | Available for `ask`/MCP spend |
| RBAC | ACTIVE | `lib/rbac.ts` (`is_org_writer`/`is_org_admin`) | **Reused** — RLS + provider-admin gating |
| Workspace/tenant isolation | ACTIVE | `organization_id` + RLS helpers | **Reused** — every new table |
| Event bus / job queue | PARTIAL | `task_events` + Realtime + hourly `/api/cron` sweep (no bus) | **Reused** — sync is a best-effort cron block |
| Feature flags | PARTIAL | env-string constants (e.g. `PROACTIVE_ENABLED`) | **Pattern mirrored** in `lib/intelligence/flags.ts` |

## 2. Gap analysis

The intelligence *machinery* (signals, scoring, gates, routing, providers, provenance) is mature. What was missing is the **canonical record layer** that turns provider activity into durable, firm-relevant, provenance-carrying intelligence, plus a **provider-connection model** with health/sync and an **external feed connector**. Those are exactly what this increment builds — nothing else.

## 3. Activate-vs-build decisions

- **Activate/reuse:** gates, mandates, autonomy, Earn engine, agent registry, vault, RLS helpers, cron sweep pattern, proactive pipeline (as the routing target), source-cache, `VerifiedResult`/`ProvenancedClaim` provenance vocabulary.
- **Build (new, additive):** the 8 canonical tables; `lib/intelligence/*` (types, flags, dedup, relevance, entity-match, routing, provider registry, store, connections, ingest, assess, sweep, signal-bridge); the `signal-bureau` connector (schema, adapter, client, provider). One 3-line best-effort block added to `/api/cron`.
- **Deliberately deferred (backlog):** UI surfaces (drawer, hub sections, provider settings panel), MCP-mode runtime binding, async `ask` jobs, private-desk config, LLM-authored scenario prose, DB-type regeneration.

## 4. Architecture

Two layers with a hard boundary. Layer A works with Signal Bureau disabled.

```
                        LAYER A — Native FundExecs Intelligence Core (owned)
  ┌───────────────────────────────────────────────────────────────────────────┐
  │  tracked_entities   intelligence_observations   entity_observation_links    │
  │  intelligence_exposures   intelligence_assessments   watchlists/_items      │
  │                                                                             │
  │  relevance.ts (multi-dim, versioned weights)   entity-match.ts   routing.ts │
  │  dedup.ts   assess.ts   store.ts   ingest.ts   sweep.ts   flags.ts          │
  └───────────────▲───────────────────────────────────────────────┬────────────┘
                  │ ProviderObservation (neutral)                  │ Signal (bridge)
  ┌───────────────┴───────────────┐                    ┌───────────▼────────────┐
  │  IntelligenceProvider (seam)   │                    │  Earn proactive loop   │
  │  provider.ts registry          │                    │  + gates.ts (Tier 1-3) │
  └───────────────▲───────────────┘                    └────────────────────────┘
                  │ anti-corruption adapter
  ┌───────────────┴──────────────────────────────────────────────────────────┐
  │  LAYER B — signal-bureau connector (optional, removable)                   │
  │  schema.ts (sb.signals.v1) → adapter.ts → client.ts (REST) → index.ts      │
  │  intelligence_provider_connections (health/sync + vault-encrypted token)   │
  └────────────────────────────────────────────────────────────────────────────┘
```

**Data flow:** cron sweep → provider `fetchObservations` → adapter normalizes `sb.signals.v1` → `ProviderObservation` → freshness → dedup+persist (`intelligence_observations`) → entity match (`tracked_entities`) → exposures → assessment (relevance × routing) → persisted `intelligence_assessments` with `assigned_agent` + `required_tier`. It STOPS there. `signal-bridge.ts` maps an actionable assessment into a proactive `Signal`; Earn's existing loop + `gates.ts` own everything downstream. External intelligence initiates analysis, never final action.

## 5. Native domain model

Migration `supabase/migrations/20260718120000_intelligence_core.sql`; TS types in `lib/intelligence/types.ts`. Tenancy `organization_id`; canonical member-read / writer-write RLS; `set_updated_at` triggers; observations + assessments on `supabase_realtime`.

| Table | Purpose | Key columns |
|---|---|---|
| `intelligence_provider_connections` | one row per (org, provider) | provider, status, auth_mode, config, feature_permissions, rate_limits, health, last_success/failure_at, encrypted token |
| `tracked_entities` | monitored universe | entity_type (15 kinds), name, aliases[], external_identifiers, status |
| `intelligence_observations` | raw observation, any provider | provider, provider_record_id, provider_schema_version, evidence_status, freshness_status, confidence, source_urls[], raw_payload, content_hash, **unique(org, deduplication_key)** |
| `entity_observation_links` | observation ↔ entity | match_method, match_confidence, provider/inferred relationship, human_confirmed |
| `intelligence_exposures` | entity/observation → firm record | exposure_type, target, direction, magnitude, materiality, rationale |
| `intelligence_assessments` | FundExecs' interpretation | 5 relevance dims + materiality/urgency/confidence, actionability, time_horizon, implications, invalidators, monitoring_condition, recommended_action, assigned_agent, required_tier, **score_breakdown**, weights_version |
| `watchlists` / `watchlist_items` | scope (workspace/fund/mandate/deal/portfolio/user) | config (thresholds/cadence/escalation); ten-concern cap is a plan constraint in app logic, NOT hard-coded |

## 6. Native relevance & materiality engine (`relevance.ts`)

Every dimension stays **separately visible** (never one opaque number). Trust (evidence, freshness, confidence, provider calibration) is a **discount multiplier** in `[0,1]` — it can only pull actionability down, so an unreceipted/stale lead cannot ride firm-relevance to the top. Provider trajectory/acceleration is **one input** (a neutral urgency hint), not the score. Weights are **workspace-configurable, versioned (`weights_version`), auditable (`score_breakdown`), and overrideable**.

`actionability = baseRelevance × trustMultiplier`, `baseRelevance = weightedAvg(dimensions)`, `trustMultiplier = evidence × freshness × confidence × calibration`.

## 7. Earn & executive routing matrix (`routing.ts`)

Dominant relevance dimension → specialist + follow-on `ActionKind` + gate tier (derived from `gates.ts`). Structural invariant: **an external signal can never yield a Tier-3 follow-on** (test-enforced).

| Dominant dimension | Agent (`AgentKey`) | Follow-on | Tier |
|---|---|---|---|
| Regulatory | `executive_advisor` (risk/compliance synthesis) | `draft_memo` | 1 |
| Deal | `diligence` | `research` | 1 |
| Portfolio | `portfolio_ops` | `research` | 1 |
| Relationship (LP) | `investor_relations` | `distribute_report` | 2 |
| Relationship (lender/capital) | `capital_connector` | `send_outreach` | 2 |
| Mandate/thesis | `deal_sourcer` | `send_outreach` | 2 |
| None dominant | `analyst` | `research` | 1 |

Earn (`associate`) coordinates; the bridge signal is class `market` (external-grounded), which `lib/proactive/gate.ts` floors to investor-facing so external data never auto-sends.

## 8. Approval policy

Reuses `lib/gates.ts` unchanged. Tier 0 (observe: ingest/dedup/match/score/assess) runs automatically — none of it is an outward action. Tier 1 (internal analysis) is the default follow-on. Tier 2 (external prep) requires sign-off unless a mandate pre-authorizes. **Tier 3 (capital/legal/regulated) is never emitted by intelligence routing and never autonomously executed from a signal.**

## 9. Event architecture

No new bus. Sync is a best-effort, flag-gated block in the hourly `/api/cron` sweep (`runIntelligenceSyncAllOrgs`), mirroring the proactive/radar/webhook blocks; `intelligenceAssessed` is recorded in `cron_runs`. The logical events in the spec (`intelligence.observation.created`, `…assessment.completed`, `…provider.schema_drift`, etc.) map to table writes + Realtime on observations/assessments and to sync-summary fields; a formal event catalog is a follow-on.

## 10. Rate limits, caching, resilience

Connector client (`providers/signal-bureau/client.ts`): per-request timeout (AbortController), exponential backoff with jitter, `retry-after` honouring, retry classification (429/5xx/network retryable; 4xx terminal), bounded attempts. Sweep is capped per run and hourly — never polls faster than the feed materially changes. A provider outage returns a degraded, non-throwing result; **previously-stored observations/assessments stay fully available** (`listRecentObservations`). Connection health/last-error is recorded on every sync.

## 11. Security threat model

- **Tenant isolation:** every table `organization_id` + canonical RLS; every store read/write explicitly org-scoped (RLS is the backstop, not the only guard).
- **Secrets:** provider tokens encrypted with the AES-256-GCM vault (`FUNDEXECS_VAULT_KEY`); plaintext decrypted server-side in-memory only, never returned to the browser; masked last-4 for display.
- **Untrusted external content:** provider payloads are treated as data — normalized through the adapter, preserved verbatim in `raw_payload`, never spliced into a system prompt. Unreceipted leads are visibly distinguished from receipted evidence and never presented as fact.
- **Least privilege:** provider admin gated by `is_org_writer`; RBAC via `lib/rbac.ts`.
- **Schema drift:** unknown provider fields are tolerated (kept in raw payload) and reported as drift telemetry — no injection of unexpected fields into business logic.
- **Capital safety:** routing can never emit a Tier-3 action; the gate layer enforces the rest.

## 12. Test plan (delivered)

93 unit tests across `lib/intelligence/*.test.ts` (all green; full suite 3031 green, no regressions):
schema normalization, additive-schema tolerance, unknown fields, invalid/malformed payloads, missing evidence, receipted-vs-unreceipted, trajectory normalization, dedup content-hash stability + change detection, entity resolution (external-id/exact/alias/inferred + confidence caps), relevance scoring (dimension visibility, trust discount, weight override/version), routing (every branch + Tier-3 safety invariant), assessment building + exposure derivation + freshness discount, feature-flag gating (capability requires core), freshness verdict, signal-bridge mapping (market vs internal class, hub placement, provenance).

**End-to-end (backlog):** enable connector → fetch → normalize → match → link exposure → assess → route to Earn → approve → complete → brief. The pure and store seams are unit-covered; a DB-backed E2E awaits a local Supabase.

## 13. Feature-flag rollout

`lib/intelligence/flags.ts` — all off by default; a capability is live only when `INTELLIGENCE_CORE_ENABLED` is also on.

| Phase | Flags | Ships |
|---|---|---|
| 0 Audit/activate | — | this doc + migration + core lib |
| 1 Native foundation | `intelligence_core`, `intelligence_watchlists` | observations, entities, watchlists, manual entry, assessments **(landed)** |
| 2 Signal Bureau REST | `provider_signal_bureau` | feed ingestion, normalization, dedup, provider health, sync **(landed)** |
| 3 Relevance/exposure | `intelligence_exposure_mapping` | exposure mapping + Earn routing **(landed; DB exposure→live-record join = follow-on)** |
| 4 MCP + entity intel | `provider_signal_bureau_mcp` | entity dossiers, calibration, today's brief (declared; runtime binding follow-on) |
| 5 Future-event | `provider_signal_bureau_ask`, `intelligence_scenarios` | async `ask` jobs, scenario prose (client + provider ready; async job = follow-on) |
| 6 Private desks | `intelligence_private_desks` | priority concerns, briefs, SLAs (follow-on) |

## 14. Implementation backlog (next increments, with acceptance criteria)

Each item: objective · reuse · files · acceptance · rollback (all rollbacks = drop the additive files / flip the flag off; the migration is idempotent and additive).

1. **Provider settings panel** — enable/test/disable Signal Bureau, store base URL + token.
   Reuse: `McpServersPanel` + `mcp-actions.ts` pattern, `lib/vault.ts`, `connections.ts`.
   Accept: an admin can connect, test (`available()`), and revoke; token never leaves the server; masked last-4 shown.
2. **Intelligence detail drawer + hub sections** — render observations/assessments with full provenance, exposures, "why surfaced", scenario, controls (confirm/dismiss/mute/monitor).
   Reuse: `ProactiveInitiative.tsx` (built, unmounted) as the card pattern; dashboard section slot.
   Accept: every item shows provider, provider timestamp vs ingestion timestamp, evidence status, source links, the dimension breakdown, assigned executive, required tier, and provider-supplied vs inferred vs human-confirmed attribution.
3. **Operating Brief intelligence section** — "what changed / why it matters / exposures / decisions / monitoring / stale".
   Reuse: `lib/operating-brief.ts`, `listRecentObservations`.
   Accept: section renders live from stored assessments; hidden when empty.
4. **Register `intelligence_observation` proactive trigger** — wire `signal-bridge.ts` into `lib/proactive/triggers/registry.ts`.
   Accept: an actionable assessment surfaces a gated proactive Command via the existing loop; no parallel orchestrator.
5. **Exposure → live-record join** — resolve `tracked_entities.external_identifiers` to real `deals`/`funds`/`investors` rows.
   Accept: an exposure links to an actual record; materiality reflects position size.
6. **MCP-mode binding + async `ask` jobs + private desks** — per phases 4–6.
7. **Regenerate DB types** — replace the narrow `unknown`-casts in `store.ts`/`connections.ts` with generated types.
   Accept: `npm run db:types` regenerated; casts removed.

## 15. Definition-of-Done status

Met now: FundExecs works with Signal Bureau disabled; connector is optional/removable; payloads normalized into canonical schemas; provenance preserved on every observation; unreceipted leads visibly distinguished; external attention translated into firm-specific multi-dimensional relevance; routing targets the correct executive; gates prevent Tier-3/unauthorized external action; rate limits + outages degrade gracefully; workspace data isolated; users *can* explain why an item surfaced (`score_breakdown`); all material actions auditable; no active capability duplicated.
Pending (backlog): the UI surfaces that let a user *see/correct/dismiss/monitor* in-product, and the live proactive-trigger wiring — all additive follow-ons behind the same flags.
