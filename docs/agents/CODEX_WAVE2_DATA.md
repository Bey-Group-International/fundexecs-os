# Codex — Match Inbox + Capital Stack data models

> Paste to Codex. Read `docs/PRIVATE_MARKET_LIFECYCLE.md` first. Backend/data
> lane only. These two models can be built now (ahead of their Wave-2 UI).

## Hard rules

- Branch `codex/match-inbox-capital-stack`. Draft PR. CI green.
- **Additive + idempotent** migrations (`create table if not exists`, guarded
  policies via `do $$ ... if not exists`). RLS on every table, org-scoped:
  members SELECT via `private.is_org_member(org_id)`; privileged writes via
  `service_role` (mirror the `diligence_*` tables already on `main`). No edits to
  existing tables' columns. Secrets server-side. Don't touch auth/UI/design.
- After applying to project `emityvdaeiqxtpxdhyky`, run `get_advisors`
  (security+performance) — no new ERROR/WARN — and document the contract + the
  regenerated `database.types.ts` diff in the PR for Claude.

## 1. Capital Stack

The live capital structure of the raise (drives Dashboard raise progress).

- `public.capital_commitments` — `id`, `org_id`, `lp_id` (fk to the existing
  LP/contact/capital_providers entity — confirm the right table), `amount numeric`,
  `currency text default 'USD'`, `stage text` check
  (`target|soft_circle|committed|closed|withdrawn`), `tranche text null`,
  `lp_type text null` (e.g. family_office|institutional|individual|gp),
  `expected_close date null`, `notes text null`, timestamps, `set_updated_at`
  trigger. Indexes on `(org_id, stage)`, `(org_id, lp_id)`.
- A read helper/view `capital_stack_summary(org_id)` (or RPC) rolling up totals
  by stage + by lp_type, plus gap-to-target (target from the fund profile / a
  `fund_target` you expose). Claude will surface it on the Dashboard + Capital
  Stack UI.

## 2. Match Inbox

Daily triage of scored LP↔fund and deal↔mandate matches.

- `public.matches` — `id`, `org_id`, `kind text` check (`lp|deal`),
  `subject_id uuid` (the LP or deal), `score int` check (0–100),
  `rationale jsonb default '[]'` (scored factors: thesis_fit, check_size,
  geography, mandate, warmth), `status text` check
  (`new|accepted|dismissed|snoozed`) default `new`, `created_at`,
  `acted_at timestamptz null`. Indexes on `(org_id, status, score desc)`.
- RPC `act_on_match(_match_id uuid, _action text)` (service_role): set status +
  `acted_at`; on `accepted` for `kind='lp'`, create/return the pipeline entry
  (coordinate the pipeline insert shape with Claude). Pin `search_path`; revoke
  from anon/authenticated.

## Contract to hand Claude (in the PR)

Exact columns, the summary view/RPC signatures, the `matches` shape, and the
`act_on_match` behavior — so Claude can build `lib/queries/capital-stack.ts`,
`lib/queries/match-inbox.ts`, and the accept→pipeline wiring. Then STOP for
review.
