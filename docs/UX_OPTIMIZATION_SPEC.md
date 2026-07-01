# FundExecs OS — UX Optimization Specification

**Version:** 1.0  
**Date:** 2026-07-01  
**Classification:** UX / Implementation-Ready  
**Scope:** Cross-persona UX uplift across all four friction zones  
**Design Anchors:** Linear (keyboard-first speed) · Superhuman (coached discovery)  
**Time-to-Value Target:** First meaningful artifact in ≤ 5 minutes

---

## Design Philosophy

FundExecs OS serves three personas (Fund Manager, Operator, Analyst) on a single platform. Rather than building three separate UX modes, the system adapts its surface density to role and context automatically. Two reference products define the target feel:

- **Linear**: Every action reachable by keyboard. No dead ends. State changes are instant. The interface trusts the user.
- **Superhuman**: The system teaches its own power features in context, at the right moment, without interrupting flow. Onboarding is woven into usage, not front-loaded.

The 5-minute time-to-value constraint is a forcing function: if a new user cannot produce a real output (an AI-generated artifact, a deal record, a report draft) within five minutes of first login, the onboarding is broken — regardless of how complete the underlying feature set is.

---

## Friction Zone 1 — Onboarding & First-Run

### UX-01: Zero-to-First-Artifact Onboarding

**Problem:** New users land on the dashboard with no clear first action. The hub system is powerful but opaque without context.

**Solution: Role-Adaptive First Run**

On first login, after collecting role (Fund Manager / Operator / Analyst) during the existing onboarding flow, the system enters a guided "First Mission" sequence — not a feature tour, but a real task that produces a real artifact.

| Role | First Mission | Artifact Produced | Target Time |
|------|-------------|------------------|-------------|
| Fund Manager | "Review your first deal" | AI-generated deal summary + conviction score | 3 min |
| Operator | "Set up your first automation" | Saved workflow with one trigger + one action | 4 min |
| Analyst | "Run diligence on a company" | Populated diligence checklist with AI-filled fields | 5 min |

**UX Interaction Pattern:**

1. After onboarding form, a full-screen "Mission Card" appears — not a modal, a dedicated route (`/first-mission`).
2. The card shows: mission title, estimated time, one large CTA ("Start Mission"), and a skip link (text-only, not a button — discourage skipping but don't block).
3. The mission uses the Guided Operator Flow system (Blueprint F14) to walk through exactly the steps needed, with the Earn agent providing narration in the Brain Feed.
4. On completion, a "Mission Complete" celebration screen shows the artifact, with two next actions: "Go to Dashboard" or "Run another mission."

**Technical Implementation:**

- Add `onboarding_mission_completed BOOL` and `onboarding_role TEXT` columns to `organization_members`.
- New route `app/(app)/first-mission/page.tsx` renders `MissionCard` component.
- Mission definitions in `lib/guided-flows.ts` (one entry per role).
- Middleware check: if `onboarding_mission_completed = false` and session count = 0, redirect to `/first-mission` after auth.
- On mission artifact creation, set `onboarding_mission_completed = true` and redirect to dashboard.

**Files:** `app/(app)/first-mission/` · `lib/guided-flows.ts` · `components/shared/GuidedModeOverlay.tsx` · `supabase/migrations/`

---

### UX-02: Contextual Empty States

**Problem:** Empty states (no deals, no automations, no tasks) are dead ends. Users don't know what to do first.

**Solution:** Every empty state is an action, not a message.

Each hub's empty state renders:
1. A one-sentence explanation of what this section does (role-specific).
2. One primary action button that creates a starter record with sensible defaults.
3. An "Ask the Copilot" secondary action that opens a pre-filled prompt in the session panel.

| Surface | Primary Action | Pre-filled Copilot Prompt |
|---------|---------------|--------------------------|
| Deal Pipeline | "Add your first deal" | "Help me add a deal I'm evaluating" |
| Automations | "Build an automation" | "Set up a weekly LP update reminder" |
| Brains / KB | "Add knowledge" | "What should I add to the brain first?" |
| Portfolio | "Add an asset" | "Help me add a portfolio company" |

**Technical Implementation:**

- Create `components/shared/EmptyState.tsx` — accepts `title`, `description`, `primaryAction`, `copilotPrompt` props.
- Replace all existing empty state renders across hub components with this component.
- `copilotPrompt` wires directly into the session command bar (`components/session/SessionCommandBar.tsx`) pre-populated on click.

**Files:** `components/shared/EmptyState.tsx` (new) · all hub components

---

### UX-03: Progress Persistence Across Sessions

**Problem:** Users who start an onboarding step or guided flow and return later have to start over.

**Solution:** Session state for all multi-step flows persists in Supabase and resumes automatically.

- The existing `sessions` table stores step progress.
- On login, check for incomplete guided flows or first-mission progress and surface a "Resume where you left off" banner in the dashboard header.
- Banner shows: flow name, last completed step, estimated time remaining, "Resume" CTA.

**Files:** `lib/session-messages.ts` · `components/dashboard/` · `sessions` table

---

## Friction Zone 2 — Agent Interactions

### UX-04: Structured Copilot Output Cards

**Problem:** Agent outputs are long text blocks. Users have to read everything to find the actionable parts.

**Solution:** Agents always output structured cards, not prose.

Every step output is rendered as a **Copilot Card** with a fixed anatomy:

```
┌─────────────────────────────────────────────┐
│ [Agent Avatar]  Step Title          [Status] │
├─────────────────────────────────────────────┤
│ SUMMARY                                      │
│ One-sentence result.                         │
├─────────────────────────────────────────────┤
│ KEY FINDINGS                (collapsible)    │
│ • Finding 1                                  │
│ • Finding 2                                  │
├─────────────────────────────────────────────┤
│ ARTIFACT                                     │
│ [IC Memo]  [Open]  [Download]                │
├─────────────────────────────────────────────┤
│ NEXT ACTIONS                                 │
│ [Approve & Continue]  [Regenerate]  [Edit]   │
└─────────────────────────────────────────────┘
```

The agent produces a structured JSON output (already done via `lib/claude.ts` `executeStep()`) that maps to this card. The card collapses key findings by default — users see the summary and actions first, details on demand.

**UX Rules:**
- Summary: max 2 sentences.
- Key findings: max 5 bullets, each max 12 words.
- Actions: max 3 buttons. Primary action always leftmost.
- Never show raw markdown prose as the primary output surface.

**Technical Implementation:**

- New `components/copilot/CopilotCard.tsx` replacing free-form text rendering in `components/Copilot.tsx`.
- `lib/claude.ts` `executeStep()` response schema adds `summary`, `key_findings[]`, `artifact_ids[]`, `next_actions[]` fields alongside existing output.
- Existing `ArtifactViewer` component embeds inside the card for artifact preview.

**Files:** `components/copilot/CopilotCard.tsx` (new) · `components/Copilot.tsx` · `lib/claude.ts`

---

### UX-05: One-Click Action Execution from Copilot Output

**Problem:** Users read agent output and then have to navigate elsewhere to act on it (e.g., open a deal record to update a field the agent just analyzed).

**Solution:** Every fact in a Copilot Card that corresponds to a writable field surfaces an inline edit chip.

When an agent outputs "Conviction score: 72 — recommend increasing to 80 after founder call," the conviction score renders as an editable chip inline. One click opens a mini-editor; one more click saves. No navigation required.

**Implementation:**

- `lib/tool-dispatch.ts` already maps step intents to data mutations. Extend it to also return `suggested_edits[]` — an array of `{ entity_type, entity_id, field, current_value, suggested_value, rationale }`.
- `components/copilot/CopilotCard.tsx` renders `suggested_edits` as inline `EditChip` components.
- `EditChip` shows current value → suggested value with a "Apply" button. Applying calls the existing mutation actions in `components/*/actions.ts`.

**Files:** `lib/tool-dispatch.ts` · `components/copilot/` · `components/shared/EditChip.tsx` (new)

---

### UX-06: Agent Confidence Indicators

**Problem:** Users can't tell when an agent is certain vs. guessing. They either over-trust or under-trust outputs.

**Solution:** Every agent output surface shows a confidence tier.

Three tiers, rendered as a subtle color indicator on the card border and a tooltip:

| Tier | Threshold | Visual | Meaning |
|------|-----------|--------|---------|
| High | ≥ 0.85 | Green left border | Agent has strong grounding from brain KB + data |
| Medium | 0.65–0.84 | Amber left border | Partial grounding; verify key claims |
| Low | < 0.65 | Red left border + warning chip | Limited grounding; treat as a starting point |

Low-confidence outputs auto-surface a "Verify this" action that opens a pre-filled session to research the specific claim.

**Technical Implementation:**

- `lib/claude.ts` `executeStep()` already computes routing confidence. Extend to include `output_confidence` score in step output JSON.
- `CopilotCard` maps score to tier and applies border color via Tailwind variant class.
- Low-confidence "Verify this" action pre-fills `SessionCommandBar` with a verification prompt.

**Files:** `lib/claude.ts` · `components/copilot/CopilotCard.tsx` · `lib/routing-trace.ts`

---

### UX-07: Copilot Interruption & Clarification

**Problem:** Once a workflow starts, users can't steer it mid-execution. They watch it complete and then correct the output.

**Solution:** Mid-run clarification prompts at natural pause points.

Before executing a step where `output_confidence < 0.70` or where the step has `requires_clarification: true` flag, the Copilot Card pauses and surfaces a clarification card:

```
┌─────────────────────────────────────────────────┐
│ Before I continue, I need one thing:             │
│                                                  │
│ [Question text — max 15 words]                   │
│                                                  │
│ [Option A]  [Option B]  [Type your answer]       │
└─────────────────────────────────────────────────┘
```

The clarification is inline — no modal, no navigation. Answer and continue in one gesture.

**Technical Implementation:**

- `/api/clarify` endpoint already exists. Wire it into `lib/engine.ts` step execution: before executing a flagged step, call `/api/clarify` with step context and await operator response before proceeding.
- `CopilotCard` renders clarification state as a card variant.
- Operator answer is injected into step context before Claude receives it.

**Files:** `/api/clarify/` · `lib/engine.ts` · `components/copilot/CopilotCard.tsx`

---

## Friction Zone 3 — Navigation & Discoverability

### UX-08: Universal Command Palette (Linear-style)

**Problem:** The Command Palette (`components/dashboard/CommandPalette.tsx`) exists but may not be keyboard-accessible from everywhere, and its command set may not cover all navigation + actions.

**Solution:** `⌘K` (Mac) / `Ctrl+K` (Win) opens the palette from any screen, any context.

**Command categories (in order of display):**

| Category | Examples |
|----------|---------|
| Recent | Last 5 visited records (deals, assets, sessions) |
| Actions | "New deal", "Run diligence", "Build automation", "Generate LP report" |
| Navigation | "Go to Source Hub", "Open Command Center", "View Portfolio" |
| AI Tasks | "Ask Copilot: [typed query]" — opens session with prefilled prompt |
| Settings | "Invite team member", "Connect Slack", "Manage brains" |

**Keyboard behavior (Linear-standard):**
- `↑↓` to navigate, `Enter` to execute, `Esc` to dismiss.
- Typing filters all categories simultaneously.
- `Tab` cycles between category groups.
- No mouse required at any step.

**Technical Implementation:**

- `CommandPalette` already exists. Extend its command registry with all hub routes, record creation actions, and a passthrough "Ask Copilot" entry.
- Register a global `keydown` listener in `app/layout.tsx` (or a `useCommandPalette` hook) that fires regardless of focused element.
- Command registry defined in `lib/command-registry.ts` (new) — each command: `{ id, label, category, icon, shortcut?, action }`. Hub components register their commands via a React context on mount.

**Files:** `components/dashboard/CommandPalette.tsx` · `lib/command-registry.ts` (new) · `app/layout.tsx`

---

### UX-09: Contextual Side-Panel Navigation

**Problem:** Switching between hub modules requires full-page navigation, breaking context (e.g., leaving a deal record to check a related investor profile).

**Solution:** A persistent side-panel that can hold any entity record without navigating away.

Clicking any linked entity (investor name, deal reference, asset tag) in any view opens it in a slide-over panel on the right — the main view stays in place. The panel supports depth: opening a link from within the panel stacks a new panel layer (max 3 deep), with breadcrumb navigation.

**UX Rules:**
- Panel opens in ≤ 150ms (no loading spinner for cached records).
- `Esc` closes the top panel layer.
- Panel width: 480px on desktop, full-width on mobile.
- Panel header shows entity type chip + entity name + "Open full page" icon.

**Technical Implementation:**

- New `components/shared/SlidePanel.tsx` — React portal rendering a fixed-position panel. Manages a stack of panel entries via React context (`SlidePanelContext`).
- `SlidePanelContext` provides `openPanel(entityType, entityId)` and `closePanel()` — consumed anywhere via `useSlidePanel()` hook.
- Entity type → component mapping in `lib/panel-registry.ts` (new): `deal → DealWarRoom`, `investor → InvestorProfile`, `asset → AssetWarRoom`, etc.
- All entity name links across hub components call `openPanel()` instead of `router.push()`.

**Files:** `components/shared/SlidePanel.tsx` (new) · `lib/panel-registry.ts` (new) · hub link components

---

### UX-10: Smart Recents & Pinned Items

**Problem:** Users return to the same records repeatedly but have to navigate the full hub tree each time.

**Solution:** A persistent "Recents + Pinned" strip at the top of the dashboard, and a floating "recent items" section in the Command Palette.

- Recents: last 10 visited entities (deal / asset / investor / session), shown as compact chips with entity type icon + name. Auto-updates on every navigation.
- Pinned: any entity can be pinned via a `⌘⇧P` shortcut or a pin icon on hover. Pins persist in Supabase (`user_pins` table).
- The strip collapses to a single icon row on narrow viewports.

**Technical Implementation:**

- `user_pins` table: `(id, principal_id, entity_type, entity_id, label, pinned_at)`.
- `lib/recents.ts` (new): tracks navigation history in `localStorage` (no round-trip needed; max 10 items, FIFO).
- `components/dashboard/RecentsStrip.tsx` (new) reads from `localStorage` and `user_pins`.
- Command Palette "Recent" category reads from `lib/recents.ts`.

**Files:** `components/dashboard/RecentsStrip.tsx` (new) · `lib/recents.ts` (new) · `supabase/migrations/`

---

### UX-11: Hub Breadcrumb & Context Bar

**Problem:** Deep within a hub (e.g., Execute > Asset War Room > Valuation > 409A), users lose spatial orientation.

**Solution:** A persistent breadcrumb bar just below the top nav that shows the full location path and allows one-click jump to any ancestor level.

The context bar also shows:
- The primary entity in context (deal name, asset name) as a bold chip.
- A "Related" dropdown showing linked entities (investor, fund, deal) for quick lateral navigation.
- An action menu (⋯) with the most common actions for the current entity.

**Technical Implementation:**

- New `components/shared/ContextBar.tsx` — receives `breadcrumbs[]`, `entity`, `relatedEntities[]`, `actions[]` props.
- Each hub layout (`app/(app)/[hub]/layout.tsx`) provides these props via a `useHubContext()` hook that reads from the URL params and Supabase.
- Breadcrumbs auto-build from the URL path + entity names resolved from the DB.

**Files:** `components/shared/ContextBar.tsx` (new) · `app/(app)/[hub]/layout.tsx` · `lib/workspace.ts`

---

## Friction Zone 4 — Data Input & Forms

### UX-12: AI-Assisted Field Completion

**Problem:** Deal records, investor profiles, and asset forms have many fields. Users fill them manually even when the data is available in uploaded documents or public sources.

**Solution:** Every form field that can be AI-populated shows a "Fill with AI" wand icon on focus.

Clicking the wand triggers a targeted extraction:
1. If a document is attached to the record, Claude extracts the field value from it.
2. If no document, Claude uses the brain KB + public context (company name, sector, etc.) to suggest a value.
3. The suggested value appears in the field with an amber underline (indicating AI-filled). The user can accept (click) or type over it.

AI-filled fields are tagged in the DB with `ai_suggested: true` so downstream analytics can track AI fill rates and accuracy.

**Technical Implementation:**

- `lib/claude.ts` already has `extractDealFields()` and `extractAssetFields()`. Expose these via a new `/api/extract-field` endpoint: `POST { entity_type, entity_id, field_name, document_id? }`.
- `components/shared/AIFieldInput.tsx` (new) — wraps any `<input>` or `<textarea>` with a wand icon trigger and loading/suggested states.
- Replace high-value form fields in `components/build/ProfileForm.tsx`, `components/run/RunUnderwritingModule.tsx`, and `components/execute/ValuationsModule.tsx` with `AIFieldInput`.
- Add `ai_suggested BOOL` column to relevant record tables.

**Files:** `/api/extract-field/` (new) · `components/shared/AIFieldInput.tsx` (new) · `lib/claude.ts` · form components

---

### UX-13: Progressive Form Disclosure

**Problem:** Forms show all fields at once. Users are overwhelmed by optional fields they rarely need.

**Solution:** Forms show only the 3–5 most important fields by default. Additional fields expand under a "More options" disclosure.

**Field Tiers:**

| Tier | Visibility | Examples |
|------|-----------|---------|
| Core | Always visible | Deal name, stage, amount, company |
| Standard | Expand on "+More" click | Sector, geography, source, lead investor |
| Advanced | Expand on "Advanced" click | Custom fields, metadata, integration IDs |

The system remembers which users regularly use Standard/Advanced fields and auto-expands them for those users on subsequent visits (stored in `user_preferences` table).

**Technical Implementation:**

- `components/shared/ProgressiveForm.tsx` (new) — wraps form fields with tier-based show/hide logic.
- Field tier defined via `tier: 'core' | 'standard' | 'advanced'` prop on each form field.
- User preference for auto-expand stored in `user_preferences JSONB` column (add to `organization_members` or existing prefs table).
- High-traffic forms to migrate first: `DealPipeline` new deal form, `ProfileForm`, `InvestorDirectory` add investor form.

**Files:** `components/shared/ProgressiveForm.tsx` (new) · form components · `supabase/migrations/`

---

### UX-14: Inline Validation with Context

**Problem:** Validation errors appear only on submit, and the messages are generic ("This field is required").

**Solution:** Validation is inline (fires on blur, not submit) and context-aware.

Error messages explain *why* the field matters and *what* a correct value looks like:

| Generic (current) | Context-aware (target) |
|------------------|----------------------|
| "Required" | "Deal name is required so agents can reference this deal across sessions." |
| "Invalid format" | "Enter a number (e.g. 5000000 for $5M). No dollar signs or commas." |
| "Too long" | "Limit to 120 characters — this appears in the deal card preview." |

For fields with a fixed set of valid values (sector, stage, geography), show an autocomplete dropdown instead of a free-text error.

**Technical Implementation:**

- `components/shared/FormField.tsx` (new) — standard wrapper accepting `validationRules[]` with message templates.
- Validation rules defined per-field in form configs, not in generic validators.
- Autocomplete fields use existing Supabase enum values pulled at form init.

**Files:** `components/shared/FormField.tsx` (new) · form component configs

---

### UX-15: Bulk Import with AI Mapping

**Problem:** Users with existing data in spreadsheets have no way to import it. They enter records one by one.

**Solution:** A CSV/Excel import flow with AI-assisted column mapping.

1. User uploads a file to `/import`.
2. Claude reads the column headers and maps them to FundExecs OS fields (e.g., "Company" → `deal.name`, "Check Size" → `deal.amount`).
3. A mapping review table shows each column → field mapping with confidence indicator. User can correct any mapping.
4. Preview of first 5 rows before confirming import.
5. On confirm, records are created in bulk with `source: 'import'` tag.

**Technical Implementation:**

- New route `app/(app)/import/page.tsx` with `ImportWizard` component.
- `/api/import/map` endpoint: accepts CSV headers, returns AI-generated field mapping via `lib/claude.ts`.
- `/api/import/execute` endpoint: bulk-inserts mapped records using existing Supabase client.
- Import supports: deals, investors, assets, contacts.
- Import history stored in `import_logs` table for audit trail.

**Files:** `app/(app)/import/` (new) · `/api/import/` (new) · `lib/claude.ts` · `supabase/migrations/`

---

## Cross-Cutting UX Principles

### Speed Standards (Linear-inspired)

| Interaction | Target Latency |
|-------------|---------------|
| Page navigation | < 100ms (prefetch on hover) |
| Command Palette open | < 50ms |
| Form field focus | Instant (no async) |
| AI field suggestion | < 2s (with skeleton loader) |
| Agent step start feedback | < 500ms (optimistic UI) |
| Copilot Card render | < 200ms after step completes |

**Implementation:** Next.js `prefetch` on all internal links. Optimistic UI for all record mutations (update local state before Supabase confirms). Skeleton loaders replace spinners everywhere.

---

### Coaching Layer (Superhuman-inspired)

The system teaches features at the moment they become relevant — not in a separate tour.

| Trigger | Coaching Moment |
|---------|----------------|
| User types their 5th prompt | "Tip: Press ⌘K to access any action without typing" |
| User navigates to Automations for first time | "Tip: Describe a workflow in plain English and I'll build it" |
| User spends > 30s on an empty form field | "Tip: Click the wand icon to let AI fill this from your documents" |
| User completes their first task | "Tip: Pin this deal with ⌘⇧P to find it instantly later" |

Coaching moments:
- Appear as a subtle toast (bottom-left, 4s duration, dismissable).
- Each moment fires at most once per user (tracked in `coaching_events` table).
- Never interrupt an active workflow — queue until the user is idle.

**Technical Implementation:**

- `lib/coaching.ts` (new): defines coaching rules `{ id, trigger, message, shortcut? }`. Evaluates trigger conditions against current app state.
- `components/shared/CoachingToast.tsx` (new): renders the toast with dismiss + "Don't show again" options.
- `coaching_events` table: `(principal_id, coaching_id, shown_at)` — prevents repeat.

**Files:** `lib/coaching.ts` (new) · `components/shared/CoachingToast.tsx` (new) · `supabase/migrations/`

---

### Mobile & Responsive Behavior

All UX patterns above must degrade gracefully on mobile (operators reviewing deals on-the-go):

| Desktop Pattern | Mobile Adaptation |
|-----------------|------------------|
| Side-panel (UX-09) | Full-screen sheet with swipe-to-dismiss |
| Command Palette (UX-08) | Tap the search bar in the top nav |
| Recents Strip (UX-10) | Horizontal scroll strip |
| Copilot Card (UX-04) | Full-width card, actions stack vertically |
| Context Bar (UX-11) | Collapsed to entity name + ⋯ menu |

---

## Implementation Sequence

### Sprint 1 — Immediate Impact (Week 1–2)
These changes require minimal new infrastructure and have the highest UX return:

| Task | Feature | Est. Effort |
|------|---------|------------|
| `CopilotCard` structured output component | UX-04 | M |
| Contextual empty states across all hubs | UX-02 | S |
| Inline validation + context messages | UX-14 | S |
| Command Palette global keyboard shortcut | UX-08 | S |
| Confidence indicators on Copilot outputs | UX-06 | S |

### Sprint 2 — Onboarding & Discovery (Week 3–5)

| Task | Feature | Est. Effort |
|------|---------|------------|
| First Mission onboarding flow (3 role variants) | UX-01 | L |
| Slide-over side panel + entity registry | UX-09 | L |
| Recents strip + user pins | UX-10 | M |
| Progressive form disclosure | UX-13 | M |
| Coaching toast system | Cross-cutting | M |

### Sprint 3 — Power Features (Week 6–8)

| Task | Feature | Est. Effort |
|------|---------|------------|
| AI-assisted field completion (wand) | UX-12 | L |
| Mid-run clarification prompts | UX-07 | M |
| One-click inline edits from Copilot | UX-05 | M |
| Hub context bar + breadcrumbs | UX-11 | M |
| CSV bulk import with AI mapping | UX-15 | L |
| Session resume banner | UX-03 | S |

**Effort scale:** S = 1–2 days · M = 3–5 days · L = 1–2 weeks

---

## Success Metrics

| Metric | Current Baseline | Target (90 days) |
|--------|-----------------|-----------------|
| Time to first artifact (new user) | Unknown | ≤ 5 minutes |
| Onboarding completion rate | Unknown | ≥ 70% |
| Command Palette usage (% of sessions) | Unknown | ≥ 40% |
| AI field fill acceptance rate | N/A | ≥ 60% |
| Copilot output action rate (clicks on card actions) | Unknown | ≥ 50% |
| Form completion rate (no abandonment) | Unknown | ≥ 80% |

All metrics tracked via the existing `activity` + `gamification` infrastructure. Add a `ux_events` table for granular interaction tracking (palette opens, card action clicks, wand uses, coaching dismissals).

---

*This spec is additive to `PLATFORM_FEATURE_OPTIMIZATION_BLUEPRINT.md`. Features UX-01 through UX-15 build on Blueprint Features F07–F14 and the existing hub/session/copilot component tree. No breaking changes to the task engine or agent catalog are required.*
