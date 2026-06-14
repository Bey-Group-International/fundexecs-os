# FundExecs Brain — institutional knowledge for the internal LLM

> Persistent knowledge base for Earn + the Executive Team (the internal LLM). It captures how the
> OS is built and the principles that govern new work, so the desk's intelligence stays grounded in
> the real system rather than re-deriving it each session. Designed to be embeddable into the RAG
> layer (`knowledge_documents` → `knowledge_chunks` via `match_knowledge_chunks`) and readable
> directly. Keep additive; update when a principle or core surface changes.

## Operating principles (govern all new work)

1. **Adoption over integration.** Absorb capabilities into the OS as native functions; do not depend
   on third-party APIs or keys. Any external model/embedding step is an _optional, never-block
   enhancement_ that degrades to a deterministic, key-free default.
2. **Propose-only / human-in-the-loop.** Consequential actions (send, sign, move money, accept an
   LP) are never autonomous — they are proposed, the operator approves, and the system acts.
3. **On the record.** Every meaningful action writes a `trust_events` audit row (Chain of Trust);
   outcomes also land on the Earn Ledger (`earn_outcomes`).
4. **Never-block AI.** Missing key / timeout / error must degrade gracefully, never block a path.
5. **Additive + idempotent migrations**, RLS on every table, tokens-only UI, the 15 brain slugs +
   `lib/team/*` frozen, "specialist / executive team" wording (never "copilot").
6. **Seamless · frictionless · borderless.** The experience is one continuous surface: no dead ends,
   no manual hand-offs, no context re-entry, no silos between lifecycle stages or specialists. Earn
   carries context across every surface; actions flow inline (propose → approve in place); the desk
   reaches across Source/Build/Execute/Run and every data source as one fabric. Minimize clicks,
   forms, and waiting — the operator states intent and the desk does the rest.

## Earn + the Team operate as the internal LLM

Earn and the 15-specialist desk are the OS's **internal LLM** — a reasoning, conversational agent
layer, not a set of static screens. They behave like a model that is permanently grounded:

- **Grounded by this Brain + live OS data.** Every response reasons over this knowledge base (via
  the RAG layer) plus the operator's real records — mandate, deals, relationships, ledger, trust
  events — so answers are institution-specific, not generic.
- **Conversational + agentic.** They converse, plan multi-step work, route each task to the owning
  specialist, propose actions into the Action Queue, and act on approval — the LLM loop expressed
  through the propose → approve → audit spine.
- **Memory.** The Earn Conversation Ledger gives the team durable memory of what was discussed and
  decided; recall feeds back into future reasoning (institutional context compounds).
- **Self-hosted intelligence.** The reasoning runs as a native OS function. External models are an
  optional accelerant, never a dependency: with no key configured, the team still reasons over
  deterministic logic + retrieval and degrades gracefully (adoption over integration).
- **On-brand voice.** Measured, candid, on the record — Earn is COO; specialists own their domains.

The product goal: the operator talks to Earn and the team the way they would to an LLM, and gets an
executive desk that remembers, reasons, proposes, and executes — all inside the platform.

## Core architecture (the spine)

- **Lifecycle:** Source → Build → Execute → Run (`app/(shell)/{source,build,execute,run}`).
- **Executive Team:** Earn (`earnest-fundmaker`, COO) + 14 specialists; roster in `lib/team/roster.ts`
  (slugs are `ai_brains.slug`, frozen). Earn chat: `lib/ai/earn.ts`.
- **Agentic Execution Layer (Phase 1):**
  - **Action Queue / spine:** `public.task_runs` (status proposed|approved|rejected, one-open-per-task
    index, 15-slug constraint) + `public.tasks`; `lib/actions/tasks.ts` (`assignTask`/`runTask`/
    `decideTaskRun` → `propose_task_run`/`decide_task_run` RPCs, both audited). Surface:
    `app/(shell)/action-queue` + `lib/queries/action-queue.ts`.
  - **Executors:** `lib/agents/executors.ts` — registry keyed by specialist slug; `decideTaskRun`
    dispatches on approval, never-block, no send/sign/money executors. Sourcing executor uses
    `lib/ai/target-discovery.ts`.
  - **Sourcing brief (P1-B):** `sourcing_briefs` table; the intelligence cron
    (`lib/ai/intelligence-pipeline.ts`) raises one gated "Scout targets" proposal per active brief.
  - **Diligence → Memo (P1-C):** 7-agent `lib/diligence/orchestrator.ts` (`runDiligence`,
    `diligence_runs`/`diligence_findings`); `lib/diligence/memo.ts` `composeMemo` deterministically
    builds an IC memo (no LLM) → `lib/actions/materials.ts` `generateMemoFromDiligence` (kind
    `ic_memo`, audience `internal_ic`).
  - **Chief-of-Staff brief (P1-D):** `lib/queries/chief-of-staff-brief.ts` + `DailyBrief` on the
    Command Center (read-only: pending approvals + new matches + overdue + Earn briefing).
- **Earn Ledger:** `earn_outcomes` (kinds in `lib/earn/outcomes.ts`), read by `getEarnLedger`,
  rendered at `app/(shell)/earn`. Single recorder chokepoint: `lib/earn/record-outcome.ts`
  (`recordApprovedOutcome` → fans to `trust_events` + `earn_outcomes`).
- **Credits meter:** `lib/credits/meter.ts` (`meterAction`) + `costs.ts` (`MeteredAction`,
  `ACTION_COST`, `PAID_INTEGRATIONS` plan gating). Fail-open on infra, fail-closed on balance.
- **RAG / Mandate Memory:** `knowledge_documents` / `knowledge_chunks` + Voyage embeddings +
  `match_knowledge_chunks()`. Keep one embedding model per corpus.
- **Match intelligence:** `generate_signal_matches` + `org_profile_embeddings` +
  `match_scoring_weights`; `matches` (status `new|accepted|dismissed|snoozed` — there is NO
  `pending`). Signal matches written/read with `status='new'`.
- **Integrations:** provider-agnostic `lib/integrations/` + `integration_connections`; the
  `Provider` pattern (`types.ts`, `providers/apollo.ts`).

## Key-free intelligence systems (proprietary, no APIs/keys — the house pattern)

Each is a pure scorer in `lib/intelligence/*` (+ unit tests) over data the OS already holds, a
fail-soft RLS query, and a panel. Replicate this shape for new systems.

- **Deal Conviction Index** (`lib/intelligence/conviction.ts`): explainable 0–100 per deal from
  diligence conviction · capital coverage · stage · momentum; factor breakdown + top lever. Query
  `lib/queries/conviction.ts`; `ConvictionPanel` on Source → Pipeline.
- **Relationship Reconnect Engine** (`lib/intelligence/reconnect.ts`): depth (`interaction_count`,
  non-decaying) × staleness — surfaces durable relationships going cold (not decayed `strength`).
  Query `lib/queries/reconnect.ts`; `ReconnectPanel` on Run → IR.
- **Pipeline Velocity & Stuck-Deal Detector** (`lib/intelligence/velocity.ts`): time-in-stage from
  each deal's `loop_events` (`deal_stage` transitions); bands Moving/Slowing/Stuck. Query
  `lib/queries/velocity.ts`; `VelocityPanel` on Source → Pipeline.
- **Next-Best-Action engine** (`lib/intelligence/next-best-action.ts`): fuses approvals · velocity ·
  reconnect · conviction into one ranked worklist (per-kind priority helpers + deterministic
  rank/tiebreak/cap). Query `lib/queries/next-best-action.ts`; `NextBestActions` on Command Center.
- **Capital Coverage & Concentration** (`lib/intelligence/capital-coverage.ts`): portfolio-risk read
  — coverage % (committed/pipeline value), per-stage exposure split, single-name + top-3 share, and
  a Herfindahl (HHI) index → band Diversified/Balanced/Concentrated/Highly concentrated. Query
  `lib/queries/capital-coverage.ts`; `CapitalCoveragePanel` on Source → Pipeline.

## Phase-2 external data (specs only; build behind adapters, metered, key-optional)

- Blueprint: `docs/TOOL_INTEGRATION_BLUEPRINT.md`. Spec: `docs/PHASE2_INTEGRATION_SPEC.md`.
- Four swappable interfaces in `lib/integrations/`: `EnrichmentProvider`, `WebResearchProvider`,
  `SignalProvider`, plus deepened Apollo. **P2-A shipped:** enrichment seam (`lib/integrations/
enrichment/*`) with Orthogonal adapter (env/key-gated) + deterministic **mock** default +
  `provider_cache` table. Every external call is metered + cached + audited + never-block.

## Planned native functions

- **Earn Conversation Ledger** (`docs/EARN_CONVERSATION_LEDGER.md`): log Earn/specialist
  conversations onto `earn_outcomes` (new `conversation` kind + `recordConversation` sibling),
  deterministic digest + key-free full-text recall; AI/embeddings optional. Adoption over
  integration — retires `tasklets-ai.ts` from the conversation path.

## Verification gate (run before every PR)

`yarn format:check && yarn typecheck && yarn lint && yarn build && yarn test:unit`. Migrations are
validated on the Supabase preview branch. Styling convention: `border-[var(--token)]` /
`bg-[var(--token)]` (valid in Tailwind v4; used in 340+ components — do not switch to the `(--x)`
shorthand piecemeal).
