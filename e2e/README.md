# E2E suite

Two layers, by what they need:

- **Secrets-free specs** (`home`, `auth-gate`, `public-data-room`) run on every
  PR against a production build with placeholder Supabase env. They cover the
  middleware's auth-gate matrix (every protected route bounces to `/login`
  with `redirectedFrom`; public routes never bounce) and the public
  `/dr/[token]` share page in its degraded states.
- **Authed specs** (`shell.spec.ts` and the auth happy path) sign in as a
  dedicated test user and tour the real shell: cockpit, the four hubs,
  notifications, settings. They self-skip unless the env below is present, so
  CI stays green without secrets.

## Arming the authed suite in CI

1. **Seed the test user** (once, idempotent — re-running repairs/resets):

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co \
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
   E2E_TEST_EMAIL=e2e@yourdomain.com \
   E2E_TEST_PASSWORD=<strong-password> \
   npm run seed:e2e
   ```

   On Windows (PowerShell) — run from the repo folder, not system32; the
   `VAR=value command` prefix above is bash-only:

   ```powershell
   cd C:\path\to\fundexecs-os
   $env:NEXT_PUBLIC_SUPABASE_URL  = "https://<project>.supabase.co"
   $env:SUPABASE_SERVICE_ROLE_KEY = "<service-role-key>"
   $env:E2E_TEST_EMAIL            = "e2e@yourdomain.com"
   $env:E2E_TEST_PASSWORD         = "<strong-password>"
   npm run seed:e2e
   ```

   This creates a confirmed auth user shaped like a finished onboarding
   (profile, `member_profiles` complete, owner of an active org) so the
   middleware never bounces the suite.

2. **Add four GitHub Actions secrets** (repo → Settings → Secrets →
   Actions):

   | Secret                  | Value                    |
   | ----------------------- | ------------------------ |
   | `E2E_SUPABASE_URL`      | the project URL          |
   | `E2E_SUPABASE_ANON_KEY` | the anon/publishable key |
   | `E2E_TEST_EMAIL`        | the seeded email         |
   | `E2E_TEST_PASSWORD`     | the seeded password      |

   The `Playwright e2e smoke` job picks them up automatically; with them
   absent it falls back to placeholders and the authed specs skip.

## Running locally

```bash
npm install                  # first time
npx playwright install chromium   # first time — the test browser
npm run test:e2e                         # managed build + prod server
PLAYWRIGHT_BASE_URL=http://localhost:3000 npm run test:e2e   # reuse a running server
```

Export the same four env vars locally to include the authed specs.

On Windows (PowerShell):

```powershell
cd C:\path\to\fundexecs-os
npm install                       # first time
npx playwright install chromium   # first time
npm run test:e2e

# reuse an already-running server:
$env:PLAYWRIGHT_BASE_URL = "http://localhost:3000"
npm run test:e2e
```

> The seeded account is a real login for your project — use a dedicated
> address, a generated password, and treat the secrets like any credential.
