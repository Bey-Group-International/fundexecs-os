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

### 1. Diligence data model (migration)

Create `supabase/migrations/<ts>_diligence_intelligence_layer.sql`:

- `public.diligence_runs` — `id uuid pk`, `org_id uuid`, `deal_id uuid null`
  (fk `deals`), `created_by uuid`, `status text` (`queued|running|complete|error`),
  `conviction int null` (0–100), `summary text null`, `created_at`, `updated_at`.
- `public.diligence_documents` — `id`, `run_id fk`, `org_id`, `storage_path text`,
  `file_name`, `mime_type`, `kind text` (`deck|cim|ppm|ddq|financials|notes|other`),
  `created_at`.
- `public.diligence_findings` — `id`, `run_id fk`, `org_id`,
  `agent text` (`market_size|competitive|customer_demand|unit_economics|stress_test|red_flags|synthesis`),
  `score int null` (0–100), `summary text`, `detail text null`,
  `citations jsonb default '[]'`, `created_at`.
- `public.diligence_chunks` — `id`, `document_id fk`, `org_id`, `content text`,
  `embedding vector(1024)`, `created_at` (Voyage 1024 dims, match existing).
- RLS: org members SELECT; INSERT/UPDATE restricted to `service_role`.

### 2. Storage bucket

Private Supabase Storage bucket `diligence` + policies (org-scoped read, service
write). Document the path convention `diligence/{org_id}/{run_id}/{file}`.

### 3. Ingest + retrieval RPCs (`SECURITY DEFINER`, `service_role`-execute only)

- `store_diligence_chunks(...)` — bulk insert chunks+embeddings for a document.
- `match_diligence_chunks(run_id uuid, query_embedding vector, match_count int)`
  — cosine-similarity retrieval scoped to the run/org (mirror
  `match_knowledge_chunks`).
- Pin `search_path`; `revoke execute` from `anon`/`authenticated`.

### 4. Scoring helpers (optional, if cleaner in SQL)

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
