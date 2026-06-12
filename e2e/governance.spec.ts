import { test, expect } from '@playwright/test';
import { signIn, skipUnlessAuthed } from './helpers/auth';

/**
 * Authed governance approve-loop tour — env-gated (set E2E_TEST_EMAIL /
 * E2E_TEST_PASSWORD + real Supabase env to run; skipped otherwise so CI stays
 * green without secrets). The seeded e2e user owns its org, so it can drive the
 * owner/admin-gated governance writes.
 *
 * Exercises the two approve loops on Structure & governance:
 *  - adopt a policy (Policies tab → Draft → drafting choreography → Adopt),
 *  - seat a body member from the bench (Governance bodies → Line up → approve).
 * Both persist; the assertions key off the resulting Active / seated state.
 */

test('the governance hub renders inside the Build shell', async ({ page }) => {
  skipUnlessAuthed();
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await signIn(page, '/build/governance');

  // The hub header and the surface's own heading both render.
  await expect(page.locator('main')).toContainText('Structure');
  await expect(page.getByText('policies active')).toBeVisible();
  expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
});

test('adopting a policy runs the approve loop and lands Active', async ({ page }) => {
  skipUnlessAuthed();
  await signIn(page, '/build/governance');

  // Into the Policies tab.
  await page.getByRole('tab', { name: /Policies/i }).click();

  // Open the first policy's builder (Draft for a fresh one, View if already
  // adopted from a prior run — either reaches the builder).
  const firstCard = page.locator('button', { hasText: /^(Draft|Adopt|View)$/ }).first();
  await firstCard.click();

  // Drive Draft & adopt → the drafting choreography → Adopt & finish.
  const draftAdopt = page.getByRole('button', { name: /Draft & adopt/i });
  if (await draftAdopt.isVisible().catch(() => false)) {
    await draftAdopt.click();
  }
  const adopt = page.getByRole('button', { name: /Adopt & finish/i });
  await expect(adopt).toBeVisible({ timeout: 15_000 });
  await adopt.click();

  // Back on the grid, the policy reads Active.
  await expect(page.getByText('Active').first()).toBeVisible({ timeout: 15_000 });
});

test('seating a bench candidate runs the approve loop', async ({ page }) => {
  skipUnlessAuthed();
  await signIn(page, '/build/governance');

  await page.getByRole('tab', { name: /Governance bodies/i }).click();

  // The first body with an open seat surfaces an "Earn's bench" line-up button.
  const lineUp = page.getByRole('button', { name: /Line up/i }).first();
  if (!(await lineUp.isVisible().catch(() => false))) {
    test.info().annotations.push({ type: 'note', description: 'No open seats — all bodies full.' });
    return;
  }
  await lineUp.click();

  // The ActionRunner approve loop: wait for the draft, then approve.
  const approve = page.getByRole('button', { name: /Approve & execute/i });
  await expect(approve).toBeVisible({ timeout: 15_000 });
  await expect(approve).toBeEnabled({ timeout: 15_000 });
  await approve.click();

  // The loop closes on success.
  await expect(page.getByText(/applied to your record/i)).toBeVisible({ timeout: 15_000 });
});
