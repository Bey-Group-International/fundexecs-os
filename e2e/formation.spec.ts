import { test, expect, type Page } from '@playwright/test';
import { signIn, skipUnlessAuthed } from './helpers/auth';

/**
 * Formation wizard e2e — env-gated like the rest of the authed suite.
 *
 * Two layers:
 * - Read-only coverage (runs whenever the authed suite is armed): the flow
 *   renders in whatever state the seeded org is in, normalizes to the
 *   checklist, and the first step opens to its editor or drafted-doc review.
 * - The mutating happy path (file → review draft → amend affordance) REALLY
 *   files a step for the seeded org — chain records, data-room material,
 *   version snapshots. It therefore additionally requires
 *   `E2E_FORMATION_WRITES=1`, so default CI stays read-only and the test
 *   only runs against a database that has the formation migrations applied.
 *   It is re-run safe by design: a second run amends (v2, v3, …) instead of
 *   duplicating, which exercises the amendment path for free.
 */

const STEP_NAMES = [
  'Your fund story',
  'Fund entity (LP + GP)',
  'Limited Partnership Agreement',
  'Private Placement Memorandum',
  'Subscription documents',
  'Reg D / Form D filing',
  'Bank & escrow accounts'
];

const canMutate = process.env.E2E_FORMATION_WRITES === '1';

/** Land on the checklist from any of the flow's three entry states. */
async function openChecklist(page: Page): Promise<void> {
  await signIn(page, '/build/formation');
  const begin = page.getByRole('button', { name: 'Begin formation' });
  const reviewDocs = page.getByRole('button', { name: 'Review documents' });
  const checklist = page.getByRole('heading', { name: 'Form your fund' });

  await expect(begin.or(reviewDocs).or(checklist).first()).toBeVisible();
  if (await begin.isVisible()) await begin.click();
  else if (await reviewDocs.isVisible()) await reviewDocs.click();
  await expect(checklist).toBeVisible();
}

/**
 * Open the story step's editor. A Done row routes to the drafted-doc review
 * first, so go through "Reopen & amend" when needed.
 */
async function openStoryEditor(page: Page): Promise<void> {
  const row = page.getByRole('button').filter({ hasText: 'Your fund story' }).first();
  const filed = await row
    .getByText(/Filed/)
    .isVisible()
    .catch(() => false);
  await row.click();

  if (filed) {
    await expect(page.getByRole('heading', { name: 'Fund narrative' })).toBeVisible();
    await page.getByRole('button', { name: 'Reopen & amend' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Your fund story' }).first()).toBeVisible();
  await expect(page.getByText('Copiloted')).toBeVisible();
}

test('formation checklist renders all seven steps with honest state badges', async ({ page }) => {
  skipUnlessAuthed();
  await openChecklist(page);

  await expect(page.getByText('Illustrative').first()).toBeVisible();
  for (const name of STEP_NAMES) {
    await expect(
      page.getByRole('button').filter({ hasText: name }).first(),
      `checklist row "${name}"`
    ).toBeVisible();
  }
});

test('the story step opens to its editor (via the drafted-doc review when filed)', async ({
  page
}) => {
  skipUnlessAuthed();
  await openChecklist(page);
  await openStoryEditor(page);

  // The Earn rail and the explicit approve CTA are the wizard's contract.
  await expect(page.getByText('Earn recommends')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^(Complete & file|Amend & re-file) this step$/ })
  ).toBeVisible();
});

test('filing the story step lands it on the record and the draft is reviewable', async ({
  page
}) => {
  skipUnlessAuthed();
  test.skip(!canMutate, 'Set E2E_FORMATION_WRITES=1 to run the mutating formation e2e.');

  await openChecklist(page);
  await openStoryEditor(page);

  await page.getByRole('button', { name: "Apply Earn's recommendation" }).click();
  await page.getByRole('button', { name: /^(Complete & file|Amend & re-file) this step$/ }).click();

  // The filing animation races the real (atomic) write; only success lands
  // here. A repeat run reads "— amended" with a fresh version on the record.
  await expect(
    page.getByRole('heading', { name: /Your fund story — (filed|amended)/ })
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('On the record')).toBeVisible();

  // The full drafted document, clearly badged Illustrative.
  await page.getByRole('button', { name: 'Review full draft' }).click();
  await expect(page.getByRole('heading', { name: 'Fund narrative' })).toBeVisible();
  await expect(page.getByText('Illustrative').first()).toBeVisible();
  await expect(page.getByText(/Illustrative working draft/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reopen & amend' })).toBeVisible();

  // Back on the checklist the row is honestly Done.
  await openChecklist(page);
  await expect(
    page.getByRole('button').filter({ hasText: 'Your fund story' }).first().getByText(/Filed/)
  ).toBeVisible();
});
