# FundExecs OS — Platform Feature Optimization Blueprint

**Version:** 1.0  
**Date:** 2026-07-01  
**Classification:** Architecture / Implementation-Ready  
**Scope:** Unified feature cloning from Zernio · BotMemo · GoHighLevel · Figma

---

## Executive Summary

This blueprint extracts the strongest native patterns from four reference platforms and translates each into actionable specifications for FundExecs OS. The existing architecture — 15-agent catalog, pgvector brain system, approval-gated workflow engine, Supabase + Realtime, hub-based UI — provides a strong foundation. The gaps this blueprint closes are: **visual workflow orchestration** (GoHighLevel), **persistent cross-session agent memory** (BotMemo), **multi-agent routing transparency** (Zernio), and **component-level design clarity** (Figma).

Every feature below maps to existing files in `lib/`, `components/`, or `supabase/migrations/` to keep the integration surface small and surgical.

---

## Source Platform Analysis

| Platform | Core Strength | FundExecs Gap Addressed |
|----------|--------------|------------------------|
| **Zernio** | Multi-agent task decomposition, real-time routing trace, agent-to-agent handoff | Agent orchestration visibility; routing logic exposed to operators |
| **BotMemo** | Persistent conversation memory, cross-session context carry-forward, knowledge synthesis | Brain KB continuity; session context lost on reload |
| **GoHighLevel** | Visual trigger/action workflow builder, smart pipeline stages, multi-channel automation | Automation editor is code-only; no visual canvas for operators |
| **Figma** | Design token system, component variants, auto-layout, live collaborative annotation | UI consistency gaps; no design token enforcement in Tailwind |

---

## Feature Optimization Blueprint

### FEATURE 01 — Zernio Agent Routing Console

| Attribute | Detail |
|-----------|--------|
| **Feature Name** | Agent Routing Console |
| **Source Platform** | Zernio |
| **Functional Description** | Real-time dashboard showing which agent is active on each task step, routing decision rationale, handoff graph between agents, and operator override capability. Zernio's "routing trace" surface makes multi-agent systems legible and auditable. |
| **UX Interaction Pattern** | Persistent right-panel drawer in Command Center. Each task renders a swimlane view: steps as nodes, agent assignments as colored lanes, active step highlighted with a pulse animation. Clicking any node shows the routing rationale (prompt fragment, confidence score, fallback chain). One-click "reassign" button opens an agent picker. |
| **Technical Implementation Notes** | `lib/routing-trace.ts` already records routing decisions. Extend it with a `routing_events` Supabase table (`task_id`, `step_id`, `agent_key`, `rationale_json`, `confidence`, `timestamp`). Stream to client via existing `task_events` Realtime channel. New React component `components/dashboard/AgentRoutingConsole.tsx` reads from `routing_events`. Override writes to `task_steps.agent_override` column (add in migration). |
| **Suggested Enhancements** | (1) Show agent workload heatmap across all active org tasks. (2) Auto-flag routing decisions below 0.7 confidence for operator review. (3) Record accepted overrides as training signal in `lib/routing-feedback.ts`. |
| **Integration Pathways** | → `lib/intelligence.ts` (executive assignment) · `lib/routing-trace.ts` · `lib/routing-feedback.ts` · `/api/agents` endpoint · `components/dashboard/CommandCenter.tsx` |

---

### FEATURE 02 — Zernio Agent-to-Agent Handoff Protocol

| Attribute | Detail |
|-----------|--------|
| **Feature Name** | Structured Agent Handoff |
| **Source Platform** | Zernio |
| **Functional Description** | When a step requires a different specialty, the active agent produces a structured handoff packet (context summary, open questions, recommended next agent, artifacts passed) instead of just completing silently. The receiving agent starts with full context rather than re-deriving from raw records. |
| **UX Interaction Pattern** | At the boundary between steps assigned to different agents, the Copilot feed renders a "Handoff Card" — collapsible summary showing outgoing agent, incoming agent, context digest, and a "verify handoff" operator action. |
| **Technical Implementation Notes** | Add `handoff_packet` JSONB column to `task_steps`. In `lib/engine.ts` `executeWorkflow()`, after completing a step, if `next_step.agent_key !== current_step.agent_key`, call a new `generateHandoffPacket(stepOutput, nextAgent)` function in `lib/claude.ts`. Packet schema: `{ summary: string, open_questions: string[], recommended_focus: string, artifact_ids: string[] }`. Persist to `task_steps.handoff_packet` and emit as `task_events` event type `"handoff"`. |
| **Suggested Enhancements** | (1) Expose handoff packets in LP/investor data rooms to show diligence rigor. (2) Aggregate handoff quality scores to build agent pair compatibility metrics. |
| **Integration Pathways** | → `lib/engine.ts` · `lib/claude.ts` · `components/copilot/EarnCopilotDock.tsx` · `lib/artifact-provenance.ts` |

---

### FEATURE 03 — Zernio Autonomous Task Decomposition

| Attribute | Detail |
|-----------|--------|
| **Feature Name** | Dynamic Task Decomposition |
| **Source Platform** | Zernio |
| **Functional Description** | For high-level operator prompts ("Close the Series A round"), the system automatically decomposes the macro-task into a dependency graph of sub-tasks, assigns agents per sub-task, and schedules them with dependency awareness. Zernio calls this "Cascade Planning." |
| **UX Interaction Pattern** | After plan generation, the Session view renders a DAG (directed acyclic graph) of tasks rather than a flat list. Parallel tasks show horizontal branching. Dependencies are visible as connecting arrows. Operators can drag-to-reorder independent steps. |
| **Technical Implementation Notes** | Extend `lib/claude.ts` `generatePlan()` to output a `dependencies: string[]` array per step (referencing sibling step IDs). Store in `task_steps.depends_on` (JSONB array, new column). `lib/engine.ts` step scheduler checks `depends_on` before enqueuing a step — blocked steps wait in a `pending_dependency` status. New `components/session/TaskDAGView.tsx` renders dependency graph using a lightweight layout library (e.g., `dagre-d3` or pure SVG computed positions). |
| **Suggested Enhancements** | (1) Expose estimated duration per step and critical-path highlighting. (2) Allow operators to inject a new step into the DAG mid-execution without restarting. |
| **Integration Pathways** | → `lib/engine.ts` · `lib/claude.ts` · `/api/prompt` · `components/session/` · `supabase/migrations/` |

---

### FEATURE 04 — BotMemo Persistent Agent Memory

| Attribute | Detail |
|-----------|--------|
| **Feature Name** | Cross-Session Agent Memory |
| **Source Platform** | BotMemo |
| **Functional Description** | Agents accumulate structured memories (facts, preferences, decisions, outcomes) across sessions and surface relevant prior context automatically when a related task is initiated. BotMemo stores memories as typed facts: decisions, constraints, open items, feedback, and preferences — not raw conversation history. |
| **UX Interaction Pattern** | When a new session opens, the Brain Feed panel shows a "Memory surfaced" section at the top — a collapsed list of up to 5 high-relevance prior facts with source session links. An operator can pin, dismiss, or correct any memory item inline. |
| **Technical Implementation Notes** | New `agent_memories` table: `(id, org_id, agent_key, memory_type ENUM('decision','constraint','preference','outcome','open_item'), content TEXT, embedding vector(1536), source_task_id, source_session_id, pinned BOOL, dismissed BOOL, created_at)`. On task completion in `lib/engine.ts`, call new `lib/brains/memory.ts` `extractAndStoreMemories(taskOutput, agentKey, taskId)` — Claude extracts structured memories from the completed output. On new session start, `retrieveRelevantMemories(prompt, agentKey, orgId)` uses pgvector cosine similarity to surface top-k memories. Inject as system context prefix in `lib/claude.ts` `executeStep()`. |
| **Suggested Enhancements** | (1) Memory decay: reduce embedding weight for memories older than 90 days unless pinned. (2) Conflicting memory detection: flag when a new memory contradicts a pinned prior one. (3) Memory provenance: every memory links back to the artifact or step that generated it. |
| **Integration Pathways** | → `lib/brains/pgvector.ts` · `lib/brains/embed.ts` · `lib/engine.ts` · `lib/claude.ts` · `components/session/BrainFeed.tsx` · `supabase/migrations/` |

---

### FEATURE 05 — BotMemo Knowledge Synthesis Engine

| Attribute | Detail |
|-----------|--------|
| **Feature Name** | Automatic Knowledge Synthesis |
| **Source Platform** | BotMemo |
| **Functional Description** | After a threshold of interactions on a topic (deal, investor, sector), BotMemo automatically synthesizes scattered facts into a coherent knowledge article that becomes a first-class brain entry. This keeps the knowledge base current without manual curation. |
| **UX Interaction Pattern** | When synthesis triggers, a toast notification appears: "New knowledge synthesized: [Topic Name]. Review or publish." The operator opens a split view showing raw source artifacts on the left and the synthesized article on the right, with an Approve/Edit/Discard action bar. |
| **Technical Implementation Notes** | In `lib/brains/catalog.ts`, add a `synthesis_queue` table: `(id, org_id, topic_key, source_artifact_ids JSONB, synthesis_status, draft_content, approved_at)`. A cron sweep (`/api/cron`) checks for topics with ≥5 new artifacts since last synthesis. `lib/brains/llm.ts` generates a synthesis draft from the artifact corpus. On approval, the article is stored in `brain_kb` with `source: 'synthesized'` tag and embedded via `lib/brains/embed.ts`. |
| **Suggested Enhancements** | (1) Topic clustering: use pgvector to auto-group related artifacts before synthesis triggers. (2) Synthesis changelog: track version diffs when a topic is re-synthesized. (3) Export synthesized articles to Google Drive or Notion via integration adapters. |
| **Integration Pathways** | → `lib/brains/` · `lib/engine.ts` · `lib/cron.ts` · `components/session/BrainFeed.tsx` · `lib/artifact-provenance.ts` |

---

### FEATURE 06 — BotMemo Contextual Session Memory Cards

| Attribute | Detail |
|-----------|--------|
| **Feature Name** | Session Memory Cards |
| **Source Platform** | BotMemo |
| **Functional Description** | Within an active session, the system maintains a live "Memory Card" — a structured digest of everything discussed so far (entities mentioned, decisions made, open questions) — updating it in real time as the session progresses. Operators can reference it without scrolling back. |
| **UX Interaction Pattern** | Fixed card in the session sidebar, auto-collapsed to "3 key facts" with expand toggle. Each fact is tagged by type (Decision · Question · Entity · Constraint) with a colored chip. Clicking a fact scrolls to the originating message. |
| **Technical Implementation Notes** | Extend `sessions` table with `memory_card JSONB` column. After each session message, call `lib/claude.ts` `updateSessionMemoryCard(sessionId, newMessage)` — a lightweight Claude call that diffs the existing card against the new message and returns updated card JSON. Client subscribes to session row changes via Supabase Realtime and re-renders the card. Component: `components/session/MemoryCard.tsx`. |
| **Suggested Enhancements** | (1) Export memory card as a deal brief PDF. (2) Auto-inject memory card into the next session on the same deal. (3) Conflict detection: highlight when a new statement contradicts an earlier decision in the card. |
| **Integration Pathways** | → `lib/session-messages.ts` · `supabase/migrations/` · `components/session/active-session.tsx` · `lib/claude.ts` |

---

### FEATURE 07 — GoHighLevel Visual Workflow Builder

| Attribute | Detail |
|-----------|--------|
| **Feature Name** | Visual Automation Canvas |
| **Source Platform** | GoHighLevel |
| **Functional Description** | A drag-and-drop canvas where operators build automation workflows by connecting trigger nodes, condition nodes, and action nodes. GoHighLevel's builder supports branching logic (if/else), wait steps, multi-channel actions, and loop controls — all without writing code. |
| **UX Interaction Pattern** | Accessible from `/automations`. Canvas occupies the main body. Left panel has a node palette organized by category: Triggers (Schedule, Event, Record Change, Webhook), Conditions (Field Match, Score Threshold, Status Gate), Actions (Run Agent Task, Send Slack, Send Email, Create Docusign Envelope, Update Record, Wait). Nodes are dragged onto the canvas and connected via arrow handles. A "Test Run" button fires the automation in dry-run mode with a step-by-step trace overlay. |
| **Technical Implementation Notes** | Workflow definitions already exist in `lib/workflows.ts` as TypeScript objects. Extend `automations` table with `canvas_json JSONB` (stores node positions, connections, visual layout). New `components/automations/WorkflowCanvas.tsx` renders the visual graph using `reactflow` (already installable; lightweight). Each node type maps to an existing automation primitive: triggers → cron/event hooks in `lib/cron.ts`; actions → `lib/integrations/gateway.ts` dispatch; condition nodes → new `lib/automation-conditions.ts` evaluator. The canvas serializes to the same execution format `lib/engine.ts` already understands. |
| **Suggested Enhancements** | (1) AI-assisted workflow generation: describe a workflow in natural language, Claude generates the node graph. (2) Workflow templates library: pre-built templates for common fund ops sequences (LP update cadence, closing checklist, KYC reminders). (3) Version history with one-click rollback. |
| **Integration Pathways** | → `lib/workflows.ts` · `lib/cron.ts` · `lib/integrations/gateway.ts` · `lib/engine.ts` · `components/automations/` · `app/(app)/automations/` |

---

### FEATURE 08 — GoHighLevel Smart Pipeline Stages

| Attribute | Detail |
|-----------|--------|
| **Feature Name** | Intelligent Pipeline Stage Engine |
| **Source Platform** | GoHighLevel |
| **Functional Description** | Pipeline stages are not just labels — each stage has entry conditions, exit criteria, required actions, and automatic next-step triggers. GoHighLevel calls this "Smart Lists + Pipeline Automation." Moving a deal to a new stage auto-triggers a checklist, assigns agents, and sends notifications. |
| **UX Interaction Pattern** | In the Deal Pipeline view, each stage column has an info icon that expands to show entry criteria, required checklist, and auto-triggered actions. When a deal is dragged to a new stage, a modal confirms the move and shows which automations will fire. Stage health indicators (overdue items, missing artifacts) are surfaced as badge counts on each column. |
| **Technical Implementation Notes** | Add `pipeline_stages` table: `(id, org_id, hub, name, entry_conditions JSONB, exit_criteria JSONB, required_artifacts text[], auto_actions JSONB, order_index)`. Extend existing `deals` table with `pipeline_stage_id` FK. When `pipeline_stage_id` changes (Supabase DB trigger or API handler), evaluate `auto_actions` and dispatch through `lib/integrations/gateway.ts`. Exit criteria validation runs in `lib/gates.ts` before allowing stage advancement. `components/source/DealPipeline.tsx` already exists — extend with stage metadata overlay. |
| **Suggested Enhancements** | (1) Stage velocity analytics: average time-in-stage per deal type, surfaced in the grid analytics view. (2) Predictive stage scoring: probability-of-close per deal based on checklist completion and historical patterns. (3) Automated LP pipeline summary: weekly digest of stage movements sent via `lib/radar-send.ts`. |
| **Integration Pathways** | → `components/source/DealPipeline.tsx` · `lib/source-funnel.ts` · `lib/gates.ts` · `lib/integrations/gateway.ts` · `supabase/migrations/` |

---

### FEATURE 09 — GoHighLevel Multi-Channel Sequence Automation

| Attribute | Detail |
|-----------|--------|
| **Feature Name** | Investor & Deal Outreach Sequences |
| **Source Platform** | GoHighLevel |
| **Functional Description** | Timed, multi-channel sequences that execute automatically: Day 0 sends an intro email, Day 3 sends a Slack message to the internal team, Day 7 sends a DocuSign NDA if no response. GoHighLevel sequences support reply detection (stop on response) and A/B testing of message variants. |
| **UX Interaction Pattern** | In Outreach Studio, a new "Sequences" tab shows active sequences as a timeline strip per contact/deal. Each step in the strip shows status (sent, opened, replied, bounced). A sequence builder (lightweight version of the Visual Canvas) lets operators configure steps, delays, and stop conditions in ~3 clicks. |
| **Technical Implementation Notes** | New `outreach_sequences` table: `(id, org_id, name, steps JSONB, stop_on_reply BOOL, active)`. New `sequence_enrollments` table: `(id, sequence_id, target_type, target_id, current_step, enrolled_at, completed_at, stopped_reason)`. Cron sweep checks `sequence_enrollments` for due steps and dispatches via `lib/integrations/gateway.ts` (already supports Gmail, Slack, DocuSign). Reply detection hooks into `lib/integrations/adapters/inbox.ts` — on inbound message, query open enrollments for that contact and set `stopped_reason = 'reply_received'`. Extend `lib/outreach.ts` with sequence management functions. |
| **Suggested Enhancements** | (1) A/B test variants: track open/reply rates per variant and auto-promote winner. (2) Warm intro detection: if a relationship exists in `capital-map.ts`, insert a warm intro step before cold outreach. (3) Sequence analytics dashboard showing conversion rates by sequence type. |
| **Integration Pathways** | → `lib/outreach.ts` · `lib/integrations/gateway.ts` · `lib/cron.ts` · `components/source/OutreachStudio.tsx` · `lib/capital-map.ts` |

---

### FEATURE 10 — GoHighLevel Trigger-Based Smart Alerts

| Attribute | Detail |
|-----------|--------|
| **Feature Name** | Event-Triggered Smart Alerts |
| **Source Platform** | GoHighLevel |
| **Functional Description** | Operators configure alert rules: "When a deal's conviction score drops below 60, notify me on Slack and pause the outreach sequence." GoHighLevel's alert engine handles threshold monitoring, deduplication, and escalation paths. |
| **UX Interaction Pattern** | In Settings > Alerts, a rule builder with trigger (field + operator + value), channel (Slack / Email / in-app), and escalation (notify team lead after 24h if unacknowledged). Active alerts surface in the Command Center as banner cards with dismiss/investigate actions. |
| **Technical Implementation Notes** | New `alert_rules` table: `(id, org_id, trigger_entity, trigger_field, operator ENUM('lt','gt','eq','changed'), threshold_value, channel JSONB, escalation JSONB, active)`. Alert evaluation runs in the cron sweep (`lib/cron.ts`) and on record writes via Supabase DB triggers. Alert dispatch through `lib/integrations/gateway.ts`. Alert deduplication via `alert_events` table tracking last-fired timestamps. `lib/mission-control.ts` surfaces active alerts for the Command Center. |
| **Suggested Enhancements** | (1) AI-suggested alert rules: Claude analyzes historical task failures and recommends proactive alerts. (2) Alert fatigue prevention: auto-snooze rules that fire more than 3 times in 24h without operator action. (3) Cross-org benchmarking alerts: flag when an org metric falls below fund-type peer median. |
| **Integration Pathways** | → `lib/cron.ts` · `lib/integrations/gateway.ts` · `lib/mission-control.ts` · `components/dashboard/CommandCenter.tsx` · `supabase/migrations/` |

---

### FEATURE 11 — Figma Design Token System

| Attribute | Detail |
|-----------|--------|
| **Feature Name** | Enforced Design Token Architecture |
| **Source Platform** | Figma |
| **Functional Description** | Figma's design token system creates a single source of truth for color, typography, spacing, and shadow — consumed by both design tools and code. All visual decisions reference tokens, not raw values. This ensures consistency, enables theming, and makes design changes propagate automatically. |
| **UX Interaction Pattern** | Tokens are invisible to end users but enforce visual consistency. Developer-facing: all Tailwind classes in components reference semantic token names (e.g., `text-token-primary`, `bg-token-surface-elevated`) not raw colors. A token reference storybook page (`/design-system`) shows all tokens with live swatches. |
| **Technical Implementation Notes** | FundExecs OS already uses Tailwind with a custom theme in `tailwind.config.ts` (warm-black/gold palette). Formalize this into a token layer by: (1) Extracting all raw color values into CSS custom properties in `app/globals.css` (`--color-primary: #...`). (2) Mapping Tailwind theme to reference these CSS vars. (3) Creating a `lib/design-tokens.ts` export of the token map for use in dynamic styling (e.g., chart colors). (4) Adding a `DESIGN_TOKENS.md` contract that locks token names — no raw hex values in component files. Enforce with an ESLint rule (custom rule checking for hardcoded color strings in JSX). |
| **Suggested Enhancements** | (1) Dark/light mode token variants via CSS `prefers-color-scheme` + a manual toggle that writes to user preferences in Supabase. (2) Brand customization: org-level color overrides stored in `organization_settings` that override CSS vars at login, enabling white-label deployments. (3) Figma Code Connect integration: use the Figma MCP server to sync token definitions bidirectionally with the Figma design file. |
| **Integration Pathways** | → `tailwind.config.ts` · `app/globals.css` · `lib/design-tokens.ts` (new) · ESLint config · `mcp__Figma__get_variable_defs` (Figma MCP for token sync) |

---

### FEATURE 12 — Figma Component Variant System

| Attribute | Detail |
|-----------|--------|
| **Feature Name** | Component Variant Architecture |
| **Source Platform** | Figma |
| **Functional Description** | Figma's variants enable a single component to express all its states (default, hover, active, disabled, loading, error) as named variants from a single source. This eliminates ad-hoc state styling scattered across files and ensures every state is designed and tested. |
| **UX Interaction Pattern** | Internal to the component library. Each UI component accepts an explicit `variant` prop with typed options. Components render predictably across all states. A Storybook-style `components/design-system/ComponentGallery.tsx` page renders every component in all variants for visual regression testing. |
| **Technical Implementation Notes** | Audit existing components for implicit state handling and standardize to explicit variant props. Define a shared `types/ui.ts`: `ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive'`, `StatusVariant = 'idle' | 'loading' | 'success' | 'error'`, etc. Refactor high-traffic components first: ModuleView, ModuleTable, CommandCenter cards, Copilot dock. Co-locate variant Tailwind class maps with component files using a `cva` (class-variance-authority) pattern — already a common companion to Tailwind, zero new dependencies if using `tailwind-merge`. |
| **Suggested Enhancements** | (1) Auto-generate variant documentation from TSDoc comments. (2) Visual regression test snapshots in CI using Playwright screenshot comparisons of the gallery page. (3) Sync component structure with Figma library using `mcp__Figma__get_code_connect_map`. |
| **Integration Pathways** | → `components/` (all) · `types/ui.ts` (new) · `tailwind.config.ts` · `.github/workflows/` (CI screenshots) · Figma MCP Code Connect |

---

### FEATURE 13 — Figma Live Annotation & Collaborative Review

| Attribute | Detail |
|-----------|--------|
| **Feature Name** | In-App Collaborative Annotation |
| **Source Platform** | Figma |
| **Functional Description** | Figma's comment threads allow stakeholders to annotate specific UI elements in context, with threaded replies, resolution tracking, and @mentions. For FundExecs OS, this pattern adapts to collaborative deal review — annotating specific fields in a deal record, diligence doc, or LP report. |
| **UX Interaction Pattern** | A "Review Mode" toggle on deal and document views enables comment anchors on any field or text block. Anchors appear as numbered circle icons. Clicking opens a thread panel. Inline annotation chips show commenter initials and unresolved count. Resolved threads collapse but remain accessible. @mentioning a team member sends a Slack notification. |
| **Technical Implementation Notes** | New `annotations` table: `(id, org_id, entity_type, entity_id, field_path TEXT, thread_id, author_id, content, resolved BOOL, created_at)`. New `annotation_replies` table for thread replies. Frontend: `components/shared/AnnotationLayer.tsx` wraps any entity view and renders anchor icons. Anchor positions are computed from `field_path` (dot-notation selector into the entity object). Resolved/unread counts surface in the Command Center activity feed. @mention dispatch goes through `lib/integrations/adapters/slack.ts`. |
| **Suggested Enhancements** | (1) AI-assisted annotation: when an analyst flags a concern, Claude suggests related precedents from the brain KB. (2) Annotation export: compile all resolved annotations into a diligence summary PDF artifact. (3) LP-facing annotations: allow external reviewers in data rooms to annotate shared documents (with org-scoped visibility controls). |
| **Integration Pathways** | → `lib/integrations/adapters/slack.ts` · `supabase/migrations/` · `components/run/DocumentsModule.tsx` · `components/execute/AssetWarRoom.tsx` · `lib/artifact-seal.ts` |

---

### FEATURE 14 — Figma Prototype Flow → Guided Operator Flows

| Attribute | Detail |
|-----------|--------|
| **Feature Name** | Guided Operator Flows |
| **Source Platform** | Figma |
| **Functional Description** | Figma Prototype links specific frames in a step-by-step flow, guiding users through a process with visual connectors and hotspot interactions. For FundExecs OS, this pattern powers "Guided Modes" — step-by-step walkthroughs for complex processes like closing a round or onboarding an LP. |
| **UX Interaction Pattern** | A "Guided Mode" button appears on high-complexity hubs (Execute > Closing, Build > Formation Wizard). When activated, the UI dims non-relevant sections, highlights the current step with a spotlight ring, and shows a persistent progress bar with step names. Each step has a "Mark Complete & Continue" action. Operators can exit guided mode at any time. |
| **Technical Implementation Notes** | Guided flows are defined as JSON configs: `{ steps: [{ id, title, description, highlight_selector, completion_condition }] }`. Store in `lib/guided-flows.ts`. A `GuidedModeOverlay` component (React portal) renders the spotlight and progress bar. Completion conditions evaluate against live Supabase record state — e.g., step "Upload signed term sheet" completes when an artifact of type `term_sheet` exists for the deal. Operator progress persists in `session_state` (existing `sessions` table extension). |
| **Suggested Enhancements** | (1) AI-generated flow customization: Claude analyzes org type and deal stage to recommend which guided flow to activate proactively. (2) Completion analytics: track time-per-step and drop-off rates to identify UX friction points. (3) Co-pilot narration: Earn agent provides voice-of-guide commentary at each step via the BrainFeed panel. |
| **Integration Pathways** | → `components/execute/ClosingModule.tsx` · `components/build/FormationWizard.tsx` · `lib/next-best-action.ts` · `lib/session-messages.ts` · `supabase/migrations/` |

---

## Cross-Platform Integration Architecture

### Model-Agnostic AI Layer

All agent features (Features 01–06) are implemented against a provider-abstracted interface in `lib/claude.ts`. To make this model-agnostic:

```typescript
// lib/ai-provider.ts (new)
export interface AIProvider {
  generatePlan(prompt: string, context: PlanContext): Promise<Plan>
  executeStep(step: Step, context: StepContext): Promise<StepOutput>
  extractMemories(output: string, agentKey: string): Promise<Memory[]>
  synthesizeKnowledge(artifacts: Artifact[]): Promise<string>
}

// Implementations
export class AnthropicProvider implements AIProvider { ... }  // claude-sonnet-5
export class OpenAIProvider implements AIProvider { ... }     // gpt-4o
export class LocalProvider implements AIProvider { ... }      // ollama/local
```

The factory selects provider based on `NEXT_PUBLIC_AI_PROVIDER` env var, defaulting to Anthropic. This enables hybrid deployments where sensitive data stays on-prem with a local model while general tasks use cloud APIs.

---

### Integration Priority Matrix

| Integration | Features Served | Priority | Current Status |
|-------------|----------------|----------|---------------|
| **Slack** | Alert dispatch (F10), Sequence steps (F09), Annotation @mention (F13), Handoff notifications (F02) | Critical | Adapter exists (`lib/integrations/adapters/slack.ts`) |
| **Docusign** | Sequence step — NDA/subscription doc send (F09), Stage gate — signature required (F08) | Critical | Adapter exists (`lib/integrations/adapters/docusign.ts`) |
| **Google Workspace** | Knowledge synthesis export (F05), Annotation export (F13), Calendar-triggered sequences (F09) | High | Gmail adapter exists; Drive/Calendar to add |
| **Carta** | Cap table stage gates (F08), Execute hub data sync (F08), Portfolio KPI alerts (F10) | High | MCP available (`mcp__Carta__*`) |

---

### Supabase Migration Plan

The following migrations are required to support all blueprint features. Apply in order:

```sql
-- Migration 0028: Agent routing events
CREATE TABLE routing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  task_id uuid NOT NULL REFERENCES tasks(id),
  step_id uuid REFERENCES task_steps(id),
  agent_key text NOT NULL,
  rationale_json jsonb,
  confidence numeric,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE task_steps ADD COLUMN agent_override text;
ALTER TABLE task_steps ADD COLUMN depends_on jsonb DEFAULT '[]';
ALTER TABLE task_steps ADD COLUMN handoff_packet jsonb;

-- Migration 0029: Agent memory system
CREATE TABLE agent_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  agent_key text NOT NULL,
  memory_type text CHECK (memory_type IN ('decision','constraint','preference','outcome','open_item')),
  content text NOT NULL,
  embedding vector(1536),
  source_task_id uuid REFERENCES tasks(id),
  source_session_id uuid REFERENCES sessions(id),
  pinned bool DEFAULT false,
  dismissed bool DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX agent_memories_embedding_idx ON agent_memories USING ivfflat (embedding vector_cosine_ops);
ALTER TABLE sessions ADD COLUMN memory_card jsonb;

-- Migration 0030: Knowledge synthesis queue
CREATE TABLE synthesis_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  topic_key text NOT NULL,
  source_artifact_ids jsonb DEFAULT '[]',
  synthesis_status text DEFAULT 'pending',
  draft_content text,
  approved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Migration 0031: Automation canvas + pipeline stages
ALTER TABLE automations ADD COLUMN canvas_json jsonb;
CREATE TABLE pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  hub text NOT NULL,
  name text NOT NULL,
  entry_conditions jsonb DEFAULT '{}',
  exit_criteria jsonb DEFAULT '{}',
  required_artifacts text[] DEFAULT '{}',
  auto_actions jsonb DEFAULT '[]',
  order_index integer NOT NULL
);
ALTER TABLE deals ADD COLUMN pipeline_stage_id uuid REFERENCES pipeline_stages(id);

-- Migration 0032: Outreach sequences
CREATE TABLE outreach_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  steps jsonb NOT NULL DEFAULT '[]',
  stop_on_reply bool DEFAULT true,
  active bool DEFAULT true,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE sequence_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES outreach_sequences(id),
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  current_step integer DEFAULT 0,
  enrolled_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  stopped_reason text
);

-- Migration 0033: Alert rules
CREATE TABLE alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  trigger_entity text NOT NULL,
  trigger_field text NOT NULL,
  operator text CHECK (operator IN ('lt','gt','eq','changed')),
  threshold_value text,
  channel jsonb NOT NULL,
  escalation jsonb,
  active bool DEFAULT true,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES alert_rules(id),
  entity_id uuid,
  fired_at timestamptz DEFAULT now(),
  acknowledged_at timestamptz
);

-- Migration 0034: Annotations
CREATE TABLE annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  field_path text,
  author_id uuid NOT NULL REFERENCES principals(id),
  content text NOT NULL,
  resolved bool DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE annotation_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  annotation_id uuid NOT NULL REFERENCES annotations(id),
  author_id uuid NOT NULL REFERENCES principals(id),
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);
```

---

## Implementation Roadmap

### Phase 1 — Foundation (Weeks 1–3)
Priority: Infrastructure that unlocks multiple features.

| Task | Features Unlocked | Owner Layer |
|------|------------------|-------------|
| Apply migrations 0028–0034 | All 14 features | `supabase/migrations/` |
| Extract design tokens to CSS vars | F11, F12 | `tailwind.config.ts`, `app/globals.css` |
| Create `lib/ai-provider.ts` abstraction | F01–F06 | `lib/` |
| Extend `lib/routing-trace.ts` → `routing_events` | F01, F02 | `lib/` |

### Phase 2 — Memory & Intelligence (Weeks 4–6)
Priority: Highest user-visible AI quality gain.

| Task | Feature | Files |
|------|---------|-------|
| `lib/brains/memory.ts` — extract + retrieve | F04 | `lib/brains/` |
| Session Memory Card component + Supabase realtime | F06 | `components/session/` |
| Handoff packet generation in `engine.ts` | F02 | `lib/engine.ts`, `lib/claude.ts` |
| Knowledge synthesis cron + approval UI | F05 | `lib/brains/`, `/api/cron`, `components/session/BrainFeed.tsx` |

### Phase 3 — Automation Canvas (Weeks 7–10)
Priority: Operator self-service; reduces platform dependency.

| Task | Feature | Files |
|------|---------|-------|
| Visual Automation Canvas (`reactflow`) | F07 | `components/automations/WorkflowCanvas.tsx` |
| Pipeline Stage Engine | F08 | `components/source/DealPipeline.tsx`, `lib/source-funnel.ts` |
| Outreach Sequence Builder + Cron execution | F09 | `lib/outreach.ts`, `components/source/OutreachStudio.tsx` |
| Alert Rule Builder + Command Center surface | F10 | `lib/mission-control.ts`, `components/dashboard/` |

### Phase 4 — UX Clarity (Weeks 11–13)
Priority: Figma-level polish and guided operator experience.

| Task | Feature | Files |
|------|---------|-------|
| Component variant audit + `cva` pattern | F12 | `components/` (all) |
| Collaborative Annotation Layer | F13 | `components/shared/AnnotationLayer.tsx` |
| Guided Operator Flows | F14 | `lib/guided-flows.ts`, `components/` |
| Agent Routing Console | F01 | `components/dashboard/AgentRoutingConsole.tsx` |
| Task DAG view | F03 | `components/session/TaskDAGView.tsx` |

---

## Guiding Principles Applied

| Principle | How It Manifests in This Blueprint |
|-----------|-----------------------------------|
| **Figma-level design clarity** | Token system (F11), variant architecture (F12), annotation threads (F13), guided flows (F14) |
| **GoHighLevel automation depth** | Visual canvas (F07), smart stage engine (F08), sequences (F09), alert rules (F10) |
| **Zernio agent logic** | Routing console (F01), handoff protocol (F02), task decomposition (F03) |
| **BotMemo memory/knowledge** | Cross-session memory (F04), knowledge synthesis (F05), session memory card (F06) |
| **Native feel preserved** | All components extend existing hub architecture; no new routing paradigms introduced |
| **Modular + scalable** | Every feature maps to isolated table(s) + lib module(s); features are independently deployable |
| **Model-agnostic** | `lib/ai-provider.ts` abstraction allows Claude/GPT/local model swap without feature changes |
| **Hybrid deployment** | Supabase RLS + org-scoped data ensures multi-tenant safety; on-prem option via `LocalProvider` |

---

## Appendix: Feature × Existing File Dependency Map

```
F01 Agent Routing Console
  reads:  lib/routing-trace.ts, lib/intelligence.ts
  writes: supabase/migrations/0028 (routing_events), components/dashboard/AgentRoutingConsole.tsx

F02 Structured Handoff
  reads:  lib/engine.ts, lib/claude.ts
  writes: lib/engine.ts (handoff generation), task_steps.handoff_packet

F03 Task Decomposition DAG
  reads:  lib/engine.ts, lib/claude.ts
  writes: task_steps.depends_on, components/session/TaskDAGView.tsx

F04 Cross-Session Memory
  reads:  lib/brains/pgvector.ts, lib/brains/embed.ts
  writes: lib/brains/memory.ts (new), agent_memories table, lib/claude.ts (context injection)

F05 Knowledge Synthesis
  reads:  lib/brains/catalog.ts, lib/brains/llm.ts, lib/cron.ts
  writes: synthesis_queue table, lib/brains/catalog.ts (synthesis trigger)

F06 Session Memory Card
  reads:  lib/session-messages.ts, sessions table
  writes: sessions.memory_card, components/session/MemoryCard.tsx (new)

F07 Visual Workflow Canvas
  reads:  lib/workflows.ts, lib/cron.ts, lib/integrations/gateway.ts
  writes: automations.canvas_json, components/automations/WorkflowCanvas.tsx (new)

F08 Smart Pipeline Stages
  reads:  components/source/DealPipeline.tsx, lib/source-funnel.ts, lib/gates.ts
  writes: pipeline_stages table, deals.pipeline_stage_id

F09 Outreach Sequences
  reads:  lib/outreach.ts, lib/integrations/gateway.ts, lib/cron.ts
  writes: outreach_sequences table, sequence_enrollments table

F10 Smart Alert Rules
  reads:  lib/cron.ts, lib/mission-control.ts, lib/integrations/gateway.ts
  writes: alert_rules table, alert_events table, components/dashboard/ (alert banner)

F11 Design Token System
  reads:  tailwind.config.ts, app/globals.css
  writes: app/globals.css (CSS vars), lib/design-tokens.ts (new), ESLint rule

F12 Component Variant Architecture
  reads:  components/ (all)
  writes: types/ui.ts (new), cva refactor across components

F13 Collaborative Annotation
  reads:  lib/integrations/adapters/slack.ts, lib/artifact-seal.ts
  writes: annotations table, annotation_replies table, components/shared/AnnotationLayer.tsx (new)

F14 Guided Operator Flows
  reads:  lib/next-best-action.ts, lib/session-messages.ts
  writes: lib/guided-flows.ts (new), components/shared/GuidedModeOverlay.tsx (new)
```

---

*This blueprint is implementation-ready. Each feature can be built independently and merged incrementally. No feature requires breaking changes to the existing task engine, agent catalog, or Supabase schema outside of the additive migrations specified above.*
