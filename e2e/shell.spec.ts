import { test, expect } from '@playwright/test';
import { signIn, skipUnlessAuthed } from './helpers/auth';

/**
 * Authed shell tour — env-gated (set E2E_TEST_EMAIL / E2E_TEST_PASSWORD and
 * real Supabase env to run; skipped otherwise so CI stays green without
 * secrets). One pass over the whole shipped surface: the cockpit, all four
 * hubs, notifications and settings — asserting each page actually renders
 * its own content, not an error or someone else's.
 */

const HUBS = [
  { href: '/build', heading: /Build/ },
  { href: '/source', heading: /Source/ },
  { href: '/run', heading: /Run/ },
  { href: '/execute', heading: /Execute/ }
];

test('the cockpit renders the lifecycle and the one move', async ({ page }) => {
  skipUnlessAuthed();
  await signIn(page, '/command-center');

  await expect(page.getByText('Your lifecycle')).toBeVisible();
  // The rail (desktop) carries the four hubs with aria-current wiring.
  for (const hub of HUBS) {
    await expect(
      page.getByRole('navigation', { name: 'Lifecycle' }).first().getByText(hub.heading).first()
    ).toBeVisible();
  }
});

for (const hub of HUBS) {
  test(`hub landing ${hub.href} renders without error`, async ({ page }) => {
    skipUnlessAuthed();
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await signIn(page, hub.href);
    await expect(page.locator('main')).toContainText(hub.heading);
    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });
}

test('notifications inbox renders', async ({ page }) => {
  skipUnlessAuthed();
  await signIn(page, '/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
});

test('settings renders and switches sections', async ({ page }) => {
  skipUnlessAuthed();
  await signIn(page, '/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  await page.getByRole('tab', { name: 'Integrations' }).click();
  await expect(page.getByText('Email & calendar')).toBeVisible();

  await page.getByRole('tab', { name: 'Workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Organization' })).toBeVisible();
});
