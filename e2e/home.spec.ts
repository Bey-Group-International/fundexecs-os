import { test, expect } from '@playwright/test';

/**
 * Home smoke — the fresh-start placeholder must render without a server error
 * or an uncaught client exception. The full visual workflow was archived; e2e
 * coverage is rebuilt alongside the new frontend.
 *
 * We assert on HTTP status, on-page text, and uncaught page errors — not on
 * console resource warnings (e.g. a missing favicon 404), which are noise for a
 * placeholder and not a functional failure.
 */
test('home page renders without error', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const res = await page.goto('/');
  expect(res?.status() ?? 0).toBeLessThan(400);
  await expect(page.locator('body')).toContainText(/FundExecs/i);
  expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
});
