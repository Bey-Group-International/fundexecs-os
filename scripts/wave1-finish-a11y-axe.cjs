/**
 * wave1-finish-a11y-axe.cjs
 * --------------------------------------------------------------------------
 * Runs @axe-core/playwright against the 3 hero Wave-1 surfaces:
 *   • /command-center
 *   • /profile
 *   • /settings
 *
 * Reports WCAG 2.0/2.1 A + AA violations to stdout and to
 * /app/.screenshots/wave1-finish-a11y/axe-report.json so the structured
 * findings can be fed back into CLAUDE_HANDOFF.md.
 *
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 \
 *     node --env-file=.env.local scripts/wave1-finish-a11y-axe.cjs
 */
const { chromium } = require('@playwright/test');
const { AxeBuilder } = require('@axe-core/playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.TEST_USER_PASSWORD;
if (!PASSWORD) {
  console.error('TEST_USER_PASSWORD missing — set it in .env.local.');
  process.exit(1);
}

const OUT_DIR = path.join(process.cwd(), '.screenshots', 'wave1-finish-a11y');
fs.mkdirSync(OUT_DIR, { recursive: true });

const SURFACES = [
  { name: 'command-center', route: '/command-center' },
  { name: 'profile', route: '/profile' },
  { name: 'settings', route: '/settings' }
];

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"]', { timeout: 15_000 });
  await page.fill('input[type="email"]', 'test+investment_firm@fundexecs-staging.dev');
  await page.fill('input[type="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]')
  ]);
}

(async () => {
  console.log(`Wave-1 a11y axe pass → ${OUT_DIR}`);
  console.log(`Base: ${BASE}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();
  const report = { ranAt: new Date().toISOString(), base: BASE, surfaces: {} };

  try {
    await login(page);
    console.log('Logged in.');

    for (const surface of SURFACES) {
      await page.goto(`${BASE}${surface.route}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(600);

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      // Slim down to the fields we actually need.
      const slim = {
        violations: results.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          helpUrl: v.helpUrl,
          tags: v.tags,
          nodes: v.nodes.map((n) => ({
            target: n.target,
            html: n.html.slice(0, 240),
            failureSummary: n.failureSummary
          }))
        })),
        passes: results.passes.length,
        incomplete: results.incomplete.length,
        inapplicable: results.inapplicable.length
      };
      report.surfaces[surface.name] = slim;

      console.log(`\n=== ${surface.name} ===`);
      console.log(
        `  ✓ ${slim.passes} passes · ⚠ ${slim.violations.length} violations · — ${slim.incomplete} incomplete · skipped ${slim.inapplicable}`
      );
      slim.violations.forEach((v) => {
        console.log(
          `    [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'})`
        );
      });
    }

    fs.writeFileSync(path.join(OUT_DIR, 'axe-report.json'), JSON.stringify(report, null, 2));
    console.log(`\nReport: ${path.join(OUT_DIR, 'axe-report.json')}`);
  } catch (err) {
    console.error('Failed:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
