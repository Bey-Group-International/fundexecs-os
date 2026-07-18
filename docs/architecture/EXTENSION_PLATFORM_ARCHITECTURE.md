# FundExecs Extensions — Platform Architecture (Phase 0)

**Scope.** The plugin framework (`/settings/extensions`, `/admin/extensions`,
`/marketplace/extensions`) that lets **approved** extensions register optional
panes, commands, providers, tools, reports, alerts, importers, and channels —
without ever weakening tenant isolation or the action/safety contract.

**Sequencing rule (from the spec):** do **not** build the marketplace before the
native command, capability, permission, and audit contracts are stable. The audit
confirms those contracts exist (gates, API scopes, vault, approvals, audit log) and
need only unification. The extension platform is therefore **Release 5**, after the
terminal shell + command registry + action contract land.

**First-release posture:** an **approved registry controlled by FundExecs admins**.
No unrestricted remote-code installation. No service-role exposure.

---

## 1. Build on existing seams (do not reinvent)

The platform is a thin governance + isolation layer over eleven existing registries:

| Extension capability | Registers into (existing seam) |
|---|---|
| Agent skill pack | Skills registry `lib/skills/registry.ts` (versioned, schema-typed, tier+risk) |
| Data provider | Intelligence provider registry `lib/intelligence/provider.ts` (anti-corruption boundary) |
| Model provider | Inference registry `lib/inference/registry.ts` (capability router) |
| Connector / channel | Integrations adapters `lib/integrations/registry.ts` + dispatch_log |
| MCP tool server | MCP registry `lib/mcp/registry.ts` (+ runtime, net-new) |
| Command | Terminal `CommandRegistry` (net-new, from the terminal work) |
| Pane / tab / column / report / alert | Terminal pane framework + `alert_rules` + report templates |
| Credentials | Vault `lib/vault.ts` + `org_secrets` (extended to per-installation scope) |
| Permissions | API scopes `lib/api-keys.ts` `API_SCOPES` (extended namespace) |
| Approval / lifecycle | Gate tiers `lib/gates.ts` + approval queue + `audit_log` |

## 2. Net-new tables

Organization-scoped + a platform-catalog scope for the registry itself. RLS:
member-read for installations in your org; admin-write; the catalog is
platform-admin-write / authenticated-read (mirrors `ai_agents` global-catalog RLS).

| Table | Purpose |
|---|---|
| `extensions` | Catalog: id, name, publisher, verified, categories, latest_version, status (`submitted/in_review/approved/published/suspended`) |
| `extension_versions` | Immutable version ledger: manifest jsonb, `minimum_platform_version`, signature, changelog |
| `extension_installations` | Per-org install: `extension_id`, `version`, `enabled`, granted scopes, config, health |
| `extension_permissions` | Granted scope grants per installation (subset of requested) |
| `extension_credentials` | Per-installation vault references (not raw secrets) |
| `extension_events` | Append-only activity: invocations, data accessed, errors |
| `extension_health_checks` | Last health, latency, error rate |
| `extension_audit_logs` | Admin lifecycle actions (submit/review/approve/suspend/revoke) |

## 3. Manifest

Typed manifest (generalizes `SkillManifest` + `IntegrationDescriptor`):

```ts
interface FundExecsExtensionManifest {
  id: string; name: string; version: string; description: string;
  publisher: { name: string; verified: boolean; website?: string };
  minimumPlatformVersion: string;
  categories: string[];
  capabilities: ExtensionCapability[];   // pane|command|entityTab|column|dataProvider|
                                         // searchProvider|workflowTemplate|agentTool|
                                         // reportTemplate|alertTrigger|notificationChannel|
                                         // importer|exporter|syncJob|webhookHandler|settingsSchema
  permissions: ExtensionPermission[];    // entities:read, deals:write, financials:read,
                                         // communications:send, capital-events:draft, ...
  settingsSchema?: JsonSchema;
  dataResidency?: string[];
  sideEffectLevels: SideEffectLevel[];   // declared max; enforced by the action contract
  approvalRequirements: ApprovalRequirement[];
  healthCheck?: ExtensionHealthCheck;
}
```

Each declared capability maps to registering into exactly one existing registry
(§1). Manifest validation is a pure, unit-tested function (mirrors
`lib/skills/validate.ts`).

## 4. Permission model

- Scopes extend the existing `API_SCOPES` vocabulary into a namespaced set:
  `entities:read/write`, `deals:read/write`, `funds:read/write`, `investors:read`,
  `documents:read/write`, `relationships:read/write`, `financials:read/write`,
  `workflows:execute`, `agents:invoke`, `communications:draft/send`,
  `capital-events:draft/execute`, `admin:configure`.
- An installation receives **only the minimum admin-approved subset** of requested
  scopes (least privilege). Requested vs granted is stored in `extension_permissions`.
- Every extension action re-checks scopes at call time via the same middleware
  pattern as `withApiKey` (`lib/api-v1.ts`), and re-classifies through the action
  contract — an extension can never exceed its granted side-effect ceiling, and
  `capital-binding`/`transaction-execution` remain Tier-3 human-gated regardless of
  manifest claims.

## 5. Isolation (the largest net-new security build)

Third-party code never runs unrestricted in the primary runtime. Tiers, most→least
isolated:

1. **Declarative** — pane/column/report/settings as JSON schemas + data bindings; no
   code execution (preferred default).
2. **Webhook / JSON-RPC connector** — extension logic runs on the publisher's side;
   FundExecs calls it over a strict typed boundary with per-tenant credentials,
   network allowlists, and timeouts. (Reuses the inbound/outbound webhook + merge
   gateway patterns.)
3. **Sandboxed worker / isolated serverless** — for extension code that must run
   in-platform: resource + time limits, no filesystem, no service-role, egress
   allowlist. The **MCP server registry runtime** (`lib/mcp/registry.ts`, currently
   config-only) is the natural first target — it already stores per-org vaulted
   tokens; add a sandboxed execution path.
4. **iframe** — for approved external UI surfaces only, sandboxed, postMessage-typed.

Never exposed to any extension: Supabase service-role creds, unscoped DB access,
raw tenant secrets, cross-tenant records, internal model-provider keys, unfiltered
document contents, filesystem, or shell.

## 6. Lifecycle

`discover → request install → admin review (manifest + permissions + security) →
install → configure → test connection → enable → disable → update → rollback →
uninstall → revoke credentials → view activity/data-accessed/health/errors`.

- Review + approve is a state machine on `extensions.status`, gated to platform
  admins (`lib/platform-admin.ts`), every transition written to
  `extension_audit_logs`.
- Install/enable/disable are org-admin actions (`is_org_admin`), each writing
  `extension_installations` + an audit event.
- **Disabling an extension must never break native functionality** — panes/commands
  it contributed disappear; native surfaces are untouched (acceptance criterion 12).
- Credential revoke deletes the vault reference; the extension loses access
  immediately.

## 7. Reference extensions (Release 5+, after the SDK)

Built as first-party proofs of the SDK, each reusing an existing connector where one
exists: SEC/EDGAR intelligence (Composio EDGAR), macro intelligence (Marketstack),
email/calendar activity (professional-network + Gmail/Calendly), accounting/KPI
importer (CSV → `portfolio_metrics`), external data-room connector, Slack/Teams
channels, and an **off-by-default, read-only** Gloomberb interop extension (public
reference data only; no tenant data sent by default; **no trade execution** in the
first release).

## 8. Observability & safety invariants

- Every extension invocation writes `extension_events`; health to
  `extension_health_checks`; lifecycle to `extension_audit_logs`.
- Provider failures degrade gracefully (the intelligence router already returns
  empty + flags rather than throwing).
- The platform can never be used to bypass gates, RLS, or the vault — enforced
  because extensions register **into** the governed registries, not around them.
