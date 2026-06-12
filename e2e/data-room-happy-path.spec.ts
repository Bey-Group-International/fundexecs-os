import { test, expect } from '@playwright/test';
import { signIn, skipUnlessAuthed } from './helpers/auth';

/**
 * Materials & data room — the full share loop, end to end against a real
 * Supabase: the operator builds a material, generates a vetted link, an
 * anonymous recipient passes the gate at /dr/[token], and the logged view
 * surfaces back in the operator's room.
 *
 * Env-gated like the other authed specs: skips without real Supabase env +
 * the seeded e2e user. Idempotent by design — materials rebuild in place,
 * links are reused while live, and gate verifications upsert per
 * (link, email) — so reruns don't grow the test org's data.
 */

const VIEWER_NAME = 'E2E Viewer';
const VIEWER_EMAIL = 'e2e-viewer@example.com';

test('an LP passes the vetted gate and shows up in the operator room', async ({
  page,
  browser
}) => {
  skipUnlessAuthed();
  test.slow(); // build choreography + a second browser context

  await signIn(page, '/build/data-room');
  await expect(page.getByText('Materials & data room')).toBeVisible();

  // ── ensure the One-pager material is Ready ──────────────────────────────
  const matCard = page
    .locator('div')
    .filter({ has: page.getByText('One-pager', { exact: true }) })
    .filter({ has: page.getByRole('button', { name: /^(Build|Open)$/ }) })
    .last();
  const buildBtn = matCard.getByRole('button', { name: 'Build', exact: true });
  if (await buildBtn.isVisible().catch(() => false)) {
    await buildBtn.click();
    await page.getByRole('button', { name: /Build & add to room/ }).click();
    // The drafting choreography runs, then the review state offers the add.
    await page.getByRole('button', { name: /Add to room & continue/ }).click({ timeout: 20_000 });
  }

  // ── the room: a live link for the One-pager ─────────────────────────────
  await page.getByText('The data room', { exact: true }).click();
  const docRow = page
    .locator('div')
    .filter({ has: page.getByText('One-pager', { exact: true }) })
    .filter({ hasText: 'Built here' })
    .last();
  await expect(docRow).toBeVisible();

  const genBtn = docRow.getByRole('button', { name: /^(Generate link|New link)$/ });
  if (await genBtn.isVisible().catch(() => false)) {
    await genBtn.click();
  }
  const chip = docRow.locator('a[href^="/dr/"]');
  await expect(chip).toBeVisible({ timeout: 15_000 });
  const href = await chip.getAttribute('href');
  expect(href).toBeTruthy();

  // ── the recipient: anonymous context through the gate ───────────────────
  const lpContext = await browser.newContext();
  try {
    const lp = await lpContext.newPage();
    await lp.goto(href!);
    await expect(lp.getByText('Shared by')).toBeVisible();

    await lp.getByLabel('Your name').fill(VIEWER_NAME);
    await lp.getByLabel('Email').fill(VIEWER_EMAIL);
    const attest = lp.locator('input[type="checkbox"]');
    if (await attest.isVisible().catch(() => false)) {
      await attest.check();
    }
    await lp.getByRole('button', { name: 'Enter the room' }).click();

    // Inside: the honest badge, and the room never over-claims.
    await expect(lp.getByText(`Access logged · ${VIEWER_NAME}`)).toBeVisible({
      timeout: 15_000
    });
  } finally {
    await lpContext.close();
  }

  // ── back in the operator room: the view is on the record ────────────────
  await page.reload();
  await page.getByText('The data room', { exact: true }).click();
  await expect(page.getByText(VIEWER_NAME).first()).toBeVisible({ timeout: 15_000 });
});
