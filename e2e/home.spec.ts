import { test, expect } from '@playwright/test';

/**
 * Home smoke — the fresh-start placeholder must render without a server error
 * or client crash. The full visual workflow was archived; e2e coverage will be
 * rebuilt alongside the new frontend.
 */
test('home page renders without error', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  const res = await page.goto('/');
  expect(res?.status() ?? 0).toBeLessThan(400);
  await expect(page.locator('body')).toContainText(/FundExecs/i);
  expect(errors, `console errors: ${errors.join(' | ')}`).toHaveLength(0);
});
