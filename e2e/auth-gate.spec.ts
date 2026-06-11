import { test, expect } from '@playwright/test';

/**
 * Auth-gate matrix — the middleware is the recurring regression source, so
 * this locks both directions for every shipped surface:
 *
 *  1. Each protected route bounces a signed-out visitor to /login and carries
 *     `redirectedFrom` so sign-in returns them to the surface they wanted.
 *  2. Each public route renders for a signed-out visitor with NO redirect —
 *     a share link or login page that bounces is a product break.
 *
 * Runs against the production build with placeholder Supabase env — no
 * secrets required.
 */

const PROTECTED_ROUTES = [
  '/command-center',
  '/build',
  '/build/formation',
  '/build/governance',
  '/build/data-room',
  '/build/brand',
  '/source',
  '/source/capital-map',
  '/source/pipeline',
  '/source/partners',
  '/source/leads',
  '/run',
  '/run/diligence',
  '/run/workflows',
  '/run/compliance',
  '/run/ir',
  '/execute',
  '/execute/closings',
  '/execute/wires',
  '/execute/capital',
  '/execute/chain-of-trust',
  '/notifications',
  '/settings'
];

for (const route of PROTECTED_ROUTES) {
  test(`signed-out ${route} redirects to /login with redirectedFrom`, async ({ page }) => {
    await page.goto(route);
    await page.waitForURL((url) => url.pathname === '/login');
    const url = new URL(page.url());
    expect(url.searchParams.get('redirectedFrom')).toBe(route);
  });
}

const PUBLIC_ROUTES = ['/', '/login'];

for (const route of PUBLIC_ROUTES) {
  test(`signed-out ${route} renders without a redirect`, async ({ page }) => {
    const res = await page.goto(route);
    expect(res?.status() ?? 0).toBeLessThan(400);
    expect(new URL(page.url()).pathname).toBe(route);
  });
}

test('the login form is reachable and labeled', async ({ page }) => {
  await page.goto('/login');
  // Labeled controls — the same accessibility contract the authed helper
  // relies on (getByLabel breaks the moment labels detach from inputs).
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  // The submit reads "Continue" in sign-in mode; accept either copy so a
  // wording tweak doesn't fail the suite while a missing button still does.
  await expect(page.getByRole('button', { name: /^(continue|sign in)$/i })).toBeVisible();
});
