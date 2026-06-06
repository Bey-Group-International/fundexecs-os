import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright e2e smoke suite for FundExecs OS.
 *
 * The `webServer` builds the app once and serves the production output, which
 * is the closest match to what ships and exercises the real proxy/middleware
 * auth gate (the source of the recurring redirect regressions). Public
 * placeholder Supabase env keeps the build self-contained — no real secrets
 * required. See lib/supabase/middleware.ts for how the app stays resilient
 * when Supabase env is a placeholder.
 *
 * Set `PLAYWRIGHT_BASE_URL` to point the tests at an already-running server and
 * skip the managed build/start (handy for fast local iteration).
 */
const PORT = Number(process.env.PORT ?? 3100);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const reuseExistingServer = !process.env.CI;

export default defineConfig({
  testDir: './e2e',
  // Fail the build on CI if test.only is committed by accident.
  forbidOnly: !!process.env.CI,
  // Auth/redirect flakiness is the thing we're guarding against — retry once on
  // CI to absorb transient network/cold-start noise without hiding real breaks.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
    actionTimeout: 10_000,
    navigationTimeout: 20_000
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        // Build then start the production server so the suite mirrors prod and
        // exercises the compiled proxy/middleware.
        command: 'npm run build && npm run start',
        url: baseURL,
        timeout: 240_000,
        reuseExistingServer,
        env: {
          // Placeholder Supabase env: the app build and public pages are
          // resilient when these are absent or dummy. The auth happy-path test
          // is env-gated separately and skips without real E2E_TEST_* creds.
          NEXT_PUBLIC_SUPABASE_URL:
            process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
          NEXT_PUBLIC_SUPABASE_ANON_KEY:
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key',
          PORT: String(PORT)
        }
      }
});
