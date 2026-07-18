# Terminal Release 1 — Shell (multi-pane workspace + command bar)

**Status:** Landed, additive, **default-OFF** (`TERMINAL_ENABLED`). The surface on
top of the [spine](./release-1-spine.md): the configurable multi-pane workspace
(System 1) and the command bar that parses → previews → dispatches through the
unified action contract (System 2 + System 9), writing `command_runs`. With the
flag off the `/terminal` route redirects home and nothing here runs.

Per `docs/implementation/TERMINAL_IMPLEMENTATION_PLAN.md`, Release 1 is Foundation:
shell + command registry + action contract. The spine delivered the tested
contracts + tables; this increment delivers the **shell + command surface** that
sits on them.

---

## What landed

### 1. Pane-tree model — `lib/terminal/layout.ts` (pure, tested)
A binary-ish tree: `SplitPane` nodes divide space (row/column) among children with
fractional sizes; `LeafPane` nodes are the visible panes (pane type + bound entity
+ the command that opened them). Every operation — `openPane`, `splitPane`,
`closePane`, `updateLeaf`, `resizeSplit`, `focusPane` — is a **pure
`(layout, …) → layout`** transform, so the React shell is a thin reducer over it
and the whole thing is validated without a DOM.

Load-bearing details, all tested:
- **Close collapses** a single-child split back to the leaf; closing the last pane
  yields an empty layout; focus follows sensibly.
- **Resize honors a floor** (`MIN_PANE_FRACTION`) *even after renormalization* —
  `clampSizes` lifts panes below the floor and borrows proportionally from panes
  with room, so a pane can never be dragged to zero (and lost).
- **Serialization is version-guarded + total.** `deserializeLayout` tolerates
  anything — null, garbage, wrong shapes, unknown pane types (→ `blank`), a
  dangling focus id (→ repaired), a persisted single-child split (→ collapsed),
  and any `layout_version` it doesn't recognize (→ empty). A stored layout can
  never crash the shell.
- **Presets** (`defaultLayoutForPreset`) seed deterministic starting arrangements
  for deal underwriting, fundraising, IR, portfolio monitoring, market
  intelligence, and an executive brief.

### 2. Command → plan resolver — `lib/terminal/dispatch.ts` (pure, tested)
`planCommand(raw)` turns command-bar text into a `CommandPlan`: which pane it
opens, how it is authorized (via `classifySideEffect`), a human-readable summary,
and the approval/non-delegable flags. Both the client bar and the server action
consume the **same** decision, so the preview shown and the run recorded can never
disagree. Navigation → read-only pane (Tier 1); analysis → analysis workspace
(Tier 1 compute); gated workflows preview and require approval, with
**capital-binding staying Tier-3 human-non-delegable**.

### 3. Persistence — `lib/terminal/store.ts` (server-only, best-effort)
- `logCommandRun` appends to `command_runs` — the audit/observability spine
  (mirrors `persistInferenceRun` / `persistSkillRun`).
- `loadTerminalWorkspace` / `saveTerminalLayout` round-trip the principal's
  default workspace + layout through `terminal_workspaces` / `terminal_layouts`.

All reached through the user-cookie client, so RLS (member-read / writer-write)
enforces tenancy — the store never widens access. Newer than the last generated
DB types, so (like `lib/inference/store.ts`) reached via a narrow unknown-cast.
Every path is best-effort: on failure it returns null and never throws.

### 4. Route + actions — `app/(app)/terminal/`
- `page.tsx` — flag-guarded (redirects `/home` when off), authed, seeds a preset
  or loads the saved layout, renders the shell.
- `actions.ts` — `recordCommandRun` and `persistLayout`. **Authorization is
  re-derived server-side** from the raw command text; the client's claimed tier is
  never trusted, and a command that requires approval is clamped to
  `pending_approval` — the terminal never records a gated action as executed.

### 5. UI — `components/terminal/`
- `TerminalShell` — reducer over the pane tree; resizable splits with draggable
  dividers; debounced layout persistence.
- `CommandBar` — live plan preview (tier chip + summary) as you type; Enter
  dispatches; a gated command is previewed and routed to approval, never run
  inline.
- `PaneView` — a pane renders its binding + a deep link into the corresponding
  full FundExecs surface. Panes never invent data: the analysis pane explicitly
  states the live model wires in later, and no financial values are shown.

## What this release does — and does not — do

- **Executes:** read-only navigation, and opening analysis / Copilot workspaces.
- **Records as intent (not executed):** every workflow command (writes, capital
  events, outreach) is logged to `command_runs` as `pending_approval`, awaiting
  execution wiring + (for gated actions) human approval. Nothing is fabricated or
  bound-executed. Capital-binding is structurally Tier-3, non-delegable.

## Guarantees

- **Reuse, don't fork.** Authorization flows through the action contract →
  `lib/gates.ts`; persistence uses the canonical RLS helpers; the command surface
  extends the existing palette idiom.
- **Additive + default-off.** No nav entry, route redirects when the flag is off;
  the existing app is unchanged.
- **Never fabricates.** Panes orient and hand off; they do not display invented
  metrics or financial values.

## Verification

New unit tests for the pane-tree model and the dispatcher; full suite green,
typecheck + eslint clean, production build passes.

## Next increments

- Pane adapters that render the live surfaces in-pane (war room, capital map,
  portfolio cockpit, Copilot) rather than deep-linking out.
- Execution wiring: route Tier-1 workflow commands to the engine, and Tier-2/3
  commands into the existing approval queue.
- Workspace presets surfaced in the UI (open/save/share named workspaces).
