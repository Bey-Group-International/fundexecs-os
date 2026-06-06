import { test, expect } from '@playwright/test';

/**
 * Auth happy-path — the exact recurring regression: a valid member signs in and
 * gets BOUNCED BACK to /login instead of landing in the app.
 *
 * This test is env-gated. It only runs when BOTH `E2E_TEST_EMAIL` and
 * `E2E_TEST_PASSWORD` are present (plus real Supabase env so auth actually
 * works). Without them it skips, so the suite stays green in CI with no
 * secrets. No credentials are ever hardcoded.
 *
 * To enable locally or in CI: set
 *   E2E_TEST_EMAIL, E2E_TEST_PASSWORD,
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
 * to real values (see scripts/provision-test-users.cjs for seeding a user).
 */

const email = process.env.E2E_TEST_EMAIL;
const password = process.env.E2E_TEST_PASSWORD;
const hasRealSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder');

test('sign in with email lands in the app (not bounced to /login)', async ({ page }) => {
  test.skip(
    !email || !password,
    'Set E2E_TEST_EMAIL and E2E_TEST_PASSWORD to run the auth happy-path test.'
  );
  test.skip(
    !hasRealSupabase,
    'Set real NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY to run the auth happy-path test.'
  );

  await page.goto('/login');

  await page.getByLabel('Email').fill(email!);
  await page.getByLabel('Password').fill(password!);

  await Promise.all([
    // The server action redirects away from /login on success.
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 }),
    page.getByRole('button', { name: /^sign in$/i }).click()
  ]);

  // The core assertion: we are NOT sitting on /login.
  await expect(page).not.toHaveURL(/\/login(\?|$)/);

  // And we did not get redirected back to /login after a beat (the regression
  // manifests as an immediate bounce). A short re-check guards that.
  await page.waitForLoadState('networkidle');
  await expect(page).not.toHaveURL(/\/login(\?|$)/);
});
