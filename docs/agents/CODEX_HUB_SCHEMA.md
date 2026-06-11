# Codex Brief — Hub-Interior Data Model (Build / Source / Run / Execute)

**Lane (per `FUNDEXECS_BUILD_PLAN.md` §2):** backend/data — migrations, RLS,
scoring functions. **No UI, no `app/` or `components/` edits.**
**Branch prefix:** `codex/*` · squash-merge after CI green · Claude reviews
every migration before merge.

## Context

The fresh-start frontend now has the onboarding spine (landing → invite
sign-in → Mandate Brief → activation → cockpit) and the lifecycle shell with
four hub landings (`/build` `/source` `/run` `/execute`). The hub _interiors_
ship next, one PR at a time, ported from the simplified prototype
(`Onboarding_Flow_Simplification` — see `FundExecs OS - Handoff.md` §2–5).
Each interior needs its tables in place first. That's this brief.

## Ground rules (non-negotiable)

- **Additive + idempotent** migrations only (`create table if not exists`,
  `alter … add column if not exists`); never rewrite or drop shipped tables.
- **RLS on every table**: org-scoped — members of `org_id` read; writes via
  `service_role` (the orchestrator) or member-scoped insert where noted.
  Follow the patterns in `supabase/migrations/20260610190000_mandates.sql`.
- **Naming/timestamps:** `id uuid primary key default gen_random_uuid()`,
  `org_id uuid not null references organizations(id)`, `created_at/updated_at
timestamptz not null default now()`.
- After each migration: regenerate `lib/supabase/database.types.ts`
  (`supabase gen types typescript`) so the app's types stay in sync.
- Keep the 15 brain slugs stable; secrets server-side.

## Wave 1 — BUILD interior (first UI PR needs these)

| Table               | Columns (beyond the standard set)                                                                                                                                                                                         | Notes                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `fund_formations`   | `status text not null default 'in_progress'`, `story jsonb`                                                                                                                                                               | one per org                   |
| `formation_steps`   | `formation_id uuid not null references fund_formations(id)`, `kind text not null` (entity/lpa/ppm/subdocs/regd/bank), `seq int not null`, `status text not null default 'todo'` (todo/drafting/ready/filed), `data jsonb` | unique `(formation_id, kind)` |
| `governance_bodies` | `kind text not null` (ic/lpac/advisory/fund_mgmt/capital_partners/legal_counsel), `members jsonb not null default '[]'`                                                                                                   | unique `(org_id, kind)`       |
| `policies`          | `name text not null`, `kind text not null`, `status text not null default 'todo'` (todo/drafting/active), `body jsonb`                                                                                                    | governance policies           |

## Wave 2 — data room + EXECUTE interior

| Table             | Columns                                                                                                                                                           | Notes                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `data_room_links` | `document_id uuid` (existing `documents`), `token text not null unique`, `vetting text not null default 'nda'` (open/accreditation/nda), `expires_at timestamptz` | per-doc vetted links                     |
| `data_room_views` | `link_id uuid not null references data_room_links(id)`, `viewer text not null`, `verified_at timestamptz`                                                         | log every view                           |
| `closings`        | `kind text not null` (lp_commitment/deal/engagement), `counterparty text`, `amount numeric`, `status text not null default 'open'`                                | Commitment-to-Close                      |
| `closing_steps`   | `closing_id uuid not null references closings(id)`, `seq int not null`, `name text not null`, `status text not null default 'pending'`                            | strict step gating in UI                 |
| `capital_calls`   | `pct numeric`, `total numeric`, `due_at timestamptz`, `status text not null default 'draft'`                                                                      | **illustrative until counsel signs off** |
| `call_lp_status`  | `call_id uuid not null references capital_calls(id)`, `lp_ref text not null`, `status text not null default 'notified'`                                           |                                          |

## Wave 3 — RUN interior

| Table              | Columns                                                                                                                                      | Notes               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `workflows`        | `stream text not null`, `name text not null`                                                                                                 | kanban streams      |
| `workflow_tasks`   | `workflow_id uuid not null references workflows(id)`, `status text not null default 'todo'`, `subtasks jsonb not null default '[]'`          |                     |
| `automations`      | `trigger text not null` (column name `trigger` quoted or use `on_event`), `enabled boolean not null default true`, `last_run_at timestamptz` | prefer `on_event`   |
| `compliance_items` | `category text not null`, `severity text not null`, `status text not null default 'open'`                                                    | counsel in the loop |
| `ir_items`         | `cat text not null`, `status text not null default 'todo'`, `due_at timestamptz`                                                             | LP deliverables     |

Diligence tables (`diligence_runs/_documents/_findings`) already exist — do
not recreate; extend only if a column is missing for the 7-agent verdict UI.

## Deliverables per wave

1. One migration file per wave under `supabase/migrations/` (timestamped,
   idempotent), with RLS policies and helpful indexes (`org_id`, FKs).
2. Regenerated `database.types.ts`.
3. A short note in the PR: tables, policies, and any deviation from this brief.

Claude reviews + merges; UI wiring lands in the Claude hub-interior PRs.
