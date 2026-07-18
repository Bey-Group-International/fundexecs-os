# FundExecs Terminal — Gap Audit (Phase 0)

**Purpose.** Classify every capability the Private Markets Intelligence Terminal +
Extension Platform spec (Systems 1–17) requires against what the repository
already provides, and mark each as: *Should remain native / Appropriate for an
extension / Should not be built (yet)*, with a build disposition:
`REUSE` (exists, wrap it) · `ACTIVATE` (exists but incomplete/dark, finish it) ·
`BUILD` (net-new native) · `EXTENSION` · `DEFER`.

The overriding finding: **FundExecs is a mature platform (229 migrations) with most
of the *substance* the terminal needs — entities, war rooms, gates, skills,
intelligence schema, provider registries, vault, approvals — already built.** The
terminal is largely a *composition + activation* layer, not a green-field product.
The two genuinely green-field pieces are (a) the multi-pane workspace shell and (b)
the extension platform's manifest/lifecycle/sandbox.

---

## System 1 — Multi-pane Terminal shell (`/terminal`)

| Requirement | Exists? | Disposition |
|---|---|---|
| Resizable/dockable/floating panes, tabs, saved layouts, presets | **No** — all surfaces are fixed dashboards/war-rooms; only an inert `splitRef` vestige | **BUILD** (native, green-field) |
| State persistence per user + org, deep-linkable | No (per-feature prefs only) | **BUILD** → `terminal_workspaces`/`terminal_layouts`/`terminal_panes` |
| Error boundaries + independent pane loading | Partial (RSC Suspense patterns exist) | REUSE patterns |
| Responsive mobile fallback | Mobile shell is strong (`components/mobile/*`) | REUSE — stacked-pane fallback |
| Default workspace presets (Underwriting, Fundraising, IR, Portfolio, Diligence, Market Intel, Fund Ops, Capital Formation, Credit, Exec Brief) | Content for most presets exists (war rooms, portfolio, capital-map, operating-brief); the *shell to compose them* does not | **BUILD** shell, **REUSE** pane content |

**Verdict:** Native. The shell is the single largest net-new build. Panes are
adapters over existing surfaces (`DealWarRoom`, `CapitalMap`, portfolio, `Copilot`,
signals, operating brief).

## System 2 — FundExecs Command Language

| Requirement | Exists? | Disposition |
|---|---|---|
| Cmd-K palette, visible button, composer entry, mobile launcher | **Yes** — `GlobalCommandPalette` + `CommandPalette` + `Copilot` ⌘K + `[data-owns-cmdk]` arbitration | **REUSE** |
| Nav/entity commands (`DEAL`, `FUND`, `LP`, `PIPE`, `REL`…) | Nav catalog exists (`lib/nav-commands.ts`) but is destinations-only | **ACTIVATE** → parse entity commands into war-room/workspace loads |
| Analysis commands (`LBO`, `VAL`, `COMPS`, `RETURNS`, `WATERFALL`, `IC`…) | Underlying engines/skills all exist (`lib/lbo-model.ts`, `skills/*`) | **BUILD** command registry that dispatches to them |
| Workflow commands (`SOURCE`, `OUTREACH`, `CAPCALL`, `REPORT`, `ASK EARN`…) | Engine `handlePrompt`/`planPrompts` + gates exist | **BUILD** command → workflow binding |
| Each command declares schema, permissions, providers, agent owner, side-effect level, approval, dry-run, audit | None declared today | **BUILD** — the `CommandDefinition` contract (mirror `SkillManifest`) |
| NL request → proposed command plan before execution | Engine already produces reviewable plans; `Copilot` "ask earn" passthrough exists | **ACTIVATE** — surface the plan as an editable command sequence |

**Verdict:** Native. Build a **command registry** (new) on top of the existing
palette primitive + engine + gates. This is the terminal's spine.

## System 3 — Universal entity model

| Requirement | Exists? | Disposition |
|---|---|---|
| ~40 canonical entities | ~24 first-class tables, ~13 partial, 2 derived (Opportunity, Capital account) | **REUSE** + **ACTIVATE** the partials |
| Company / Person as unified canonical tables | No (scattered across `tracked_entities`, `network_contacts`, `assets`, deal targets) | **BUILD** thin canonical `companies`/`persons` or a resolution view |
| Provenance/confidence/source/last-verified on entities | Present on `tracked_entities` + `intelligence_observations`; sparse on business tables | **ACTIVATE** — extend provenance columns where a research workspace needs them |
| Entity resolution (no silent low-confidence merge) | Confidence-scored resolver exists over the monitoring universe | **REUSE** + **ACTIVATE** — extend to concrete tables |

**Verdict:** Native. Mostly reuse; the net-new is a canonical Company/Person spine
and cross-table resolution.

## System 4 — Unified research workspace

| Requirement | Exists? | Disposition |
|---|---|---|
| Company / deal / fund / investor integrated workspace | Deal/Investor/Asset "War Rooms" exist and are rich | **REUSE** (deal, investor, portfolio-company) |
| Fund workspace | **No** `/fund/[id]` | **BUILD** |
| Company (pre-deal target) workspace | **No** | **BUILD** |
| Investor workspace | Yes (`InvestorWarRoom`) | **REUSE** |
| Generic configurable workspace shell (vs 3 bespoke loaders) | No — each war room is a separate loader | **BUILD** a workspace framework so panes/tabs are configurable (feeds System 1) |

**Verdict:** Native. Reuse the war rooms as the first workspace *content*; build
the missing Fund/Company workspaces and generalize into the terminal shell.

## System 5 — Watchlists, signals, alerts

| Requirement | Exists? | Disposition |
|---|---|---|
| Watch companies/funds/investors/people/sectors/deadlines… | Schema exists (`watchlists`/`watchlist_items`, 15 `tracked_entities` types) but **inert** — no CRUD, no UI, doesn't scope ingest | **ACTIVATE** (store CRUD + UI + wire into `FetchSpec.entities`) |
| Signal types (financing, exec change, covenant, deadline, mandate match…) | Ingestion→assessment pipeline exists; signal-bridge maps to proactive | **ACTIVATE** (turn on flags, register the trigger) |
| Alert evaluation | **Broken stub** (`alert-rules.ts:129-131` returns 0, not in cron) | **BUILD** real evaluator + wire to cron |
| Alert delivery (in-app/email/Slack/push/digest) | Declared JSON only, no delivery | **BUILD** delivery + **EXTENSION** for Slack/Teams |
| Alert UI (dismiss/snooze/assign/convert-to-workflow) | No `app/(app)/alerts` page | **BUILD** |

**Verdict:** Native core, extension delivery channels. Highest activation value —
the architecture is present but dark.

## System 6 — Portfolio & exposure cockpit

| Requirement | Exists? | Disposition |
|---|---|---|
| MOIC/DPI/RVPI/TVPI, NAV series, marks-vs-cost, concentration, stale alerts | **Yes**, multiple consistent engines | **REUSE** |
| **True IRR (XIRR over dated cashflows)** | **No** — proxy/heuristic only | **BUILD** (an `xirr` engine; back-fill fund + asset IRR) |
| Actual-vs-budget / actual-vs-underwriting at portfolio level | Skill computes it per-run; portfolio surface wired `null` | **ACTIVATE** (feed underwriting cases into the cockpit) |
| Exposure by industry/geo/vintage/sponsor/lender/… | Types only, **no aggregation builder** | **BUILD** exposure aggregator |
| Standing covenant register + breach dashboard | Skill-only, no register | **BUILD** |
| Scenario runs (rate/FX/multiple/delay) at cockpit level | Exit-sweep exists; broader stress does not | **ACTIVATE**/**BUILD** |
| Figures show methodology/source/timestamp; AI never overwrites verified data | Provenance model strong at skill layer; **cockpit UI drops it**; ledger writes are Tier-3 operator-gated | **ACTIVATE** (thread `SkillSource` provenance into cockpit UI) |

**Verdict:** Native. Reuse the metric engines; build XIRR + exposure aggregator +
covenant register; surface provenance.

## System 7 — News / filings / event intelligence

| Requirement | Exists? | Disposition |
|---|---|---|
| Normalized feed (PE/M&A/credit/fundraising/filings/macro/exec change) | No native pipeline; arrives only as generic `intelligence_observations` via optional connector | **EXTENSION** (SEC/EDGAR, macro, news providers) feeding the **native** intelligence core |
| Earn transforms raw → what/why/mandate/entity/materiality/action | `lib/intelligence` assessment + routing does exactly this shape | **REUSE**/**ACTIVATE** |
| Verified fact vs provider estimate vs AI inference vs user-entered | `ProviderObservation` evidence/attribution vocab already separates these | **REUSE** |

**Verdict:** Native intelligence core + **extension** providers (SEC, macro, news).

## System 8 — Earn as terminal orchestrator

| Requirement | Exists? | Disposition |
|---|---|---|
| Open/configure panes, load entities, run workflows, delegate, summarize workspace | Engine + Copilot + executive delegation exist | **REUSE** + **ACTIVATE** (give Earn terminal-control commands) |
| Earn Work Plan panel (objective/assumptions/data/executives/commands/gates/status) | Engine produces plans + steps + gates; not surfaced as a work-plan panel | **BUILD** (a pane over existing plan/step data) |
| Write-back to canonical records | Robust for deals/assets/artifacts/tasks; gaps for diligence/KPI/LP | **REUSE** + **ACTIVATE** (extend `persistOutcome` targets) |

**Verdict:** Native. Mostly wiring Earn's existing planning into terminal control.

## System 9 — Structured action & safety contract

| Requirement | Exists? | Disposition |
|---|---|---|
| Shared side-effect classification (read-only…destructive, 10 levels) | 3-tier gate model exists (`lib/gates.ts`) — coarser | **ACTIVATE** — map the 10 levels onto the existing tiers as a shared contract for commands+agents+APIs+plugins |
| Dry-run/preview/explain/approve/reject/revise/retry/rollback/escalate/audit | Approve/reject/revise/retry + audit exist; dry-run/preview/explain/rollback partial | **BUILD** the missing verbs into the command contract |
| Capital-binding always non-delegable; plugins may never weaken controls | Enforced today (Tier-3 non-delegable) | **REUSE** — extend the invariant to plugins |

**Verdict:** Native. Extend gates into a unified action contract; do not fork it.

## System 10–12 — Extensions, reference extensions, provider router

| Requirement | Exists? | Disposition |
|---|---|---|
| Extension manifest / versions / installations tables | **No** | **BUILD** |
| Declarable capabilities (pane/command/tab/column/provider/tool/report/alert/importer…) | The *targets* exist as registries; no capability-declaration layer | **BUILD** manifest that registers into the existing registries |
| Explicit permission scopes (`entities:read`, `deals:write`, `communications:send`…) | API scopes exist (7); need an extensible namespace | **ACTIVATE**/**BUILD** |
| Isolation (signed packages, sandboxed workers, JSON-RPC, iframe, allowlists, timeouts, per-tenant creds) | None; MCP registry is config-only | **BUILD** (largest security net-new) |
| Lifecycle (discover→request→admin review→install→configure→enable→disable→update→rollback→uninstall→revoke) | Platform admin is monitoring-only; approval queue reusable | **BUILD** state machine on gates + audit |
| Data-provider router (provider-neutral data access) | `lib/intelligence/provider.ts` is ~80% this; `lib/inference/*` is the model router | **REUSE**/**ACTIVATE** (add connectors + merge/failover) |
| Reference extensions (SEC, macro, email/cal, KPI importer, data-room, comms, Gloomberb interop) | Connectors partially exist (Composio EDGAR/Marketstack, professional-network) | **EXTENSION** (build after SDK) |

**Verdict:** Extension platform is the second green-field build. Reuse the vault +
gates + approval spine + registries; build manifest/lifecycle/sandbox.

## System 13–16 — UX, DB/backend, observability, testing

| Requirement | Exists? | Disposition |
|---|---|---|
| Institutional dark/light, dense, accessible, keyboard-first, responsive | Design system + mobile shell exist; dark theme exists | **REUSE** + extend for panes |
| Loading/empty/error/permission/disconnected/stale-data states | Patterns exist per-surface; must be standardized per pane | **ACTIVATE** |
| New tables (terminal_*, saved_commands, command_runs, watchlists, signal_rules, alerts, data_providers, provider_*, entity_*, extension_*) | watchlists/alerts/provider-connections/entity-sources exist; terminal_*/saved_commands/command_runs/extension_* missing | **BUILD** the missing; **REUSE** the rest |
| Observability (command usage, provider latency, agent latency, extension health…) | `inference_runs` + `audit_log` + `dispatch_log` + cron-health strong | **REUSE** + **ACTIVATE** (add command_runs + extension_events) |
| Unit/integration/e2e per the spec's list | Deep Jest suite exists (3,678 tests); e2e sparse | **BUILD** the terminal/command/extension test suites |

## System 17 — Sequence

Matches the repo's reality: Foundation (shell + command registry + action contract)
→ Intelligence (activate watchlists/alerts/providers) → Financial (XIRR + exposure +
provenance surfacing) → Earn orchestration → Extensions → Hardening. **Do not start
the extension marketplace before the command + permission + audit contracts are
stable** — the audit confirms those contracts (gates, scopes, vault, approvals)
exist and only need unification.

---

## Net disposition summary

- **REUSE (already production-grade):** entities/war-rooms, gates/mandates/autonomy,
  skills runtime, engine write-back, capital-map/graph, financial metric engines,
  data room, diligence, vault, API scopes, inference gateway, audit/attestations,
  the Cmd-K palette primitive, mobile shell, cron.
- **ACTIVATE (present but dark/incomplete):** watchlists, intelligence sweep flags,
  entity commands, actual-vs-underwriting, provenance-in-cockpit, gateway adoption
  across the ~40 hard-coded-Anthropic files, provider router connectors.
- **BUILD (native green-field):** multi-pane terminal shell, command registry +
  language, XIRR, exposure aggregator, covenant register, alert evaluator+delivery,
  Fund/Company workspaces, Earn Work Plan pane, unified action contract verbs,
  `terminal_*`/`saved_commands`/`command_runs` tables.
- **BUILD (extension platform):** manifest/versions/installations, per-extension
  credentials, sandboxed execution, admin review lifecycle.
- **EXTENSION (after SDK):** SEC/EDGAR, macro, email/calendar, KPI importer,
  external data-room, Slack/Teams, Gloomberb read-only interop.
- **DEFER / do-not-build-yet:** trade execution via Gloomberb interop; unrestricted
  remote-code extension installation; org-switcher (needed for cross-org terminal).
