import { test, expect } from '@playwright/test';

/**
 * Guards the middleware auth gate (lib/supabase/middleware.ts + proxy.ts).
 *
 * Two recurring regression classes:
 *  1. Protected routes stop redirecting unauthenticated users → leak.
 *  2. (covered in auth-happy-path.spec.ts) authenticated users get bounced
 *     back to /login.
 *
 * Here we cover (1): an unauthenticated visit to a protected route must land
 * on /login with the originating path preserved as `redirectedFrom`.
 */

const PROTECTED_ROUTES = ['/command-center', '/pipeline', '/settings'];

for (const route of PROTECTED_ROUTES) {
  test(`unauthenticated ${route} redirects to /login`, async ({ page }) => {
    await page.goto(route, { waitUntil: 'domcontentloaded' });

    // Wait for the proxy redirect to settle on /login.
    await expect(page).toHaveURL(/\/login(\?|$)/);

    // The login form should be present (proves we landed on a real login page,
    // not an error page that happens to be at /login).
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();

    // Originating path is preserved for post-login redirect.
    const url = new URL(page.url());
    expect(url.searchParams.get('redirectedFrom')).toBe(route);
  });
}
