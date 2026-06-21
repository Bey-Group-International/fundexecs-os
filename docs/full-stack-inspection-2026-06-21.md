# Full-Stack Inspection Report — fundexecs-os

**Date:** 2026-06-21
**Scope:** Next.js 14 (App Router) + React 18 + Tailwind + Supabase (Postgres/RLS) + Stripe + Anthropic
**Method:** Build/typecheck/lint/test runs, `npm audit`, and four parallel deep-dive audits (API/auth, DB/RLS, business logic, front-end), with the headline findings re-verified by hand.

---

## 1. Executive summary

The codebase is in **good overall health**. It builds, typechecks, lints clean, and the full Jest suite (626 tests / 60 suites) passes. The database tenancy model is genuinely strong: **RLS is enabled on all ~70 tables** with a consistent org-scoped policy pattern, and the Supabase client separation (anon/cookie vs. service-role) is correct and not leaked to the browser.

The issues worth acting on are concentrated in three areas:

1. **Dependency vulnerabilities** in Next.js 14.2.35 (the single highest external-facing risk).
2. **CI gaps** — `next build` is never run in CI, and one workflow pins a likely-invalid action version.
3. A handful of **application-layer hardening** items (CSPRNG for referral codes, defense-in-depth org filters, a checkout-ownership check) and **consistency nits**.

No critical, exploitable data-leak was confirmed. Several findings the automated pass flagged as "critical" were **downgraded after manual verification** (see §3).

| Status | Area |
|---|---|
| ✅ Pass | Build, typecheck, lint, 626 tests |
| ✅ Strong | RLS / multi-tenant isolation, secret handling, encryption (AES-256-GCM), API-key hashing |
| ⚠️ Action | Next.js dependency CVEs; CI build gap; CSPRNG for codes; defense-in-depth org filters |
| ℹ️ Minor | Threshold inconsistency, env-doc drift, test-coverage gaps |

---

## 2. Toolchain / build status

| Check | Result |
|---|---|
| `tsc --noEmit` | ✅ clean (exit 0) |
| `next lint` | ✅ no warnings/errors |
| `next build` | ✅ succeeds |
| `jest` | ✅ 626 passed / 60 suites |
| `as any` casts | 0 in `lib/app/components` |
| `@ts-ignore/@ts-expect-error` | 1, in a **test** exercising a runtime guard (not an issue) |
| `console.log` in `lib/app` | 0 |

---

## 3. Security findings (severity-corrected)

### 3.1 Dependency vulnerabilities — **HIGH** (top priority)
`npm audit` reports **23 vulnerabilities (4 high, 19 moderate)**, all stemming from `next@14.2.35` and its transitive `postcss`. Advisories include:
- SSRF via WebSocket upgrades (`GHSA-c4j6-fc7j-m34r`)
- Cache poisoning in RSC responses (`GHSA-wfc6-r584-vfw7`, `GHSA-vfv6-92ff-j949`)
- DoS in the Image Optimization API (`GHSA-h64f-5h5j-jqjh`)
- Middleware/proxy bypass (Pages Router i18n — not used here, but present in the dep)

**Action:** Plan a Next.js upgrade. `npm audit fix --force` wants `next@16` (a major bump) — don't run that blindly; instead bump to the latest patched **14.2.x / 15.x** and run the full build + test suite. Mitigating factor: this app uses the App Router (not Pages i18n), so the middleware-bypass advisory doesn't apply.

### 3.2 Defense-in-depth: org filters on RLS-backed read routes — **LOW** (was flagged "critical")
Routes like `app/api/report/route.ts` query `tasks/approvals/artifacts` by ID only (e.g. `.eq("id", taskId)`), without an explicit `.eq("organization_id", …)`.

**Verified safe:** these handlers use `createServerClient()` — the **cookie-bound, RLS-enforced** client (confirmed in `lib/supabase/server.ts:27`), and the DB audit confirmed **RLS is enabled with org-scoped policies on every table**. So cross-org access is blocked at the database. This is therefore a *defense-in-depth* recommendation, not an active leak: add explicit `organization_id` filters so a future RLS regression can't silently open data. `app/api/clarify/route.ts` already does this correctly and is the pattern to follow.

### 3.3 Predictable referral codes (`Math.random`) — **MEDIUM**
`lib/gift-earn.ts:26` generates referral codes (which unlock credit rewards) with `Math.random()`:
```ts
for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
```
`Math.random()` is not cryptographically secure. Since these codes gate a financial reward, an attacker could attempt to predict/enumerate them. **Action:** switch to `crypto.randomInt()` / `crypto.randomBytes()`. (The 8-char/32-symbol space + unique-constraint retry limits abuse somewhat, so this is medium, not high.)

### 3.4 Stripe checkout-return ownership — **LOW**
`app/api/stripe/return/route.ts` calls `fulfillCheckout(session_id)` from the query string without checking the session belongs to the logged-in org. Idempotent fulfillment + Stripe metadata make this largely self-correcting, but add an explicit `session.client_reference_id === ctx.orgId` check for robustness.

### 3.5 No rate-limiting on public v1 API / token routes — **LOW–MEDIUM**
`app/api/v1/*` (API-key auth) and the dataroom token routes have no rate limiting, allowing bulk enumeration/export within a valid key's scope. Consider per-key quotas (Upstash/Vercel) and a timing-safe token compare on `app/dataroom/[token]/...`.

### 3.6 Confirmed-good controls (no action)
- **Stripe webhook** verifies the signature via `webhooks.constructEvent(...)` and 400s on failure. ✅
- **Cron endpoint** requires `Authorization: Bearer <CRON_SECRET>`. ✅
- **Brain ingest** supports a shared-secret path and an authed-org-writer path (service-role used only after auth). ✅
- **OAuth callback** rejects protocol-relative/absolute `next` redirects (open-redirect safe). ✅
- **Secrets:** AES-256-GCM vault (`lib/vault.ts`), HMAC/scrypt-hashed API keys (secret never stored), service-role key never in `NEXT_PUBLIC_*`. ✅
- **No `dangerouslySetInnerHTML`** anywhere; markdown is parsed to React elements. ✅
- **Client/server boundaries** correct (all hook-using components carry `"use client"`). ✅

---

## 4. Database / RLS

**Strong.** RLS enabled on all ~70 tables across migrations `0001–0051`; uniform policy shape:
```sql
for select using (organization_id in (select public.current_principal_org_ids()));
for all   using (public.is_org_writer(organization_id)) with check (public.is_org_writer(organization_id));
```
- No `USING (true)` on sensitive tables. Intentionally world-readable tables (`ai_agents`, public `marketplace_listings`) are guarded by `is_public/status` predicates.
- Migration sequence is gapless and idempotent (`create … if not exists`, `drop policy if exists`); no `DROP TABLE`/`TRUNCATE`; FK dependency order is respected.
- No hardcoded secrets in migrations (only masked display strings like `fxsk_live_••••1234`).

**Note (process):** `.github/workflows/db-migrate.yml` pushes migrations to **production** on merge to `main` and embeds the prod project ref in a comment (`qhxcvvidhnwdgemjeaug`). The ref isn't itself a secret, but confirm the access token/DB password are repo secrets and consider a manual approval gate for prod schema changes.

---

## 5. Business-logic correctness (`lib/`)

- **Diligence-coverage threshold mismatch — MEDIUM (verify intent).** `lib/execute-closing.ts:83` requires `coverage >= 0.8` while `lib/run-conviction.ts:170` uses `coverage >= 0.7`. A deal can read "substantially cleared" in one hub but fail the closing checklist in another. If intentional (closing stricter than conviction), document it; otherwise unify.
- **Referral-code TOCTOU — LOW.** `getOrCreateReferralCode` does read-then-insert; it recovers via the unique constraint but would be cleaner as an `INSERT … ON CONFLICT DO NOTHING` upsert.
- **Unguarded follow-up writes — LOW.** `lib/reputation.ts` ignores errors on the `update(tier)` and `reputation_ledger` insert after the RPC; a mid-sequence failure can desync the tier column from the ledger.
- **Duplicated `toPercent()`** in `underwriting-calc.ts` and `run-conviction.ts` (deliberately mirrored "leaf-pure"; risk of divergence — at least cross-reference in comments).
- Positive: division-by-zero is guarded in waterfall/LP-report math; no `any`; pure functions kept I/O-free.

---

## 6. Front-end

Essentially clean. No client/server boundary violations, no XSS sinks, no secrets in the bundle, no broken imports or missing assets (the pixel sprites removed during the #159 conflict fix are fully de-referenced). Minor: a few decorative `alt=""` logos (`build/BrandStudio.tsx`, `build/MaterialsModule.tsx`) could carry descriptive alt text, and there's repeated inline Tailwind that could be extracted into shared button/card primitives. Data fetching batches with `Promise.all` (no N+1).

---

## 7. CI / config / consistency

- **`next build` is not run in CI — MEDIUM.** `ci.yml` runs only lint + typecheck; `jest.yml` runs tests. A broken build (e.g. RSC serialization / static-gen errors that lint+tsc miss) can reach `main`. **Add a build step to CI.**
- **Invalid/inconsistent action pin — MEDIUM.** `jest.yml:40` uses `actions/checkout@v6` while `ci.yml`/`db-migrate.yml` use `@v4`. `@v6` is almost certainly not a published major — this workflow likely fails to resolve the action. Pin to `@v4`.
- **Env documentation drift — LOW.** `BRAIN_INGEST_SECRET` (used in `app/api/brains/ingest/route.ts`) is missing from `.env.example`. Conversely `.env.example` documents several integration tokens not referenced in source (`CALENDLY_API_TOKEN`, `SLACK_BOT_TOKEN`, `ZOOM_*`, `GOOGLE_*`) — prune or mark "planned."

---

## 8. Test-coverage gaps

~30 `lib/` modules have no `.test.ts`. Highest-value to cover (money/trust/auth-adjacent): **`lib/credits.ts`**, **`lib/reputation.ts`**, **`lib/engine.ts`** (workflow orchestration), `lib/api-keys-verify.ts`, `lib/stripe.ts`, `lib/entitlements.ts`.

---

## 9. Prioritized action list

**Now**
1. Plan the **Next.js security upgrade** (§3.1) — bump to latest patched 14.2.x/15.x, then build + test.
2. **Add `next build` to CI** and **fix `actions/checkout@v6` → `@v4`** in `jest.yml` (§7).

**This week**
3. Replace `Math.random()` referral codes with a CSPRNG (§3.3).
4. Add explicit `organization_id` filters to RLS-backed read routes for defense-in-depth (§3.2); add the Stripe-return ownership check (§3.4).
5. Resolve the 0.7 vs 0.8 diligence-threshold mismatch (§5).

**This month**
6. Rate-limit `api/v1/*` + dataroom token routes; timing-safe token compare (§3.5).
7. Add tests for `credits.ts`, `reputation.ts`, `engine.ts` (§8).
8. Tidy env docs (§7) and the `reputation.ts` unguarded writes (§5).

---

*Severities reflect manual re-verification: the database's RLS layer materially reduces the blast radius of the application-layer items, which is why several first-pass "critical" flags are recorded here as low/defense-in-depth.*
