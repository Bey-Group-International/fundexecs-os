/**
 * wave1-finish-mobile-sweep.cjs
 * --------------------------------------------------------------------------
 * Captures the 5 Wave-1 surfaces at 390×844 (iPhone 12-ish viewport) so we
 * can spot overflow / clipped text / stacked-badge issues on mobile.
 *
 * Saves to /app/.screenshots/wave1-finish-mobile/. Best-effort; any surface
 * that needs deeper redesign gets noted in /app/memory/CLAUDE_HANDOFF.md.
 *
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 \
 *     node --env-file=.env.local scripts/wave1-finish-mobile-sweep.cjs
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

const OUT_DIR = path.join(process.cwd(), '.screenshots', 'wave1-finish-mobile');
fs.mkdirSync(OUT_DIR, { recursive: true });

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

async function gotoAndSettle(page, route) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(700);
}

async function shot(page, name, fullPage = false) {
  const file = path.join(OUT_DIR, `${name}.jpeg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 80, fullPage });
  console.log(`  ✓ ${name}.jpeg`);
}

async function detectHorizontalOverflow(page) {
  // Returns true if document.documentElement.scrollWidth > viewport.width.
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
}

(async () => {
  console.log(`Wave-1 finish mobile sweep → ${OUT_DIR}`);
  console.log(`Base: ${BASE}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
  });
  const page = await context.newPage();
  const findings = {};

  try {
    await login(page, 'test+investment_firm@fundexecs-staging.dev');
    console.log('Logged in as firm.');

    // 1. /command-center (firm)
    await gotoAndSettle(page, '/command-center');
    await shot(page, 'command-center-firm', true);
    findings['command-center-firm'] = { hOverflow: await detectHorizontalOverflow(page) };

    // 2. Open mobile rail (sheet) — robust open via the testid; fall back to
    //    poking the click handler via JS evaluate if Playwright's locator
    //    races with hydration.
    let railOpened = false;
    const menuBtn = page.locator('[data-testid="topnav-menu-btn"]');
    try {
      await menuBtn.waitFor({ state: 'attached', timeout: 4000 });
      await menuBtn.first().click({ force: true });
      railOpened = true;
    } catch {
      // Fallback — query the DOM directly.
      railOpened = await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="topnav-menu-btn"]');
        if (!btn) return false;
        btn.click();
        return true;
      });
    }
    if (railOpened) {
      await page.waitForTimeout(450);
      await shot(page, 'rail-mobile-sheet', false);
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(300);
    } else {
      console.log('  ⚠ topnav menu button not openable — skipping rail sheet shot');
    }

    // 3. /profile (firm)
    await gotoAndSettle(page, '/profile');
    await shot(page, 'profile', true);
    findings['profile'] = { hOverflow: await detectHorizontalOverflow(page) };

    // 4. /settings collapsed
    await gotoAndSettle(page, '/settings');
    await shot(page, 'settings-collapsed', false);
    findings['settings-collapsed'] = { hOverflow: await detectHorizontalOverflow(page) };

    // 5. /settings#trust expanded
    await gotoAndSettle(page, '/settings#trust');
    await shot(page, 'settings-trust', true);
    findings['settings-trust'] = { hOverflow: await detectHorizontalOverflow(page) };

    // 6. Top nav collapsed — capture the header band only
    await gotoAndSettle(page, '/command-center');
    const topNav = page.locator('[data-testid="wave1-top-nav"]').first();
    if ((await topNav.count()) > 0) {
      const box = await topNav.boundingBox();
      if (box) {
        await page.screenshot({
          path: path.join(OUT_DIR, 'top-nav.jpeg'),
          type: 'jpeg',
          quality: 82,
          clip: { x: 0, y: 0, width: 390, height: Math.min(160, box.height + 40) }
        });
        console.log('  ✓ top-nav.jpeg');
      }
    }

    // 7. Try a second persona for variety (startup — different operate row)
    await page.context().clearCookies();
    await login(page, 'test+startup@fundexecs-staging.dev');
    await gotoAndSettle(page, '/command-center');
    await shot(page, 'command-center-startup', true);
    findings['command-center-startup'] = { hOverflow: await detectHorizontalOverflow(page) };

    fs.writeFileSync(path.join(OUT_DIR, '_findings.json'), JSON.stringify(findings, null, 2));
    console.log('\nFindings:');
    console.log(JSON.stringify(findings, null, 2));
  } catch (err) {
    console.error('Failed:', err);
    try {
      await page.screenshot({ path: path.join(OUT_DIR, '_failure.jpeg'), type: 'jpeg' });
    } catch {}
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
