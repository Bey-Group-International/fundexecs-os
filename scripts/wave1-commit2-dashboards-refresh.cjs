/**
 * wave1-commit2-dashboards-refresh.cjs
 * --------------------------------------------------------------------------
 * Re-captures the five member-type Dashboard variants AGAINST HEAD 376d70f so
 * the side-rail's new FundProfileRailSummary card is visible on every shot
 * (the previous Commit-2 captures pre-date Commit 3 and rendered an older
 * rail). Also re-takes `rail-real-signals.jpeg` for the same reason.
 *
 * All 5 staging accounts are confirmed at `member_profiles.status = complete`
 * (yarn wave1:complete-test-onboarding). Universal password from .env.local.
 *
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 \
 *     node --env-file=.env.local scripts/wave1-commit2-dashboards-refresh.cjs
 */
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.TEST_USER_PASSWORD;
if (!PASSWORD) {
  console.error('TEST_USER_PASSWORD missing — set it in .env.local.');
  process.exit(1);
}

const OUT_DIR = path.join(process.cwd(), '.screenshots', 'wave1-commit2');
fs.mkdirSync(OUT_DIR, { recursive: true });

/** Persona email → output filename slug. Mirrors the existing Commit-2 names. */
const PERSONAS = [
  { email: 'test+investment_firm@fundexecs-staging.dev', slug: 'firm' },
  { email: 'test+individual_investor@fundexecs-staging.dev', slug: 'individual' },
  { email: 'test+service_provider@fundexecs-staging.dev', slug: 'service-provider' },
  { email: 'test+startup@fundexecs-staging.dev', slug: 'startup' },
  { email: 'test+student@fundexecs-staging.dev', slug: 'student' }
];

async function login(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"]', { timeout: 15_000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]')
  ]);
}

async function logout(page) {
  // Best-effort: clear cookies + storage between personas.
  await page.context().clearCookies();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
  });
}

async function gotoAndSettle(page, route) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(800);
}

async function shot(page, name) {
  const file = path.join(OUT_DIR, `${name}.jpeg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 80, fullPage: false });
  console.log(`  ✓ ${name}.jpeg`);
}

(async () => {
  console.log(`Wave-1 Commit-2 dashboard variant refresh → ${OUT_DIR}`);
  console.log(`Base: ${BASE}`);

  const browser = await chromium.launch({ headless: true });
  try {
    for (const persona of PERSONAS) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1
      });
      const page = await context.newPage();
      try {
        await login(page, persona.email);
        await gotoAndSettle(page, '/command-center');
        await shot(page, `dashboard-${persona.slug}`);
        if (persona.slug === 'firm') {
          // The firm account is the populated workspace — best subject for the
          // rail-real-signals frame (badges + emphasis on Source-of-Truth area).
          await shot(page, 'rail-real-signals');
        }
        await logout(page);
      } finally {
        await context.close();
      }
    }
    console.log('All 6 dashboard variant frames captured.');
  } catch (err) {
    console.error('Failed:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
