/**
 * wave1-commit3-screenshots.cjs
 * --------------------------------------------------------------------------
 * Captures the 7 visual deliverables for Wave-1 Commit 3:
 *
 *   1. fund-profile.jpeg                 — /profile, full surface
 *   2. rail-source-of-truth-summary.jpeg — close-up of the rail showing the
 *                                          new FundProfileRailSummary card
 *   3. earn-dashboard-context.jpeg       — Earn dock open on /command-center
 *   4. earn-fund-profile-context.jpeg    — Earn dock open on /profile
 *   5. earn-pipeline-context.jpeg        — Earn dock open on /pipeline (LP
 *                                          context — drawer-override proof
 *                                          lives in the codebase for the
 *                                          DealDetailDrawer; capturing it
 *                                          requires a seeded open deal)
 *   6. settings-rail.jpeg                — /settings vertical detail rail
 *   7. settings-trust-section.jpeg       — /settings#trust active section
 *
 * Uses the `test+investment_firm@fundexecs-staging.dev` account (member
 * profile already at 'complete' from prior phases).
 *
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 \
 *     node --env-file=.env.local scripts/wave1-commit3-screenshots.cjs
 */
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3100';
const EMAIL = process.env.WAVE1_TEST_EMAIL || 'test+investment_firm@fundexecs-staging.dev';
const PASSWORD = process.env.TEST_USER_PASSWORD;
if (!PASSWORD) {
  console.error('TEST_USER_PASSWORD missing — set it in .env.local.');
  process.exit(1);
}

const OUT_DIR = path.join(process.cwd(), '.screenshots', 'wave1-commit3');
fs.mkdirSync(OUT_DIR, { recursive: true });

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"]', { timeout: 15_000 });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]')
  ]);
}

async function shot(page, name) {
  const file = path.join(OUT_DIR, `${name}.jpeg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 78, fullPage: false });
  console.log(`  ✓ ${name}.jpeg`);
}

async function gotoAndSettle(page, route) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  // Let CSS animations finish and any rise-in micro-anim land.
  await page.waitForTimeout(700);
}

async function openEarnDock(page) {
  // Top-nav primary Ask-Earn affordance is the EarnOrb (bottom-right fixed).
  await page.locator('[data-testid="earn-orb"]').click();
  await page.waitForTimeout(450);
}

(async () => {
  console.log(`Wave-1 Commit-3 screenshots → ${OUT_DIR}`);
  console.log(`Base: ${BASE}`);
  console.log(`Login: ${EMAIL}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1
  });
  const page = await context.newPage();

  try {
    await login(page);
    console.log('Logged in.');

    // 1. Fund Profile — full surface
    await gotoAndSettle(page, '/profile');
    await shot(page, 'fund-profile');

    // 2. Rail close-up — clip the left rail's Source-of-Truth area
    {
      const rail = page.locator('[data-testid="wave1-side-rail"]');
      const ofTruth = page.locator('[data-testid="rail-group-source-of-truth"]');
      // Capture a focused rectangle that includes the summary card + group label.
      const box = await ofTruth.boundingBox();
      const railBox = await rail.boundingBox();
      if (box && railBox) {
        const clip = {
          x: railBox.x,
          y: Math.max(0, box.y - 8),
          width: railBox.width,
          height: box.height + 80
        };
        await page.screenshot({
          path: path.join(OUT_DIR, 'rail-source-of-truth-summary.jpeg'),
          type: 'jpeg',
          quality: 82,
          fullPage: false,
          clip
        });
        console.log('  ✓ rail-source-of-truth-summary.jpeg');
      } else {
        await shot(page, 'rail-source-of-truth-summary');
      }
    }

    // 3. Earn dock — dashboard context
    await gotoAndSettle(page, '/command-center');
    await openEarnDock(page);
    await shot(page, 'earn-dashboard-context');

    // 4. Earn dock — fund-profile context
    await gotoAndSettle(page, '/profile');
    await openEarnDock(page);
    await shot(page, 'earn-fund-profile-context');

    // 5. Earn dock — pipeline context (LP focus)
    await gotoAndSettle(page, '/pipeline');
    await openEarnDock(page);
    await shot(page, 'earn-pipeline-context');

    // 6. Settings — vertical rail (default account section)
    await gotoAndSettle(page, '/settings');
    await shot(page, 'settings-rail');

    // 7. Settings — trust section active (via hash)
    await gotoAndSettle(page, '/settings#trust');
    await shot(page, 'settings-trust-section');

    console.log('All 7 screenshots captured.');
  } catch (err) {
    console.error('Failed:', err);
    // Best-effort dump for debugging.
    try {
      await page.screenshot({ path: path.join(OUT_DIR, '_failure.jpeg'), type: 'jpeg' });
    } catch {}
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
