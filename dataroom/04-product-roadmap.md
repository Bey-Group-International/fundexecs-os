# FundExecs OS — Product Roadmap

*Confidential · July 2026*

> Status legend: ✅ shipped (in the codebase today) · 🔧 in flight · ⏳ planned. Dates for future phases are targets, not commitments; sequencing follows the platform's build-order discipline (data model → API → agent logic → events → frontend).

---

## 1. Where the product is today (Alpha, July 2026)

### Shipped ✅

**Platform core**
- Next.js + TypeScript single-app scaffold; Postgres/Supabase schema as **66+ versioned migrations**; row-level security on every table; org-membership multi-tenancy
- The sacred loop end-to-end: `/api/prompt → plan → /api/approve → execute → /api/report`, Realtime event stream over `task_events`
- Live Claude-powered multi-step planning and per-step execution (structured outputs; deterministic fallback when no API key) — cost-tiered model routing (Haiku default, overridable)

**Agent layer**
- Fifteen-agent catalog across the four hubs, orchestrated by Earn
- Per-agent knowledge bases ("Brains") powering domain behavior
- Operator-feedback learning ledger (accept/reject signals with fit scores; learned digest injected into future runs)
- **Automations** — saved natural-language instructions + triggers (cron schedule + run-now live), opt-in auto-approve for trusted automations
- Team task loop — human work assigned, run through Earn, completion feeding learning signals

**Work product & records**
- First-class typed **artifacts** (IC memos, models, risk reports, LP updates) with provenance and grounding
- Workflow → record persistence: Source workflows seed Deals, Execute workflows seed Assets (Claude-extracted fields, idempotent)

**Operator surfaces**
- Command Center dashboard; AI Copilot session surface with live 2D agent workspace
- **Capital Map** — relationship temperature, thesis fit, warm-intro pathfinding, gated next actions
- **Gate layer** — Tier 1/2/3 control primitive: no action reaches a counterparty without sign-off
- **Unified Inbox** — AI-triaged stream across booking/messaging/video channel adapters
- Data room, investor portal, valuations, deal shares, outreach sequences, sourcing intelligence, radar digests
- Demo seed/reset + guided tour (investor-demo ready)

**Commercial plumbing**
- Billing live: Starter / Pro / Scale plans + credit packs, wallet + append-only credit ledger, referrals and gifts
- API keys and data-API grants; integration-connection scaffolding

## 2. Now → Next 2 quarters (H2 2026) 🔧

**Theme: from working loop to complete lifecycle.**

|             Item             |                                                                             Detail                                                                             |
|------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Three-graph query layer      | `/graph/relationship`, `/graph/deal`, `/graph/capital` endpoints + visualizations over the existing schema                                                     |
| Remaining hub modules        | Source (LP Pipeline, Deal Pipeline), Run (Underwriting, Diligence, Stress Test), Execute (Capital Events, Asset Management, Reporting), Build (Thesis, Entity) |
| Real-world trigger expansion | Email, webhook, and internal-event triggers for Automations (enum already reserved); retry/adapt-on-failure autonomy                                           |
| Brain recall v2              | Vectorize each org's completed high-quality artifacts into org-scoped recall — the firm's own work becomes agent memory                                        |
| Deployment hardening         | Fixed production Supabase environment, observability (already specified: OpenTelemetry/Sentry), SLO baselines                                                  |
| Design-partner conversion    | 3–5 external design partners live on the platform with weekly feedback loops                                                                                   |

**Exit criteria:** an emerging manager can run a raise and a deal pipeline entirely inside FundExecs OS, with at least one recurring automation trusted to run unattended.

## 3. Next → 2 quarters after (H1 2027) ⏳

**Theme: the executive team becomes visible and proactive.**

- **Proactive agent proposals** — graph-signal-driven suggested work (LP temperature drops, stale pipeline, reporting deadlines) queued for approval
- **Three.js/GSAP animated workspace** — the 2D theater graduates to the spatial agent workspace (event model and palette already in place)
- **Multimodal + multi-provider execution** — attachment storage, voice, and provider adapters behind the existing model-selector UI
- **Fund admin depth** — waterfall engine, capital-call and distribution flows on the existing `capital_events` schema, audit-prep outputs
- **Marketplace v1** — listings + matching on the existing marketplace schema; ecosystem matchmaking
- **Security/compliance program** — SOC 2 Type I underway; data-retention and export controls productized

**Exit criteria:** public beta; 25+ paying orgs; agents proposing (not just executing) work.

## 4. Later (H2 2027 → 2028) ⏳

**Theme: the network era.**

- **Access/reputation/attestation layer** (specified in `docs/TOKENIZATION_LAYERS.md`): entitlements from plan × reputation × stake; verified-close attestations; reputation rebates on credit pricing — off-chain ledger first, per-unit on-chain anchoring optional later
- **Cross-firm trust fabric** — deal shares, verified track records, and portable standing between FundExecs orgs
- **Marketplace take-rate + data/API revenue** at scale
- **Enterprise tier** — SSO/SAML (schema ready), governance packs, dedicated environments
- **General availability** with published SLAs

## 5. Dependencies and sequencing risks

- **Model costs and latency** — mitigated by cost-tiered routing (cheap default model, per-task overrides) and metered credits that pass usage through to pricing.
- **Build-order discipline** — UI never precedes a stable data model; this has held through 66 migrations and is why the roadmap compounds instead of resetting.
- **Compliance gating on the tokenization layer** — governance/security token layers ship only with counsel review (see document 13); the access/credits layer carries no such dependency and is already live.

