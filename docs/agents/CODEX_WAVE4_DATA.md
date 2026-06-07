# Codex — Wave 4 (backend/data): light up the new module UIs

**Context.** The `release_data` sweep is applied to the live DB (objections,
`credit_purchases` + `record_credit_topup`, `generate_lp_matches`, capital-stack
backfill, SECURITY DEFINER hardening) and `database.types.ts` is regenerated.
The Manus module UIs were salvaged onto `main` via #93: `/capital-stack`,
`/audit`, `/partners`, `/match-inbox`, and the Stripe top-up wallet popover.
They currently render against **typed loaders with empty-state fallback** and
**placeholder server actions**. Wave 4 is the backend/data that makes those
surfaces real.

## Lane & guardrails (unchanged)

- **Backend/data only.** No UI, no `lib/supabase/*` client, no `proxy.ts`,
  middleware, `app/login/*`, `lib/queries/auth`, `lib/ai/*`. You write
  migrations + RPCs; **Claude applies** them (connector permission), runs
  advisors, regenerates types, merges.
- Migrations **additive + idempotent**. New `SECURITY DEFINER` functions pin
  `set search_path = ''` and schema-qualify everything. Mirror the existing
  member-read / service-role-write RLS pattern (`private.is_org_member(org_id)`).
- Branch off latest `main`, **draft PR**, stop for Claude review. Don't apply.
- Keep the 15 brain slugs stable. Don't touch generated `database.types.ts`.

## Tasks (priority order)

### 1. Capital Stack read path — confirm/extend `capital_stack_summary`

The Capital Stack UI (`lib/queries/capital-stack.ts`) expects an org-scoped
summary: **stage breakdown**, **lp_type breakdown**, **target raise**,
**gap-to-target**, and a **commitments** list. Confirm the existing
`capital_stack_summary` RPC returns this shape; extend it to include the
backfilled `capital_commitments` rows (`lp_type = 'allocation_backfill'`). If
the RPC doesn't exist, create it (SECURITY DEFINER, member-gated). Document the
exact return shape so the loader can be tightened off placeholder fallback.

### 2. `act_on_match(_match_id uuid, _action text)` RPC

Atomic, guarded match triage so the UI's `act_on_match` server action is a thin
wrapper. Validate org membership + current status; allow transitions
`new → accepted` and `new → dismissed`; set actioned timestamp/actor. On
`accepted`, optionally seed the downstream side-effect (pipeline entry or
synergy link — propose the cleanest mapping in the PR). `authenticated` execute,
membership-checked internally. Return the updated row.

### 3. `get_audit_trail(_org_id uuid, _limit int)` RPC

One RLS-safe call that merges `trust_events` + `admin_actions` +
`diligence_findings` into a unified, time-ordered feed (the audit loader does
three separate client reads today). Member-gated; stable column contract
(`occurred_at, source, actor, title, detail, score`). This both simplifies the
loader and guarantees consistent authorization.

### 4. Objections write path

The `objections` table landed but has no RPCs. Add `upsert_objection(...)` and
`resolve_objection(_id uuid)` (member-gated, org-scoped, `updated_at` touched)
so the Objections module gets a clean write path under RLS.

### 5. `generate_deal_matches(_org_id uuid)` — the deferred scorer

`generate_lp_matches` explicitly left deal-to-mandate matches for a follow-up.
Add the symmetric deterministic scorer that inserts `matches(kind = 'deal')`
rows (deal ↔ capital-provider mandate), same rationale-array shape, service-role
only. This fills the other half of Match Inbox.

### 6. Performance advisor pass

Run the performance advisors mentally against the new tables and add any missing
FK/lookup indexes (e.g. `matches(org_id, status)`, objections/capital-stack
hot paths). Flag — don't fix — anything that needs an app-code change.

### 7. Beta demo seed (optional, if credits remain)

Extend the demo seed so a fresh demo org renders **populated** capital stack,
match inbox, partners, and audit surfaces (a handful of `capital_providers`,
`service_providers`, `allocations`, and a `generate_lp_matches` call). Keep it
clearly demo-flagged; never seed real orgs.

## Employ agents

This is parallelizable — **spin up sub-agents** where it speeds you up: one per
independent RPC/migration concern (capital-stack read, match actions, audit
feed, objections, deal scorer) drafting against the same `main`, then
reconcile into **one additive migration file** per the lane convention. Keep the
final PR a single reviewable migration + a short contracts section (function
signatures, return shapes, RLS) so Claude can apply and wire the UI loaders
off their placeholder fallbacks quickly.

## Validation before PR

`npm run typecheck && npm run lint && npm run build` green. `format:check` has a
pre-existing backlog on unrelated files — your migration `.sql` won't be flagged;
do not reformat unrelated files. List in the PR: every new function signature,
its return shape, its grants, and the RLS policies on any new object.
