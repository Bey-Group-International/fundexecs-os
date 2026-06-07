import { test, expect } from '@playwright/test';
import { skipUnlessAuthed, signIn } from './helpers/auth';

/**
 * Diligence surface.
 *
 * Unauth: /diligence is gated at the page level → redirects to /login.
 * Authed (env-gated): /diligence renders the runs surface — either the list of
 * runs or the tasteful empty state, both of which prove the loader resolved and
 * the page rendered without a crash.
 */

test('unauthenticated /diligence redirects to /login', async ({ page }) => {
  await page.goto('/diligence', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/login(\?|$)/);
  await expect(page.getByLabel('Email')).toBeVisible();
});

test('authed /diligence renders the runs surface', async ({ page }) => {
  skipUnlessAuthed();

  await signIn(page, '/diligence');
  await expect(page).toHaveURL(/\/diligence(\?|$)/);

  // The "Diligence runs" heading is the stable anchor that proves the surface
  // (list or empty state) rendered without a crash and the loader resolved.
  await expect(page.getByText('Diligence runs', { exact: false }).first()).toBeVisible();
});
