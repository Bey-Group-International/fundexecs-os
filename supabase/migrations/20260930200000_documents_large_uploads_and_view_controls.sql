-- Documents & Data Room: large uploads, per-link view controls, and the text
-- layer Earn reads.
--
-- 1. The `documents` bucket ceiling goes from 100 MB to 500 MB. Uploads are now
--    resumable (TUS, 6 MB chunks), so a PPM with embedded exhibits or a recorded
--    walkthrough (.mp4 / .mov) no longer has to arrive in one request. NOTE: a
--    bucket limit can never exceed the project's global Storage upload limit
--    (Dashboard → Storage → Settings). On Pro that limit is configurable; raise
--    it to at least 500 MB or files between the two will be refused.
--
-- 2. Per-link controls on `data_room_shares` (plus `document_id`, which scopes
--    a link to one document — the "share preview" from the review page):
--      allow_download — false makes the link view-only. Files render inside the
--                       viewer and the download route refuses. (A determined
--                       reader can still screenshot; this is a deterrent and a
--                       clear signal of intent, not DRM.)
--      watermark      — stamp the reader's email and a timestamp across every
--                       page of a PDF as it is served.
--
-- 3. `document_reviews`: Earn's review of an uploaded file — recommendations
--    and a suggested section — keyed to the exact object it read, so a new
--    version gets a fresh review rather than inheriting a stale one.
--
-- 4. `document_texts`: plain text pulled out of an uploaded PDF / Word / Excel /
--    PowerPoint file, keyed to the exact object it was read from. This is what
--    lets Earn read, cite, and file uploads, and what the in-app preview renders
--    for Office formats. Kept out of `documents` so `select *` on the library
--    never drags megabytes of text along with it.

-- ---------------------------------------------------------------------------
-- 1. Bucket ceiling
-- ---------------------------------------------------------------------------
update storage.buckets
   set file_size_limit = 524288000
 where id = 'documents';

-- ---------------------------------------------------------------------------
-- 2. Per-link view controls
-- ---------------------------------------------------------------------------
alter table public.data_room_shares
  add column if not exists allow_download boolean not null default true,
  add column if not exists watermark boolean not null default false,
  -- A single-document link: opens only this document in the viewer. Null is a
  -- room link, as before. Deleting the document kills the link with it.
  add column if not exists document_id uuid references public.documents(id) on delete cascade;

create index if not exists data_room_shares_document_idx
  on public.data_room_shares (document_id) where document_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Extracted text
-- ---------------------------------------------------------------------------
create table if not exists public.document_texts (
  document_id uuid primary key references public.documents(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- The object the text was read from. A replaced file has a new key, so a
  -- mismatch here is how stale text is detected without a trigger.
  storage_key text not null,
  -- 'ok' | 'empty' (a scanned PDF with no text layer) | 'unsupported' | 'failed'
  status text not null default 'ok',
  text text not null default '',
  -- Structured preview for Office formats (sheets → rows, slides → bullets),
  -- rendered by the in-app viewer. Null when the format previews natively.
  preview jsonb,
  char_count integer not null default 0,
  extracted_at timestamptz not null default now()
);

create index if not exists document_texts_org_idx on public.document_texts (organization_id);

alter table public.document_texts enable row level security;

drop policy if exists document_texts_select on public.document_texts;
create policy document_texts_select on public.document_texts
  for select using (organization_id in (select public.current_principal_org_ids()));

drop policy if exists document_texts_write on public.document_texts;
create policy document_texts_write on public.document_texts
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- ---------------------------------------------------------------------------
-- 4. Earn's review
-- ---------------------------------------------------------------------------
create table if not exists public.document_reviews (
  document_id uuid primary key references public.documents(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  storage_key text not null,
  summary text not null default '',
  -- [{ severity: 'blocker'|'suggestion'|'nit', title, detail, location? }]
  recommendations jsonb not null default '[]'::jsonb,
  suggested_section text,
  -- 'earn' when Claude wrote it, 'rules' for the offline heuristic fallback.
  source text not null default 'earn',
  reviewed_at timestamptz not null default now()
);

create index if not exists document_reviews_org_idx on public.document_reviews (organization_id);

alter table public.document_reviews enable row level security;

drop policy if exists document_reviews_select on public.document_reviews;
create policy document_reviews_select on public.document_reviews
  for select using (organization_id in (select public.current_principal_org_ids()));

drop policy if exists document_reviews_write on public.document_reviews;
create policy document_reviews_write on public.document_reviews
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- Explicit Data API grants (see 0047_data_api_grants). RLS governs rows.
grant select, insert, update, delete on public.document_texts to anon, authenticated, service_role;
grant select, insert, update, delete on public.document_reviews to anon, authenticated, service_role;
