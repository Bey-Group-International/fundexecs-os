# Private Markets Intelligence Terminal — Architecture (Phase 0)

**Scope.** The native `/terminal` operating environment: a configurable multi-pane
workspace driven by a command language, composing existing FundExecs surfaces,
governed by the existing approval/audit spine. This document defines the
components, data model, and contracts. It does **not** yet write production code —
it is the blueprint the implementation plan sequences.

**Design tenets**
1. **Compose, don't replace.** Panes are adapters over existing surfaces
(`DealWarRoom`, `CapitalMap`, portfolio, `Copilot`, signals, operating brief).
2. **One system of record.** The terminal reads/writes the same Supabase tables
under the same RLS; it introduces no shadow store.
3. **Everything routes through gates.** Every command inherits the 3-tier gate +
mandate + autonomy model (`lib/gates.ts`, `lib/mandates.ts`, `lib/autonomy.ts`).
4. **Provider-neutral.** Data comes through the intelligence provider router; models
through the inference gateway. No vendor is hard-coded above those seams.
5. **Native strategic core; extensions are optional.** No terminal capability
depends on a third-party runtime.

---

## 1. Component map

```
/terminal (App Router route, inside app/(app) shell — shares auth, RLS, nav)
├─ TerminalShell ...................... pane manager: layout, dock, resize, tabs, presets
│   ├─ PaneHost[] ..................... error boundary + Suspense + refresh per pane
│   │   └─ Pane adapters .............. wrap existing surfaces (see §4)
│   └─ LayoutPersistence .............. terminal_workspaces / terminal_layouts / terminal_panes
├─ CommandBar (extends CommandPalette) . parse → resolve → plan → confirm → dispatch
│   └─ CommandRegistry ............... CommandDefinition[] (schema, permissions, side-effect, agent, providers)
├─ ActionContract ..................... side-effect classification + gate resolution (wraps lib/gates.ts)
├─ EarnWorkPlanPane ................... objective → commands → executives → gates → status (over engine plans)
├─ DataProviderRouter ................. lib/intelligence/provider.ts (+ merge/failover)
└─ Observability ...................... command_runs + inference_runs + audit_log + dispatch_log
```

## 2. Data model (new tables; reuse existing where noted)

New (organization-scoped, member-read / writer-write RLS, `updated_at` trigger,
soft-delete where a layout can be restored):

|         Table         |                         Purpose                          |                                              Notes                                               |
|-----------------------|----------------------------------------------------------|--------------------------------------------------------------------------------------------------|
| `terminal_workspaces` | Named workspace preset per user/org                      | `owner_principal_id`, `is_shared`, `preset_key`                                                  |
| `terminal_layouts`    | Serialized pane tree + sizes/docking for a workspace     | jsonb `layout`, `version` for schema evolution                                                   |
| `terminal_panes`      | Optional normalized pane rows (or embed in layout jsonb) | `pane_type`, `entity_ref`, `settings`                                                            |
| `saved_commands`      | User/org saved + recent commands                         | `command`, `args`, `last_used_at`                                                                |
| `command_runs`        | Append-only command execution ledger                     | `command`, `side_effect_level`, `status`, `gate_tier`, `dry_run`, latency; observability + audit |

Reuse (already exist): `watchlists`/`watchlist_items`, `alert_rules`/`alert_events`,
`intelligence_provider_connections`, `entity_observation_links` (entity sources),
`relationships` (entity graph), `skill_runs`, `inference_runs`, `audit_log`.

Deep-linking: a workspace is addressable as `/terminal/w/[workspaceId]` and a
transient state as a URL-serialized `terminal_layouts.layout` fragment.

## 3. Command registry & language

A command is a typed definition mirroring `SkillManifest` (`lib/skills/types.ts`)
so the terminal reuses the same governance vocabulary:

```ts
interface CommandDefinition {
  verb: string;                 // "DEAL" | "LBO" | "CAPCALL" | "ASK EARN" ...
  aliases: string[];
  description: string;
  example: string;
  inputSchema: JsonSchema;      // parsed args
  outputSchema: JsonSchema;
  requiredScopes: string[];     // reuse lib/api-keys API_SCOPES vocabulary, extended
  requiredProviders?: string[]; // data-provider capabilities
  agentOwner?: ExecutiveKey;    // lib/executives/registry.ts
  sideEffect: SideEffectLevel;  // see §5
  approval: "none" | "tier2" | "tier3";  // maps to lib/gates.ts
  dryRunnable: boolean;
  audit: true;                  // every command writes command_runs
  run(ctx, args): CommandResult | Plan;  // read-only → result; side-effecting → Plan for approval
}
```

Resolution pipeline:
1. **Parse** — exact verb / alias / entity-name / natural language.
2. **Resolve** — NL → a proposed **command plan** (ordered `CommandDefinition`
invocations) using the existing engine planner (`lib/engine.ts handlePrompt`).
3. **Preview** — render the plan as an editable sequence (System 2 example: "analyze
Maple Street → load mandate → refresh diligence → underwrite → compare → draft IC
memo → pause for approval").
4. **Authorize** — each step's `sideEffect`/`approval` resolved through the action
contract; Tier-3 always pauses for human approval.
5. **Dispatch** — read-only executes immediately; side-effecting routes through the
engine + gates; writes land in canonical records; a `command_runs` row is written.

Command families (all dispatch to existing engines/skills):
- **Navigation/entity:** `DEAL/FUND/LP/GP/COMPANY/PERSON/LENDER/PORT/PIPE/REL/DOC/ROOM/WATCH/ALERTS` → war-room/workspace loads + entity resolver.
- **Analysis:** `LBO/VAL/COMPS/RETURNS/EXPOSURE/SCENARIO/RISK/IC/WATERFALL/CAPTABLE/BENCHMARK/RELGRAPH` → `lib/lbo-model.ts`, `lib/skills/catalog/*`, `lib/waterfall*.ts`, `lib/cap-table.ts`, `lib/graph.ts`.
- **Workflow:** `SOURCE/OUTREACH/CREATE */INGEST/ASSIGN/APPROVE/REJECT/CAPCALL/DISTRIBUTE/REPORT/EXPORT/ASK EARN` → engine `planPrompts` + gates + skills.

## 4. Panes (adapters over existing surfaces)

|                   Pane type                   |              Wraps               |                       Source                        |
|-----------------------------------------------|----------------------------------|-----------------------------------------------------|
| Deal / Investor / Portfolio-company workspace | War Rooms                        | `lib/{run,source,execute}-war-room.ts`              |
| Fund workspace                                | **new**                          | build on `funds` + `lib/lp-report.ts` + capital-map |
| Company / target workspace                    | **new**                          | build on `tracked_entities` + `sourcing_entities`   |
| Capital map / relationship graph              | existing                         | `lib/capital-map.ts`, `lib/graph.ts`                |
| Portfolio & exposure cockpit                  | existing + **new XIRR/exposure** | `lib/portfolio-monitor.ts` + new aggregator         |
| Intelligence feed / signals / alerts          | existing (activate)              | `lib/intelligence/*`, `app/(app)/signals`           |
| Watchlist                                     | **activate**                     | `watchlists` schema                                 |
| Earn composer / Work Plan                     | existing + **new pane**          | `components/Copilot.tsx`, engine plans              |
| Operating brief                               | existing                         | `lib/operating-brief.ts`                            |
| Document / data room                          | existing                         | `lib/data-room.ts`                                  |

Each pane declares: default size, min size, entity binding, refresh policy, and its
own loading/empty/error/permission/disconnected/stale states (System 13).

## 5. Action & safety contract (System 9)

The terminal does not fork the gate model — it **projects** the spec's 10 side-effect
levels onto the existing 3 tiers so commands, agents, APIs, and plugins share one
contract:

|     SideEffectLevel      | Gate tier |                     Behavior                      |
|--------------------------|-----------|---------------------------------------------------|
| `read-only`              | —         | execute immediately when authorized               |
| `local-draft`            | Tier 1    | execute; mark draft                               |
| `internal-write`         | Tier 1    | execute; logged (`command_runs` + `audit_log`)    |
| `external-communication` | Tier 2    | preview + approval unless mandate pre-authorizes  |
| `external-data-write`    | Tier 2    | approval                                          |
| `capital-analysis`       | Tier 1    | execute; never writes the ledger                  |
| `capital-binding`        | Tier 3    | **always** non-delegable human approval           |
| `transaction-execution`  | Tier 3    | explicit confirm + entitlement check + full audit |
| `compliance-sensitive`   | Tier 2/3  | route to compliance executive; approval           |
| `destructive`            | Tier 2/3  | impact preview + confirm                          |

Verbs: `dry-run`, `preview`, `explain`, `approve`, `reject`, `revise`, `retry`,
`rollback` (where reversible), `escalate`, `export audit`. Plugins may **never**
weaken these — an extension-declared command inherits the same resolution.

## 6. Earn as orchestrator

Earn already produces reviewable multi-step plans with executive delegation, gates,
and write-back (`lib/engine.ts`). The terminal adds an **Earn Work Plan pane** that
renders that existing plan/step/approval data as: objective → assumptions → required
data → assigned executives → planned commands → expected outputs → approval gates →
estimated credit impact → status → deliverables. Earn gains terminal-control commands
(open/configure panes, save layout) that are themselves `read-only`/`local-draft`
side-effect level.

## 7. Provider & model routing

- **Data:** the terminal's data-provider router **is** `lib/intelligence/provider.ts`
  (provider-neutral, anti-corruption `ProviderObservation` boundary,
  `intelligence_provider_connections` with health/rate-limit/vaulted tokens). Phase-2
  work adds connectors + cross-provider merge/failover.
- **Models:** `lib/inference/*` gateway (capability→model routing, `inference_runs`
  telemetry). Terminal commands that call a model use `runInferenceLogged`.

## 8. Observability

Every command writes a `command_runs` row (verb, args hash, side-effect level, gate
tier, dry-run, status, latency, actor, org). Combined with `inference_runs`,
`audit_log` (DB-trigger backed), `dispatch_log`, and `skill_runs`, this gives the
admin dashboards the spec requires (command failures, provider latency, agent
failures, approval backlog) without new logging infrastructure. Never log secrets,
tokens, full documents, PII beyond need, or cross-tenant payloads (existing rule).

## 9. Non-goals / deferred

- Cross-org terminal (needs the deferred org-switcher; today active org = first
  membership, `lib/auth.ts`).
- Trade execution surfaces.
- Replacing the dashboards (they remain; the terminal is additive).

