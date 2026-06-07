import { test, expect } from '@playwright/test';
import { skipUnlessAuthed, signIn } from './helpers/auth';

/**
 * Credit wallet control.
 *
 * The top-nav credit-wallet fuel-gauge (CreditWalletGauge) renders on every
 * authed surface. It degrades to a clean stub when the ledger isn't configured,
 * so its presence — not a specific balance — is the invariant we assert.
 *
 * Env-gated: needs an authed session (real Supabase + seeded test user).
 * The gauge is hidden below the `sm` breakpoint; the default Desktop Chrome
 * viewport (1280px) is well above it, so it's visible.
 */

test('authed top-nav renders the credit-wallet control', async ({ page }) => {
  skipUnlessAuthed();

  await signIn(page, '/command-center');

  const gauge = page.getByTestId('credit-wallet-gauge');
  await expect(gauge).toBeVisible();

  // It carries its configured-state marker (true/false) and links to top-up —
  // proving it's the real, wired control, not a placeholder.
  await expect(gauge).toHaveAttribute('data-configured', /^(true|false)$/);
  await expect(gauge).toHaveAttribute('href', /\/settings/);
});
