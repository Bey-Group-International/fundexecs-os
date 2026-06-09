-- =====================================================================
-- Tighten the `avatars` storage bucket: drop the broad list-all SELECT.
--
-- `avatars` is a PUBLIC bucket, so objects are served over the public URL
-- path (`/storage/v1/object/public/avatars/…`), which bypasses RLS — the app
-- only ever calls `upload()` and `getPublicUrl()`, never `list()`. The broad
-- `SELECT` policy granted to the `public` role therefore adds nothing for
-- display, but it DOES let any client enumerate every avatar filename via the
-- list/REST APIs. Drop it; owner-scoped insert/update/delete stay intact.
--
-- Addresses Supabase advisor `0025_public_bucket_allows_listing`. Idempotent.
-- =====================================================================

drop policy if exists "avatars public read" on storage.objects;
