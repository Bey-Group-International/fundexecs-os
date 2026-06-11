import { test, type Page } from '@playwright/test';

/* ============================================================================
 * e2e/helpers/auth.ts — shared env-gated auth helper.
 *
 * Authed specs need a real Supabase + a seeded test user. We reuse the exact
 * `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD` pattern from auth-happy-path.spec.ts
 * and `test.skip()` when they (or real Supabase env) are absent, so CI stays
 * green without secrets. No credentials are ever hardcoded.
 * ========================================================================= */

export const E2E_EMAIL = process.env.E2E_TEST_EMAIL;
export const E2E_PASSWORD = process.env.E2E_TEST_PASSWORD;

export const hasRealSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder');

/** True only when an authed test can actually run. */
export const canRunAuthed = !!E2E_EMAIL && !!E2E_PASSWORD && hasRealSupabase;

/**
 * Skip the current test unless real auth credentials + Supabase env are set.
 * Call at the top of any authed test body.
 */
export function skipUnlessAuthed(): void {
  test.skip(
    !canRunAuthed,
    'Set E2E_TEST_EMAIL, E2E_TEST_PASSWORD and real NEXT_PUBLIC_SUPABASE_* to run authed e2e.'
  );
}

/**
 * Sign in via the real server-action login flow and wait until we've left
 * /login. Lands on `target` afterward (defaults to leaving login wherever the
 * app sends us). Auto-waits throughout — no fixed sleeps.
 */
export async function signIn(page: Page, target?: string): Promise<void> {
  // Use redirectedFrom so we land directly on the surface under test.
  const loginUrl = target ? `/login?redirectedFrom=${encodeURIComponent(target)}` : '/login';
  await page.goto(loginUrl);

  await page.getByLabel('Email').fill(E2E_EMAIL!);
  await page.getByLabel('Password').fill(E2E_PASSWORD!);

  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 }),
    // The sign-in submit reads "Continue" (post-fresh-start copy); accept the
    // old wording too so a copy change doesn't strand the authed suite.
    page.getByRole('button', { name: /^(continue|sign in)$/i }).click()
  ]);

  // If a specific target was requested but the app routed elsewhere
  // (e.g. onboarding), navigate to it explicitly so the test asserts the
  // intended surface.
  if (target && new URL(page.url()).pathname !== target) {
    await page.goto(target, { waitUntil: 'domcontentloaded' });
  }
}
