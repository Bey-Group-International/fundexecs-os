import { test, expect, type Page } from '@playwright/test';

/**
 * Public pages must render without a server error or a client-side crash.
 * These are the unauthenticated entry points; if any of them 500s or throws,
 * nobody can reach the product. We assert on HTTP status, absence of console
 * errors, and a stable on-page anchor for each route.
 */

type PublicRoute = {
  path: string;
  /** A substring expected to appear in the rendered page body. */
  expectedText: RegExp;
};

const PUBLIC_ROUTES: PublicRoute[] = [
  { path: '/', expectedText: /FundExecs/i },
  // "FundExecs" is server-rendered on the login page; the sign-in form itself
  // is a client component that hydrates in, so we assert on the stable
  // server-rendered brand text here and exercise the form fields explicitly in
  // auth-redirect.spec.ts / auth-happy-path.spec.ts.
  { path: '/login', expectedText: /FundExecs/i },
  { path: '/privacy', expectedText: /privacy/i },
  { path: '/terms', expectedText: /terms/i }
];

/**
 * Attach a console-error collector. We ignore benign noise (favicon, missing
 * static asset 404s from the placeholder env) and only fail on genuine
 * uncaught page errors / error-level console messages.
 */
function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Network 404s for optional assets aren't app crashes.
    if (/Failed to load resource/i.test(text)) return;
    errors.push(`console.error: ${text}`);
  });
  return errors;
}

for (const route of PUBLIC_ROUTES) {
  test(`public page renders: ${route.path}`, async ({ page }) => {
    const errors = collectPageErrors(page);

    const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' });

    expect(response, `no response for ${route.path}`).not.toBeNull();
    const status = response!.status();
    expect(status, `${route.path} should not be a server error`).toBeLessThan(500);

    // Body should contain the expected anchor text.
    await expect(page.locator('body')).toContainText(route.expectedText);

    // No client-side crashes.
    expect(errors, `console/page errors on ${route.path}: ${errors.join(' | ')}`).toHaveLength(0);
  });
}

test('landing page links to /login', async ({ page }) => {
  await page.goto('/');
  // The landing page exposes at least one anchor into the auth flow.
  await expect(page.locator('a[href="/login"]').first()).toBeVisible();
});
