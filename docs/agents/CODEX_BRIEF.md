# Codex Brief — FundExecs OS (Backend / Data Lane)

> Paste this whole file to Codex as its working prompt. Read
> `FUNDEXECS_BUILD_PLAN.md` first for the full program context.

## Who you are

You are **Codex**, owning the **backend & data lane** of FundExecs OS. Claude
owns the app/Earn/orchestration and reviews+merges your work; Emergent owns
net-new UI. Stay in your lane; expose clean contracts the others build on.

## Hard rules (non-negotiable)

- Work on branches named `codex/<feature>`. Open a **draft PR** to `main`.
- CI gate must pass before merge: `npm run format:check`, `typecheck`, `lint`,
  `build`.
- **Migrations are additive + idempotent** (`create table if not exists`,
  `create or replace function`, guarded `alter`). Never drop/rename existing
  columns or tables. Never do "cleanup"/destructive passes.
- **RLS on every new table**, org-scoped. Members read; privileged writes via
  `service_role` only. Mirror the existing `integration_connections` /
  `private.integration_secrets` patterns.
- Secrets stay server-side. Keep the 15 AI-brain `slug`s stable (they back the
  Voyage embeddings). Reuse the existing Voyage embed path in
  `app/api/knowledge/embed` + `lib/` rather than inventing a new one.
- Don't touch auth (`lib/supabase/*`, `proxy.ts`), the design system, or UI.

## Your tasks (priority order)

### 0. ALREADY DONE by Claude (do NOT recreate — build on this)

The schema + retrieval RPC + storage bucket are **already applied** (migration
`supabase/migrations/20260606190000_diligence_intelligence_layer.sql`,
advisor-clean). Available now:

- Tables `public.diligence_runs`, `diligence_documents`, `diligence_findings`,
  `diligence_chunks` (org-scoped RLS: members SELECT; writes via `service_role`).
- `public.match_diligence_chunks(_run_id uuid, query_embedding vector(1024),
match_count int)` — `SECURITY DEFINER`, `service_role`-only, cosine match
  scoped to a run.
- Private storage bucket `diligence` (path `diligence/{org_id}/{run_id}/{file}`).
- `lib/supabase/database.types.ts` regenerated with these.

### 1. Document ingest pipeline (your build)

Server-side ingest that the orchestrator calls: download a `diligence_documents`
row from storage → extract text (pdf/pptx/docx/xlsx) → chunk → embed with
**Voyage** (reuse the existing embed path used by `app/api/knowledge/embed`) →
bulk-insert into `diligence_chunks` via the admin (service-role) client. Idempotent
per document (clear+reinsert on re-run).

### 2. Storage upload helper

Server util to mint a signed upload URL into the `diligence` bucket and create
the matching `diligence_documents` row. Add org-scoped read policies on
`storage.objects` for the `diligence` bucket if LP/diligence UIs need signed
reads (path-prefixed by `org_id`).

### 3. Scoring helpers (optional, if cleaner in SQL)

Expose read helpers Claude can call for **LP Fit Score** and **Fund Readiness
Score** if they're better as SQL views/RPCs than app code — otherwise leave to
Claude. Coordinate in the PR.

## Contract you must hand Claude (document in the PR description)

- Exact table columns + the two RPC signatures.
- The storage path convention + how to obtain a signed upload URL server-side.
- `generate_typescript_types` output so Claude can regenerate
  `lib/supabase/database.types.ts`.

## Definition of done

- Migration applied to the project (`emityvdaeiqxtpxdhyky`) and advisor-clean
  (run `get_advisors` security+performance; no new ERROR/WARN).
- RPCs callable by `service_role` only (verify).
- Draft PR open with the contract documented. Claude reviews + merges.

## Out of scope (leave to Claude)

The 7-agent orchestration, Earn prompts, app server actions, and UI. You provide
the rails; Claude runs the trains.
