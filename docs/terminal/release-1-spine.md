# Terminal Release 1 — Spine (contracts + persistence)

**Status:** Landed, additive, **default-OFF** (`TERMINAL_ENABLED`). The first slice
of the Private Markets Intelligence Terminal: the pure, tested **contracts** and the
**persistence foundation** the multi-pane shell and command bar will build on. No UI
is wired yet — this is the spine, shipped and proven before the surface.

Per the implementation plan (`docs/implementation/TERMINAL_IMPLEMENTATION_PLAN.md`),
Release 1 is Foundation: shell + command registry + action contract. This increment
delivers the **command registry + unified action contract + terminal tables**; the
React shell + command bar UI are the next increments.

---

## What landed

### 1. Unified action & safety contract — `lib/terminal/action-contract.ts`
The terminal does **not** fork the gate model. It projects the spec's **ten
side-effect levels** onto the existing **three gate tiers** (`lib/gates.ts`) so that
commands, agents, API keys, and extensions all resolve authorization through the
same primitive:

| Levels | Tier | Approval |
|---|---|---|
| read-only, local-draft, internal-write, capital-analysis | 1 | none (immediate) |
| external-communication, external-data-write, compliance-sensitive, destructive | 2 | operator (unless a mandate pre-authorizes) |
| **capital-binding, transaction-execution** | **3** | **human, non-delegable — always** |

The Tier-3 invariant is **re-asserted in code** (`classifySideEffect`): no table
edit, mandate, or extension manifest can lower a capital-binding action below
non-delegable human approval — for any actor. Pure + fully tested.

### 2. Command language — `lib/terminal/types.ts`, `commands/registry.ts`, `parse.ts`
- A typed `CommandDefinition` (verb, aliases, args, required scopes, agent owner,
  side-effect level, dry-run) — mirrors `SkillManifest`.
- An initial **command catalog** (~40 commands) across navigation (`DEAL`, `FUND`,
  `LP`, `PIPE`, `WATCH`, …), analysis (`LBO`, `VAL`, `WATERFALL`, `CAPTABLE`,
  `EXPOSURE`, …), and workflow (`SOURCE`, `OUTREACH`, `CAPCALL`, `REPORT`,
  `ASK EARN`, …). Each declares its side-effect level, so `CAPCALL`/`DISTRIBUTE`
  are capital-binding → Tier-3, navigation is read-only, drafts are Tier-1.
- A pure **parser** with longest-verb-prefix matching (so `ASK EARN …` and
  `CREATE DEAL …` resolve correctly), case-insensitive verbs/aliases, entity-casing
  preserved, and a null return for non-commands (the "ask earn" NL fallback).

### 3. Persistence — migration `20260718200000_terminal_core.sql`
Four org-scoped tables, member-read / writer-write RLS, `updated_at` triggers,
idempotent:
- `terminal_workspaces` — named workspace presets per user/org (shared or private).
- `terminal_layouts` — the serialized pane tree (jsonb, versioned).
- `saved_commands` — a user's saved + recent commands.
- `command_runs` — an **append-only** command-execution ledger (verb, resolved
  side-effect level + gate tier, dry-run, status) — the terminal's observability
  spine, mirroring `skill_runs` / `inference_runs`.

### 4. Flag — `lib/terminal/config.ts`
`TERMINAL_ENABLED` (default off). Nothing in the terminal path runs for a user until
it is on.

## Guarantees

- **Reuse, don't fork.** The action contract wraps `lib/gates.ts`; the command
  registry mirrors the skills registry pattern; scopes extend the API-scope
  vocabulary. No parallel authorization model is introduced.
- **Capital-binding stays human.** Enforced structurally, tested directly.
- **Additive + default-off.** The migration is additive; with the flag off the
  existing app is byte-for-byte unchanged.

## Verification

18 new tests (action contract, parser, registry consistency); full suite
**3696 green**, typecheck + eslint clean. Additive migration validated by the
`migrations-unique` test.

## Next increments (Release 1 continued)

- The `TerminalShell` React pane manager (resize/dock/tabs/float/save) + `/terminal`
  route + layout persistence + deep-link.
- The command bar (extend `CommandPalette`) that parses → previews the plan →
  dispatches through the action contract, writing `command_runs`.
- Pane adapters over the existing war rooms / capital-map / portfolio / Copilot.
