import { test, expect } from '@playwright/test';
import { skipUnlessAuthed, signIn } from './helpers/auth';

/**
 * Settings + admin gate.
 *
 * Unauth coverage already lives in auth-redirect.spec.ts (/settings → /login).
 * Here we cover the authed surface (env-gated):
 *  - /settings renders its rail view.
 *  - The Admin section is present ONLY for admins. We don't know the test
 *    user's role, so we assert the invariant that holds either way: the Admin
 *    rail entry is visible IFF the admin pane is reachable — i.e. the gate is
 *    consistent, never a half-rendered admin surface for a non-admin.
 */

test('authed /settings renders and gates the Admin section consistently', async ({ page }) => {
  skipUnlessAuthed();

  await signIn(page, '/settings');
  await expect(page).toHaveURL(/\/settings(\?|#|$)/);

  // The rail view is the stable anchor for the settings surface.
  await expect(page.getByTestId('settings-rail-view')).toBeVisible();

  // The Admin rail entry is rendered only for admins (SettingsView filters the
  // 'admin' section unless isAdmin). Whatever the test user's role, the gate
  // must be internally consistent: if the entry is shown, clicking it reveals
  // the admin pane; if it's hidden, the admin pane is never present.
  const adminRailEntry = page.getByTestId('settings-rail-admin');
  const isAdmin = (await adminRailEntry.count()) > 0;

  if (isAdmin) {
    await adminRailEntry.click();
    await expect(page.getByTestId('settings-pane-admin')).toBeVisible();
  } else {
    await expect(page.getByTestId('settings-pane-admin')).toHaveCount(0);
  }
});
