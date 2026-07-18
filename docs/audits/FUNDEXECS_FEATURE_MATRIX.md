# FundExecs OS — Feature Matrix (Phase 0 Audit)

**Purpose.** Ground truth of what exists in the repository today, classified by
production status, so the Private Markets Intelligence Terminal + Extension
Platform builds on real capabilities rather than rebuilding working ones. Derived
from a read-only inventory of `app/`, `lib/`, `components/`, and 229 Supabase
migrations. Every row cites evidence.

**Status legend:** `Active` = production-ready · `Active~` = active but incomplete
· `UI-only` = mocked/scaffolded surface · `Backend-only` = logic without a rendered
surface · `Dup` = duplicated/superseded · `Broken` = present but non-functional ·
`Missing`.

**Rule honored throughout:** *do not rebuild a functioning capability solely for a
different visual treatment.* The terminal wraps and composes these; it does not
replace them.

---

## 1. Identity, access, tenancy

|                                     Capability                                      |       Status        |                           Evidence                           |
|-------------------------------------------------------------------------------------|---------------------|--------------------------------------------------------------|
| Email/password + Google OAuth (Supabase Auth)                                       | Active              | `app/login/actions.ts`, `app/auth/callback/route.ts`         |
| Session/active-org resolution (`getSessionContext`, `requireOrgContext`)            | Active              | `lib/auth.ts:23-61`                                          |
| Principal auto-provisioning + org owner bootstrap                                   | Active              | `supabase/migrations/0002_identity.sql`, `0010_rls.sql`      |
| Onboarding wizard (profile→org→mandate→trial credits)                               | Active              | `app/onboarding/actions.ts`                                  |
| RBAC roles owner/admin/member/viewer                                                | Active              | `lib/rbac.ts`, enum `member_role`                            |
| RLS tenant isolation (`current_principal_org_ids`, `is_org_writer`, `is_org_admin`) | Active              | `0010_rls.sql`, `0002_identity.sql:94-121`                   |
| Platform (super) admin gate                                                         | Active              | `lib/platform-admin.ts` (app-layer only)                     |
| Credits / atomic usage metering                                                     | Active              | `lib/credits.ts`, `20260704022000_atomic_credit_spend.sql`   |
| Billing plans/packs (config-as-code)                                                | Active~             | `lib/billing.ts` (no subscription-lifecycle table)           |
| API keys (`fxpk_`/`fxsk_`, test/live)                                               | Active              | `lib/api-keys.ts`, `0044_api_keys.sql`                       |
| API v1 scopes + per-route enforcement                                               | Active              | `lib/api-v1.ts:35-61`, 7 scopes                              |
| API write-as-approval (external writes → approval queue)                            | Active              | `lib/api-write-requests.ts`, `app/api/v1/deals/route.ts`     |
| Secret vault (AES-256-GCM, `org_secrets`)                                           | Active              | `lib/vault.ts`, `0044_api_keys.sql`                          |
| MCP server registry (per-org, vaulted token)                                        | Active~             | `20260714120000_mcp_servers.sql` — registry only, no runtime |
| Unified `user_preferences` store                                                    | Missing (scattered) | digest/source/shortcut prefs live per-feature                |

## 2. Shell, orchestration, approvals

|                                   Capability                                    |      Status      |                                      Evidence                                      |
|---------------------------------------------------------------------------------|------------------|------------------------------------------------------------------------------------|
| App shell (sidebar, topbar, mobile shell, command palette mount)                | Active           | `app/(app)/layout.tsx`, `components/AppSidebar.tsx`                                |
| Four lifecycle hubs Build/Source/Run/Execute                                    | Active           | `lib/hubs.ts` (Run is `approvalGated`)                                             |
| **Global Cmd-K command palette** (nav + hub modules + "ask earn")               | Active           | `components/GlobalCommandPalette.tsx`, `CommandPalette.tsx`, `lib/nav-commands.ts` |
| Composer-local ⌘K (models/modes/slash inserts) + `[data-owns-cmdk]` arbitration | Active           | `components/Copilot.tsx:1135-1164`                                                 |
| Earn composer / Copilot (chat vs gated workflow)                                | Active           | `components/Copilot.tsx`                                                           |
| Sessions system (session = unit of work)                                        | Active           | `lib/engine.ts:399-415`, `app/(app)/session/[id]`                                  |
| Task engine (plan→approve→execute→persist, idempotent CAS)                      | Active           | `lib/engine.ts` (`executeWorkflow`, `decideApproval`)                              |
| 3-tier approval gates + blast-radius                                            | Active           | `lib/gates.ts`                                                                     |
| Autonomy resolution (tier→auto/semi/manual)                                     | Active           | `lib/autonomy.ts`                                                                  |
| Mandates (standing delegation, screening criteria)                              | Active           | `lib/mandates.ts`, `0029_mandates.sql`                                             |
| Skill runtime + `skill_runs` ledger (37 skills)                                 | Active           | `lib/skills/registry.ts`, `store.ts`                                               |
| Engine write-back to canonical records (deals/assets/artifacts/tasks)           | Active           | `lib/engine.ts:258-393` (`persistOutcome`)                                         |
| Executive roster — 15 execution agents                                          | Active           | `lib/agents.ts`                                                                    |
| Executive roster — 13 operational executives (governance overlay)               | Active           | `lib/executives/registry.ts`                                                       |
| Executive roster — `VirtualExecutiveRole` (12)                                  | Dup (superseded) | `lib/executive-team.ts`                                                            |
| Execution Grid (7 engine panes, realtime)                                       | Active           | `app/(app)/grid`, `lib/execution-grid.ts`                                          |
| Command Center dashboard (fixed HUD)                                            | Active           | `app/(app)/dashboard`, `components/CommandCenter.tsx`                              |
| Virtual Office (2.5D Phaser world, canonical home)                              | Active           | `app/(app)/virtual-office`, `components/virtual-office/*`                          |
| Automations + visual canvas                                                     | Active           | `lib/automation-canvas.ts`, `app/(app)/automations`                                |
| Mobile shell (bottom tabs, FAB, PWA, offline, approvals flow)                   | Active           | `components/mobile/*` (~40 files)                                                  |
| **Multi-pane / dockable / resizable / saved-layout workspace**                  | **Missing**      | greenfield — only inert `splitRef` vestige in `Copilot.tsx`                        |
| **Executable command language** (parsed commands w/ schema + side-effects)      | **Missing**      | palette is nav-only; slash commands are text scaffolds                             |
| Declared-but-unwired keyboard shortcuts (⌘B, ⌘/, hub jumps)                     | Broken           | `lib/shortcuts.ts` (display list, no handlers)                                     |

## 3. Entities, CRM, pipelines, search

|                                Capability                                 |       Status        |                                        Evidence                                        |
|---------------------------------------------------------------------------|---------------------|----------------------------------------------------------------------------------------|
| Canonical business tables (deals, investors, funds, assets, commitments…) | Active              | migrations 0004–0005; ~24 of 40 target entities first-class                            |
| `tracked_entities` monitoring universe (15 types)                         | Active              | `20260718120000_intelligence_core.sql:70`                                              |
| Deal / Investor / Asset "War Room" workspaces                             | Active              | `lib/{run,source,execute}-war-room.ts`, `components/{run,source,execute}/*WarRoom.tsx` |
| **Fund / Company / Person research workspace**                            | Missing             | no `/fund/[id]`, `/company/[id]`, `/person/[id]`                                       |
| Relationship graph (polymorphic, 3 kinds) + GraphExplorer                 | Active              | `0006_graph.sql`, `lib/graph.ts`, `app/(app)/graph`                                    |
| Capital map (LP capital graph, warm-intro pathfinding)                    | Active              | `lib/capital-map.ts`, `lib/relationship/warm-intro.ts`                                 |
| CRM contacts / lists / DNC / relationship scoring                         | Active              | `network_contacts`, `lib/relationship-score.ts`                                        |
| Deal pipeline + configurable stages                                       | Active              | `lib/pipeline-stages.ts`, `app/(app)/deals/feed`                                       |
| Fundraising / prospecting pipeline                                        | Active              | `lib/relationship/prospect-*.ts`, `app/(app)/prospecting`                              |
| Outreach sequences / campaigns / cadences                                 | Active              | `lib/outreach-sequences.ts`, `app/(app)/campaigns`                                     |
| Confidence-scored entity resolution                                       | Active~             | `lib/intelligence/entity-match.ts`, `dedup.ts` (over `tracked_entities` only)          |
| Cross-table entity resolution (dedupe deals/investors/funds)              | Missing             | resolver not applied to concrete tables                                                |
| Global search                                                             | Active~             | `lib/search.ts` — deals/investors/assets only, `ILIKE`, no people/funds/docs           |
| Semantic / vector search                                                  | Active~ (siloed)    | `sourcing_entities` embeddings, `brain_kb_hybrid_search` — not in global path          |
| Canonical `interactions`/touchpoint timeline                              | Missing (scattered) | across meetings/inbox/activity/engagement                                              |

## 4. Financial analysis, data room, diligence, portfolio, fund admin

|                                 Capability                                 |        Status         |                                            Evidence                                            |
|----------------------------------------------------------------------------|-----------------------|------------------------------------------------------------------------------------------------|
| Distribution waterfall / carry (single + tiered/multi-period)              | Active                | `lib/waterfall.ts`, `lib/waterfall-schedule.ts`                                                |
| LBO returns engine + underwriting scenarios                                | Active                | `lib/lbo-model.ts`, `lib/underwriting-calc.ts`                                                 |
| Cap table / convertibles / exit scenarios / secondaries                    | Active                | `lib/cap-table.ts`, `convertibles.ts`, `exit-scenarios.ts`, `secondaries.ts`                   |
| DCF / comps / 3-statement / model-audit / returns skills                   | Active                | `lib/skills/catalog/*`                                                                         |
| Save/load LBO & waterfall scenarios                                        | Active                | `lib/financial-scenarios.ts`, `financial_scenarios` table                                      |
| MOIC / DPI / RVPI / TVPI                                                   | Active                | `lib/lp-report.ts`, `execute-performance.ts`, `cap-table.ts`                                   |
| **True IRR (dated-cashflow XIRR)**                                         | **Missing**           | everywhere `MOIC^(1/yrs)−1` proxy or TVPI heuristic                                            |
| Portfolio monitor (marks vs cost, unrealized, stale/underperformer alerts) | Active                | `lib/portfolio-monitor.ts`                                                                     |
| Valuation marks (method/as_of/note, stale aging)                           | Active                | `valuation_marks`, `lib/valuation-history.ts`                                                  |
| Budget-vs-actual + covenant pass/breach (per-run skill)                    | Active~               | `lib/skills/catalog/portfolio-review.ts` (no standing register)                                |
| **Actual-vs-underwriting variance (portfolio surface)**                    | UI-only               | fields wired `null` — `portfolio/page.tsx:59-60`                                               |
| **Exposure by dimension (sector/geo/vintage/sponsor/lender)**              | UI-only / Missing     | types only, no aggregation builder                                                             |
| Data room (ODD/IDD taxonomy, coverage, tokenized share)                    | Active                | `lib/data-room.ts`, `app/dataroom/[token]`                                                     |
| Diligence checklist/templates + multi-lens risk memo                       | Active                | `lib/diligence-templates.ts`, `lib/diligence-agent.ts`                                         |
| Capital call / distribution allocation (Tier-3, atomic)                    | Active                | `lib/capital-ops.ts`                                                                           |
| Capital-call / distribution / LP-update NOTICE skills (draft-only)         | Active                | `lib/skills/catalog/*`                                                                         |
| Reporting (NAV/committed/called/distributed + K-1)                         | Active                | `components/execute/ExecuteModules.tsx`, `lib/lp-report.ts` (reports pages are redirect stubs) |
| Finance ops (AR/AP, banking, cashflow)                                     | Backend-only          | `app/(app)/finance/*/actions.ts` (no page)                                                     |
| **Fact/calculation/assumption provenance model**                           | Active (skill layer)  | `lib/skills/types.ts:33-43`                                                                    |
| Provenance surfaced in portfolio/reporting cockpit UI                      | Missing               | cockpit renders bare numbers                                                                   |
| AI overwriting verified financials                                         | Prevented (by design) | skill cores pure; ledger writes operator-gated Tier-3                                          |

## 5. Intelligence, signals, providers, observability

|                                Capability                                 |      Status       |                                          Evidence                                          |
|---------------------------------------------------------------------------|-------------------|--------------------------------------------------------------------------------------------|
| Intelligence Core schema (observations/exposures/assessments/watchlists…) | Active~ (dark)    | `20260718120000_intelligence_core.sql` — flags off, no UI                                  |
| Provider-neutral `ProviderObservation` anti-corruption boundary           | Active            | `lib/intelligence/types.ts`                                                                |
| Intelligence provider registry (Signal Bureau connector)                  | Active~           | `lib/intelligence/provider.ts`                                                             |
| Ingestion pipeline (fetch→adapt→freshness→dedup→match→exposures→assess)   | Active~           | `lib/intelligence/ingest.ts` (gated off by default)                                        |
| Scheduled intelligence sweep (hourly cron)                                | Active~           | `lib/intelligence/sweep.ts`, `app/api/cron/route.ts`                                       |
| **Watchlists (scope intelligence to targets)**                            | Broken/inert      | schema exists, no CRUD/UI, doesn't scope ingest                                            |
| Alert rules CRUD + fire + acknowledge                                     | Active~           | `lib/alert-rules.ts`                                                                       |
| **Alert rule evaluation**                                                 | **Broken (stub)** | `lib/alert-rules.ts:129-131` returns 0, not wired to cron                                  |
| **Alert delivery channels (slack/email/in-app) + escalation**             | Missing           | declared JSON only, no delivery code                                                       |
| Alerts UI page                                                            | Missing           | `app/(app)/alerts` absent; only JSON list API                                              |
| Intent Signals (first-party engagement)                                   | Active~           | `app/(app)/signals` (separate from intelligence core)                                      |
| **Native news / filings / event pipeline**                                | Missing           | only generic observations via optional connector                                           |
| Operating brief (deterministic internal)                                  | Active            | `lib/operating-brief.ts`                                                                   |
| Inference gateway (capability→model router) + `inference_runs` ledger     | Active            | `lib/inference/*`, `20260718180000_inference_runs.sql`                                     |
| Gateway adoption across app                                               | Active~           | only `lib/claude.ts` (flag-off) + `lib/brains/llm.ts`; ~40 files still hard-code Anthropic |
| Audit log (DB triggers) + dispatch log + attestations/seals               | Active            | `0009_audit.sql`, `0030_dispatch_log.sql`, `lib/attestations.ts`                           |
| Digests / radar-digest + engagement tracking                              | Active            | `lib/radar-digest.ts`, `0062_radar_digest.sql`                                             |

## 6. Integrations, jobs, extensibility

|                             Capability                             |           Status           |                         Evidence                         |
|--------------------------------------------------------------------|----------------------------|----------------------------------------------------------|
| Dispatch adapter registry (Gmail/Docusign/Slack/Calendly/finance…) | Active                     | `lib/integrations/registry.ts`, `adapters/index.ts`      |
| Merge gateway connection layer                                     | Active~                    | `lib/integrations/gateway.ts` (env/mock runtime)         |
| Composio + Carta connectors                                        | Backend-only               | `lib/integrations/{composio,carta}/*.server.ts`          |
| Inbound/outbound webhooks (HMAC, v1)                               | Active                     | `app/api/webhooks/[channel]`, `lib/webhooks-outbound.ts` |
| Cron sweep + evaluator + health                                    | Active                     | `app/api/cron`, `lib/cron.ts`, `cron-health.ts`          |
| Public v1 API (scoped, cursor-paginated)                           | Active                     | `lib/api-v1.ts`                                          |
| Execution provider factory (issuance/rail/identity)                | Active                     | `lib/providers/index.ts`                                 |
| Marketplace (deal/LP/service listings — NOT an app store)          | Active                     | `0008_marketplace.sql`, `app/(app)/marketplace`          |
| **Extension manifest / versions / installations tables**           | **Missing**                | zero matches in migrations/types                         |
| **Sandboxed extension execution of untrusted code**                | **Missing**                | MCP registry stores config, never executes               |
| **Extension admin review lifecycle**                               | **Missing**                | platform-admin is monitoring-only                        |
| Per-extension-scoped credentials                                   | Missing (mechanism exists) | vault keyed by `(org, provider)`, not extension instance |

---

## Reusable seams (the platform builds on these)

Eleven pluggable registries already follow the same house pattern — a pure,
dependency-free, unit-tested `Record<key, Definition>` with `get`/`list`/`available`:

1. Skills registry — `lib/skills/registry.ts` (versioned, schema-typed, tier+risk)
2. Inference provider registry + router — `lib/inference/*` (**System-12 base**)
3. Intelligence provider registry — `lib/intelligence/provider.ts` (**data-router base**)
4. Integrations dispatch adapters — `lib/integrations/registry.ts`
5. Professional-network connectors — `lib/integrations/professional-network/connectors.ts`
6. MCP server registry — `lib/mcp/registry.ts` (runtime deferred)
7. Execution provider factory — `lib/providers/index.ts`
8. Agent catalog — `lib/agents.ts`
9. Secret vault — `lib/vault.ts` + `org_secrets`
10. Gate tiers — `lib/gates.ts` (approval/blast-radius primitive)
11. API scopes — `lib/api-keys.ts` `API_SCOPES`

See `GLOOMBERB_PATTERN_ADOPTION_MATRIX.md` and `EXTENSION_PLATFORM_ARCHITECTURE.md`
for how each is extended vs. wrapped.
