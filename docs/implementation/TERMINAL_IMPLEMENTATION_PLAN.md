# Terminal & Extension Platform — Implementation Plan (Phase 0)

This plan sequences the build so that each release is independently shippable,
flag-gated, and preserves existing behavior — the same increment discipline the
repo already uses (every risky change default-off with a fallback). It maps the
spec's Release 1–6 to concrete, evidence-grounded work items and their reuse/build
disposition.

**Global rules**
- Ship in small, reviewable PRs; each with tsc/eslint/Jest green + a migration
  (additive, idempotent) + a doc + `AGENT.md` changelog.
- Every new capability is **flag-gated and default-off** until its contract is
  stable (`TERMINAL_ENABLED`, `EXTENSIONS_ENABLED`, per-feature flags).
- **Never rebuild a working capability for visuals.** Panes wrap existing surfaces.
- Do not start the extension marketplace before the command + permission + audit
  contracts are stable (Release 5 after Release 1).

---

## Release 1 — Foundation (terminal shell + command registry + action contract)

| Work item | Disposition | Key files (reuse) / new |
|---|---|---|
| `terminal_workspaces`/`terminal_layouts`/`terminal_panes`/`saved_commands`/`command_runs` migrations + RLS | BUILD | mirror `20260718140000_skill_runs.sql` RLS pattern |
| `TerminalShell` pane manager (resize/dock/tabs/float/save) | BUILD | green-field; per-pane error boundary + Suspense |
| Layout persistence + deep-link serializer | BUILD | new; App Router routes |
| `CommandRegistry` + `CommandDefinition` contract | BUILD | mirror `lib/skills/types.ts` |
| Command bar (extend palette; parse→resolve→plan→confirm→dispatch) | REUSE + BUILD | `components/CommandPalette.tsx`, `lib/nav-commands.ts` |
| Unified **action & safety contract** (10 side-effect levels → 3 gate tiers) | ACTIVATE | wrap `lib/gates.ts`; add dry-run/preview/explain verbs |
| Permission enforcement per command | REUSE | `lib/api-keys.ts` scopes + `withApiKey` pattern |
| First panes: Deal/Investor/Portfolio-company war-room adapters + Copilot pane | REUSE | `lib/{run,source,execute}-war-room.ts`, `components/Copilot.tsx` |

Exit: a user opens `/terminal`, assembles/saves a multi-pane workspace, and runs a
`read-only` command (`DEAL <name>`, `LBO <deal>`) that loads a pane; every command
writes `command_runs`.

## Release 2 — Intelligence (activate the dark layer)

| Work item | Disposition | Files |
|---|---|---|
| Watchlist store CRUD + UI + wire into `FetchSpec.entities` | ACTIVATE | `watchlists` schema, `lib/intelligence/ingest.ts` |
| Alert **evaluator** (replace the stub) + wire to cron | BUILD | `lib/alert-rules.ts:129`, `app/api/cron` |
| Alert delivery (in-app/email/digest) + `app/(app)/alerts` UI + snooze/assign/convert | BUILD | new; reuse `lib/radar-send.ts` digest path |
| Turn on intelligence core flags in staged rollout; register the proactive trigger | ACTIVATE | `lib/intelligence/flags.ts`, `signal-bridge.ts` |
| Data-provider router: add connectors + cross-provider merge/failover | ACTIVATE | `lib/intelligence/provider.ts` |
| Provenance/freshness indicators in intelligence + entity panes | ACTIVATE | `ProviderObservation` evidence/attribution vocab |
| Global search broadened to people/funds/documents + semantic wiring | ACTIVATE | `lib/search.ts`, `brain_kb_hybrid_search` |

## Release 3 — Financial analysis (fill the real gaps)

| Work item | Disposition | Files |
|---|---|---|
| **True XIRR** engine (dated cashflows) + back-fill fund/asset IRR | BUILD | new `lib/xirr.ts`; feed `lp-report.ts`, `FundKPIPanel`, `portfolio/page.tsx` |
| Exposure aggregator (industry/geo/vintage/sponsor/lender/…) | BUILD | new; over `assets`+`commitments`+`deals` |
| Standing covenant register + breach dashboard | BUILD | new table; reuse `portfolio-review` skill math |
| Actual-vs-underwriting wired to real cases (remove `null`) | ACTIVATE | `portfolio/page.tsx:59-60`, `underwritings` |
| Portfolio & exposure cockpit pane + scenario runs | BUILD/REUSE | `lib/portfolio-monitor.ts` + new |
| Surface `SkillSource` provenance (verified vs assumption vs AI) in cockpit UI | ACTIVATE | thread `lib/skills/types.ts` sources into panes |
| Report export from panes | REUSE | `lib/artifacts/export*.ts` |

## Release 4 — Earn orchestration

| Work item | Disposition | Files |
|---|---|---|
| Earn Work Plan pane (objective→commands→executives→gates→status→deliverables) | BUILD | over `lib/engine.ts` plans/steps/approvals |
| Earn terminal-control commands (open/configure panes, save layout) | BUILD | `read-only`/`local-draft` side-effect |
| Extend `persistOutcome` write-back to diligence/KPI/LP records | ACTIVATE | `lib/engine.ts:258-393` |
| Approval packages + automated operating briefs into panes | REUSE | `lib/operating-brief.ts`, approvals |

## Release 5 — Extensions

| Work item | Disposition | Files |
|---|---|---|
| `extensions`/`extension_versions`/`extension_installations`/`extension_permissions`/`extension_credentials`/`extension_events`/`extension_health_checks`/`extension_audit_logs` migrations | BUILD | mirror RLS + global-catalog pattern |
| Manifest schema + pure validator | BUILD | mirror `lib/skills/validate.ts` |
| Extension → existing-registry binding (skill/provider/command/pane…) | BUILD/REUSE | the eleven seams |
| Permission scopes (namespaced) + least-privilege grants | ACTIVATE | `lib/api-keys.ts` |
| Isolation: declarative + webhook/JSON-RPC + sandboxed worker (MCP runtime first) + iframe | BUILD | `lib/mcp/registry.ts` runtime |
| Lifecycle state machine + admin review surface (`/admin/extensions`) | BUILD | `lib/platform-admin.ts`, gates, audit |
| Reference extensions (SEC, macro, email/cal, KPI importer, data-room, Slack/Teams, Gloomberb read-only) | EXTENSION | after SDK stable |

## Release 6 — Hardening

Performance (pane virtualization/lazy), accessibility, security review, RLS tests,
provider failure handling, extension rollback, usage analytics dashboards
(`command_runs` + `inference_runs` + `extension_events`), documentation, rollback
procedures.

---

## Database migration plan (additive, idempotent, RLS-scoped)

New tables (each: `organization_id` FK, member-read/writer-write RLS via
`current_principal_org_ids`/`is_org_writer`, `updated_at` trigger, soft-delete where
restorable): `terminal_workspaces`, `terminal_layouts`, `terminal_panes`,
`saved_commands`, `command_runs`, `covenants`, `exposure_snapshots` (optional cache),
`extensions` (+global catalog RLS), `extension_versions`, `extension_installations`,
`extension_permissions`, `extension_credentials`, `extension_events`,
`extension_health_checks`, `extension_audit_logs`. Reuse existing: `watchlists`,
`alert_rules`, `intelligence_provider_connections`, `skill_runs`, `inference_runs`,
`audit_log`, `org_secrets`. Every migration follows the repo convention
(`YYYYMMDDHHMMSS_slug.sql`, unique prefix, `if not exists`, `drop policy if exists`).

## Permission & approval matrix (summary)

| Actor | Read-only | Internal write | External comms | Capital-binding | Admin config |
|---|---|---|---|---|---|
| viewer | ✓ | ✗ | ✗ | ✗ | ✗ |
| member | ✓ | ✓ | Tier-2 approval | Tier-3 human | ✗ |
| admin/owner | ✓ | ✓ | Tier-2 (mandate can pre-authorize) | Tier-3 human (never delegable) | ✓ |
| API key | scoped | scoped + approval queue | — | ✗ | ✗ |
| Extension | granted scopes only | granted + approval | Tier-2 | **Tier-3 human, never via extension** | ✗ |

Capital-binding and transaction-execution are always Tier-3, non-delegable, human —
for users, agents, API keys, and extensions alike.

## Command registry (initial verbs → dispatch target)

Navigation/entity → war-room/workspace loaders + entity resolver. Analysis
(`LBO/VAL/COMPS/RETURNS/WATERFALL/CAPTABLE/IC/EXPOSURE/RISK/BENCHMARK/RELGRAPH`) →
`lib/lbo-model.ts`, `lib/skills/catalog/*`, `lib/waterfall*.ts`, `lib/cap-table.ts`,
`lib/graph.ts`, new exposure/XIRR engines. Workflow
(`SOURCE/OUTREACH/CREATE*/INGEST/ASSIGN/APPROVE/CAPCALL/DISTRIBUTE/REPORT/EXPORT/ASK
EARN`) → engine `planPrompts` + gates + skills. Full per-command schema/permission/
side-effect table is authored alongside Release 1.

## Provider interface specification (reuse)

Data providers implement the existing `IntelligenceProvider` interface
(`available`/`fetchObservations`/`ask`/`calibration`) and are forced through the
`ProviderObservation` anti-corruption boundary before any business logic; connection
health/rate-limit/vaulted-token live in `intelligence_provider_connections`. Model
providers implement the inference gateway adapter contract (`lib/inference/*`).
Net-new for a full System-12 router: cross-provider merge/dedup-of-record and
fan-out/failover policy.

## Known limitations & assumptions requiring approval

- **Data licensing/compliance:** SEC/EDGAR, macro, news, and any third-party feed
  require executive + legal + data-licensing sign-off before enablement.
- **Cross-org terminal:** blocked on the deferred org-switcher (active org = first
  membership today).
- **Sandboxed untrusted-code execution:** the largest security build; a formal
  security review is required before any non-declarative extension ships.
- **Intelligence core activation:** flags are default-off; staged rollout with human
  review of assessments before any alert delivery goes live.
- **Gloomberb interop:** read-only, off by default, no tenant data egress, no trade
  execution in the first release — pending explicit user authorization.

## Next-priority backlog (immediately after Phase 0)

1. Release 1 shell + command registry + action contract (the terminal spine).
2. Activate watchlists → alert evaluator → delivery (highest-value activation; the
   architecture is already present but dark).
3. XIRR + exposure aggregator (the concrete financial gaps) + provenance-in-cockpit.
4. Extension manifest + validator + the three `extension_*` core tables (unblocks
   the platform, no runtime yet).
