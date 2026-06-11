import { test, expect } from '@playwright/test';

/**
 * Public data room — /dr/[token] is outward-facing: an LP with a link and no
 * session. It must render calmly in every degraded state (unknown token,
 * missing service-role env on a preview) and never bounce to /login.
 *
 * Runs against the production build with placeholder Supabase env, which
 * doubles as the infra-failure case: the loader degrades to the honest
 * "no room" card instead of a 500.
 */

test('an unknown token renders the no-room card, anonymously', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const res = await page.goto('/dr/not-a-real-token');
  expect(res?.status() ?? 0).toBeLessThan(400);

  // No auth bounce — the route is public.
  expect(new URL(page.url()).pathname).toBe('/dr/not-a-real-token');

  await expect(page.getByText('No room at this address')).toBeVisible();
  await expect(page.getByText('Secure data room')).toBeVisible();
  expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
});

test('share pages are not indexable', async ({ page }) => {
  await page.goto('/dr/not-a-real-token');
  const robots = page.locator('meta[name="robots"]');
  await expect(robots).toHaveAttribute('content', /noindex/);
});
