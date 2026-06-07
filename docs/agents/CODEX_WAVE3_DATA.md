# Codex — Next data tasks (wallet-on-signup · Match Inbox · Capital Stack)

> Paste to Codex. Backend/data lane. Read `docs/PRIVATE_MARKET_LIFECYCLE.md` +
> `docs/agents/CODEX_WAVE2_DATA.md` first. Three tasks that make the now-live
> wallet / Match Inbox / Capital Stack tables actually populated and correct.

## Hard rules

- Branch `codex/wave3-data`. One additive, idempotent migration
  (`create … if not exists`, guarded `do $$ … if not exists`). RLS on anything
  new; mirror the `diligence_*` / wave2 patterns already on `main`. No edits to
  existing columns; no auth/UI/design changes. Keep the 15 brain slugs stable.
- **You can't apply migrations here** (connector is read-only for you, as before).
  Write the migration file + open a **draft PR**. **Claude applies it** to
  `emityvdaeiqxtpxdhyky`, runs `get_advisors`, regenerates
  `lib/supabase/database.types.ts`, and merges. Document the exact
  contracts/signatures in the PR body for Claude.

## Task 1 — Credit wallet on org signup (fixes a live gap)

The starter-credit seed was one-time, so **orgs created after it have no wallet**,
and `consume_credits` then can't charge them (diligence currently proceeds
uncharged for those orgs — see PR #86).

- Add an `AFTER INSERT` trigger on `public.organizations` that inserts a
  `credit_wallets` row `(org_id, 500, 'standard')` `on conflict (org_id) do nothing`,
  and writes the matching `credit_transactions` grant row (`reason='signup_grant'`,
  `delta=500`, `balance_after=500`). Use a `SECURITY DEFINER` trigger fn with
  pinned `search_path`. Idempotent + safe to re-run.
- Confirm it composes with the existing `handle_new_user` flow (org auto-created
  on signup) so a brand-new user's org lands with 500 credits.

## Task 2 — Match Inbox population + scoring

`public.matches` exists but is empty. Add a **deterministic, heuristic** scorer
(SQL/ plpgsql — no AI; Claude can AI-rerank later) that generates LP↔fund matches:

- Function `generate_lp_matches(_org_id uuid)` (`SECURITY DEFINER`, service_role):
  for each `capital_providers` row in the org not already matched, compute a
  0–100 `score` from available signals and insert a `matches` row
  (`kind='lp'`, `subject_id`=capital_provider id, `status='new'`) with a
  `rationale` jsonb array of `{ factor, weight, detail }` for the factors you can
  derive (thesis_fit, check_size, geography, mandate, warmth). Skip duplicates
  (`matches_subject_idx`). Document the scoring formula in the PR.
- Keep it heuristic and explainable. Deal↔mandate matches can be a follow-up.

## Task 3 — Capital Stack backfill from allocations

`capital_commitments` is empty but `allocations` holds real raise data. Add an
**idempotent backfill** that maps existing `allocations` → `capital_commitments`
so the dashboard's `capital_stack_summary` seam (already wired by Claude) shows
real numbers:

- Map allocation `status` → commitment `stage`
  (committed/funded/accepted/closed → `committed`/`closed`; soft/interested/pending
  → `soft_circle`; else `target`). Carry `amount`, `lp_id` (if the allocation
  references a capital provider), `currency`.
- Idempotent: don't double-insert (guard on a stable key, e.g. a deterministic
  source mapping or `on conflict`). Document the mapping in the PR.

## Deliverable

Draft PR `codex/wave3-data` with one migration + a PR body documenting: the
trigger, `generate_lp_matches` signature + scoring formula, and the allocation→
commitment mapping. Then STOP — Claude applies, advisor-checks, regenerates
types, and merges.
