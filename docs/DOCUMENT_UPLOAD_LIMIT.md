# Document upload limit

How large a file the Documents library accepts, and how to raise it.

## Three limits, smallest wins

| Limit | Where it lives | Value |
| --- | --- | --- |
| App cap | `NEXT_PUBLIC_DOCUMENT_MAX_UPLOAD_MB` (Vercel env, build-time) | **50 MB** today; code default is 50 when unset, never above 500 |
| Project global upload limit | Supabase Management API / Dashboard → Storage → Settings | **50 MB** — the Free-plan maximum |
| `documents` bucket limit | `storage.buckets.file_size_limit` (migration `20260930200000`) | 500 MB |

The app cap is the only one a user sees: the drop zone states it and refuses a larger file before anything is uploaded. It must never be higher than the project's global limit, or a file between the two uploads for minutes and then fails at Storage.

## Raising it to 500 MB (after upgrading to Pro)

1. **Upgrade the Supabase project** (`qhxcvvidhnwdgemjeaug`) to a paid plan: Dashboard → Settings → Billing. The Free plan rejects anything above 50 MB.
2. **Raise the project's global limit** to 500 MB, either:
   - Dashboard → Storage → Settings → *Upload file size limit* → 500 MB, or
   - `SUPABASE_ACCESS_TOKEN=sbp_… node scripts/set-storage-upload-limit.mjs --project qhxcvvidhnwdgemjeaug --mb 500`
     (needs a token with write access; the DB Migrate workflow's token is read-only by design).
3. **Raise the app cap**: set `NEXT_PUBLIC_DOCUMENT_MAX_UPLOAD_MB=500` on the Vercel project (production and preview), then **redeploy** — it is inlined at build time, so an existing deployment keeps the old number.

Do step 3 last. Raising the app cap before the global limit brings back the failure this setup exists to prevent.

## Why not a migration

The bucket limit is a row in `storage.buckets`, so a migration sets it. The global limit is project configuration behind the Management API, which migrations cannot reach — hence the script.
