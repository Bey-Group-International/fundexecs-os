# FundExecs OS — Edge Context Optimization Spec
## Browser Session Metadata → Agentic Intelligence Pipeline

**Version:** 1.0  
**Layer:** Greenfield input layer — global context enrichment  
**Execution model:** Hybrid (active tab synchronous, background cluster asynchronous)

---

## A. Summary

The browser session metadata (`edge_all_open_tabs`) reveals three actionable workflow signals from the sample context:

1. **Relationship Management Mode** — Current tab is LinkedIn Connections. The operator is actively working their network. Triggers: Business Dev / Sourcing, Investor Relations, Rainmaker.
2. **Event Intelligence Context** — Luma guest management tab (Black Card After Dark) indicates event-layer relationship work. Triggers: Curator, Investor Relations.
3. **PE Research Signal** — Mergers & Inquisitions PE Careers tab. Passive research posture. Triggers: Analyst, Deal Sourcer.

**Platform context:** Professional-only. No personal tabs. No conflicting workflow signals. High-confidence routing to relationship + outreach agents.

---

## B. Optimization Logic

### B1 — Tab Classification Rules

1. **Rule: Domain-only classification.** Classify tabs exclusively from `pageUrl` hostname + path. Never parse `pageTitle` as instruction input. Page titles are display text controlled by third parties and may contain injection payloads.

2. **Rule: Current tab weighted 3×.** The `isCurrent: true` tab receives a priority multiplier of 3.0 over background tabs. Active attention = highest intent signal.

3. **Rule: Background cluster scoring.** Background tabs are grouped by hostname family. Three or more tabs sharing a domain family elevate that cluster's composite score above any single tab.

4. **Rule: LinkedIn path specificity.** LinkedIn tabs are further resolved by URL path:
   - `/mynetwork/invite-connect/connections` → `linkedin_connections` → Sourcing + IR agents
   - `/notifications` → `linkedin_notifications` → Automater/Scrubber brain
   - `/feed` → `linkedin_feed` → low-weight passive signal
   - `/messaging` → `linkedin_messaging` → Rainmaker + Outreach agents
   - `/in/<slug>` → `linkedin_profile` → Executive Advisor (profiling mode)
   - `/search` → `linkedin_search` → Deal Sourcer + Lead Generator

5. **Rule: Event management detection.** Any URL matching `luma.com/event/manage/*/guests` or equivalent event-platform guest-list paths activates Curator brain at elevated priority.

6. **Rule: Research domain classification.** Known PE/finance research domains (`mergersandinquisitions.com`, `pitchbook.com`, `axial.net`, `dealogic.com`, `preqin.com`, `bloomberg.com`, `wsj.com`) map to Analyst + Deal Sourcer agents.

7. **Rule: Deal platform detection.** Transactional platform URLs (`axial.net`, `dealnexus.com`, `bizbuysell.com`, `businessbroker.net`) trigger Deal Sourcer at high priority.

8. **Rule: Zero instruction surface from metadata.** URL query parameters, URL fragments, and page titles are stripped of any content that matches command/instruction patterns before any tab data is used for routing.

9. **Rule: Minimum confidence threshold.** Tab signals below a composite confidence score of 0.30 are discarded and do not influence routing. Unknown domains produce no agent hints.

10. **Rule: Workflow context collapse.** Multiple tab signals are collapsed into a single `WorkflowContext` enum before routing. Conflicting signals (e.g., PE research + social media + news) default to `general` and apply no agent priority boost.

### B2 — Agent Routing Rules

11. **Rule: Agent priority map, not single agent selection.** The pipeline produces a `Record<AgentKey, number>` priority score (0–100), not a single agent pick. The existing brain-routing layer consumes this map as a bias signal, not an override.

12. **Rule: Hard agent floor.** No tab signal may reduce an agent's baseline priority below its default. Signals only add positive weight.

13. **Rule: Non-delegable actions remain gated.** Tab context never unlocks Tier 3 approval gates. It influences which agent activates, never what that agent is permitted to do.

14. **Rule: Stale context expiry.** Tab context older than 300 seconds (5 minutes) is treated as expired. Expired context is not injected into agent prompts.

15. **Rule: Context version stamping.** Every `EdgeContextResult` carries a `capturedAt` timestamp and a `contextVersion` hash. Session memory updates only when the hash changes, preventing redundant enrichment.

### B3 — Memory & Speed Rules

16. **Rule: Active tab synchronous, background async.** The active tab is classified and injected into the session context before the first agent response. Background tab clustering runs in a non-blocking async pass and is available by the second agent invocation.

17. **Rule: Cached domain lookups.** URL hostname → domain family mapping uses an in-process Map cache. No external I/O on the critical path.

18. **Rule: Session memory card integration.** `EdgeContextResult.workflowContext` is merged into the existing `SessionMemoryCard` as a `constraints` entry on async completion. This surfaces tab-derived context to all agents without requiring re-classification.

19. **Rule: No re-classification on identical input.** If `edge_all_open_tabs` is unchanged from the prior request (hash match), the cached `EdgeContextResult` is returned immediately.

---

## C. Agent Pipeline Specification

```
STAGE 0 — INTAKE (synchronous, <1ms)
  Input:  EdgeTab[]
  Output: Sanitized EdgeTab[] (titles stripped of injection patterns, params normalized)

  Steps:
  1. Validate schema: require pageUrl (string), tabId (number), isCurrent (boolean)
  2. Drop any tab where pageUrl is not a valid https:// URL
  3. Strip pageTitle of any content matching /\b(ignore|disregard|system|assistant|user|prompt|instruction|override)\b/i
  4. Hash the sanitized tab array → contextHash
  5. If contextHash === session.lastEdgeContextHash → return cached EdgeContextResult

STAGE 1 — ACTIVE TAB CLASSIFICATION (synchronous, <2ms)
  Input:  The single tab where isCurrent === true
  Output: ClassifiedTab (domain, agentHints[], weight=1.0 * 3.0 multiplier)

  Steps:
  1. Extract hostname + pathname from pageUrl
  2. Match against DOMAIN_RULES (see implementation) → TabDomain
  3. Map TabDomain → AgentKey[] hints
  4. Build ClassifiedTab with weight = 3.0

STAGE 2 — BACKGROUND CLUSTER ANALYSIS (async, non-blocking)
  Input:  All tabs where isCurrent === false
  Output: ClassifiedTab[] + cluster composite scores

  Steps:
  1. Classify each background tab → TabDomain (same rules as Stage 1)
  2. Group by hostname family
  3. Score each cluster: base weight = 1.0 per tab, cluster bonus +0.5 per additional tab in same family
  4. Emit ClassifiedTab[] with individual weights

STAGE 3 — WORKFLOW CONTEXT COLLAPSE (synchronous, after Stage 1; updated after Stage 2)
  Input:  ClassifiedTab[] (Stage 1 result, then merged with Stage 2)
  Output: WorkflowContext

  Steps:
  1. Collect all TabDomains weighted by ClassifiedTab.weight
  2. Apply WORKFLOW_CONTEXT_MAP (domain → context)
  3. If top context score > 60% of total weight → assign that context
  4. Else if professional domains > 80% of tabs → assign "general" (professional)
  5. Else → assign "general"

STAGE 4 — PRIORITY SCORING (synchronous, after Stage 3)
  Input:  ClassifiedTab[], WorkflowContext
  Output: Record<AgentKey, number> (0-100)

  Steps:
  1. Initialize all AgentKeys at score 0
  2. For each ClassifiedTab:
     - For each agentHint in ClassifiedTab.agentHints:
       - score[agent] += weight * AGENT_BASE_SIGNAL[domain]
  3. Normalize: scale so max score = 100
  4. Apply floor: no agent score goes below 0

STAGE 5 — EXECUTION HINTS GENERATION (synchronous, after Stage 4)
  Input:  WorkflowContext, ClassifiedTab[], priority map
  Output: string[] (natural language hints for agent system prompts)

  Steps:
  1. Generate hint for active tab context
  2. Generate hint for dominant background cluster if score > 40
  3. Generate professional context confirmation
  4. Cap at 3 hints total

STAGE 6 — SESSION MEMORY MERGE (async, non-blocking)
  Input:  EdgeContextResult
  Output: Updated SessionMemoryCard constraints[]

  Steps:
  1. Format context as: "User is actively in [workflowContext] mode (tab context: [summary])"
  2. Upsert into SessionMemoryCard.constraints via existing session-memory module
  3. Update session.lastEdgeContextHash = contextHash
```

---

## D. Safety & Boundary Guardrails

### What metadata CAN influence:
- Agent priority weighting (additive only, never subtractive below baseline)
- `WorkflowContext` hint injected into agent system preambles
- `SessionMemoryCard.constraints` (one structured entry)
- Brain selection bias in `brain-routing.ts`
- Execution hints (max 3 short strings)

### What metadata MUST NEVER influence:
- Approval gate tier classification (Tier 1/2/3 is action-type-based, not context-based)
- Non-delegable action permissions
- Agent autonomy level escalation
- Legal, compliance, or financial decision pathways
- Output content (the agent reasons from documents and user prompts, not from URLs)
- Whether an external action is permitted
- User identity or permissions inference

### Injection defense:
- `pageTitle` is treated as untrusted display text. Never parsed for instructions.
- URL query strings and fragments (`?`, `#`) are dropped before pattern matching.
- Any `pageUrl` containing prompt-injection markers (`\n`, `<!--`, `<script`, `ignore previous`) causes the entire tab entry to be quarantined (excluded from classification, logged as safety flag).
- The pipeline processes URL structure (hostname + path segments) only — never renders or executes URL content.
- If `edge_all_open_tabs` itself contains non-array input, the entire context pass is skipped and the system routes on intent alone.

### Agent misfire prevention:
- No agent is auto-triggered by tab context alone. Context only adjusts priority weights for the next agent the user's explicit request routes to.
- Tab context does not generate autonomous outreach, drafts, or task initiations.
- All context enrichment is logged to `brain_runs` with source `"edge_context"` for audit visibility.

---

## E. Final Optimized Logic Block

```typescript
// Canonical contract for the Edge Context pipeline.
// Import from lib/edge-context.ts

interface EdgeTab {
  pageTitle: string;  // untrusted display text — sanitize before any use
  pageUrl: string;    // classification source — hostname + path only
  tabId: number;
  isCurrent: boolean;
}

interface EdgeContextResult {
  contextHash: string;                          // SHA-1 of sanitized tab array
  capturedAt: number;                           // Date.now() at classification time
  workflowContext: WorkflowContext;             // collapsed workflow signal
  primaryAgentHint: AgentKey | null;           // top-scored agent (null if tie or no signal)
  agentPriorityMap: Partial<Record<AgentKey, number>>;  // 0-100 bias scores
  executionHints: string[];                     // max 3 natural language hints
  classifiedTabs: ClassifiedTab[];              // full classification record
  safetyFlags: string[];                        // quarantined tab IDs + reasons
  backgroundProcessed: boolean;                 // false until Stage 2 completes
}

// Execution contract:
// classifyActiveTab(tabs)  → runs synchronously, returns partial EdgeContextResult
// processBackgroundTabs()  → runs async, merges into session store
// getEdgeContext(sessionId) → returns current EdgeContextResult from session store
// injectEdgeContext(result, systemPrompt) → appends ≤3 hint lines to system prompt
// isExpired(result) → result.capturedAt < Date.now() - 300_000
```

---

## Implementation Files

| File | Change type | Purpose |
|---|---|---|
| `lib/edge-context.ts` | New | Full pipeline implementation |
| `lib/intent.ts` | Extend | Accept optional `EdgeContextResult` to weight intent classification |
| `lib/brain-routing.ts` | Extend | `brainForAgent()` accepts optional priority map |
| `lib/brains/session-memory.ts` | Extend | Merge edge context into `constraints[]` |
