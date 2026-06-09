import { test, expect } from '@playwright/test';

/* ----------------------------------------------------------------------------
 * Reduced-motion tiering smoke (phase 2).
 *
 * Loads the public landing under prefers-reduced-motion: reduce and locks
 * the two-tier policy from app/globals.css and docs/MOTION.md:
 *
 *   1. Decorative classes (fx-aurora, fx-marquee-animate, fx-coin-float, ...)
 *      have animation hard-disabled (`animation-name: none`).
 *   2. Meaningful classes (fx-rise on the page-enter container, etc.) keep
 *      animating, but capped at <= 240 ms (the --dur-standard scale value).
 *   3. The AnimatedNumber count-up snaps directly to its final value.
 *
 * If any tier rule drifts, this suite trips first — well before a human
 * notices the orb pulse vanished or the constellation kept spinning.
 * --------------------------------------------------------------------------*/

test.describe('reduced-motion tiering @reduced-motion', () => {
  // Apply prefers-reduced-motion: reduce to the page before each test. Using
  // emulateMedia() per test (rather than `test.use({ reducedMotion: ... })`)
  // sidesteps a Playwright `Fixtures` type quirk in 1.60 and works at the
  // page level which is what we actually want to assert against.
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('decorative fx-* classes are hard-disabled under reduced motion', async ({ page }) => {
    await page.goto('/');
    // fx-aurora lives on the landing hero. Confirm it has at least one node
    // on the page, then assert the computed animation-name is `none`.
    const aurora = page.locator('.fx-aurora').first();
    await expect(aurora).toBeAttached({ timeout: 10_000 });
    const auroraAnim = await aurora.evaluate((el) => {
      const cs = getComputedStyle(el as HTMLElement);
      return {
        name: cs.animationName,
        duration: cs.animationDuration,
        iterationCount: cs.animationIterationCount
      };
    });
    expect(auroraAnim.name, 'fx-aurora must be off under reduced motion').toBe('none');

    // fx-marquee-animate is the ticker track inside fx-marquee-wrap.
    const marquee = page.locator('.fx-marquee-animate').first();
    if (await marquee.count()) {
      const marqueeAnim = await marquee.evaluate((el) => getComputedStyle(el).animationName);
      expect(marqueeAnim, 'fx-marquee-animate must be off under reduced motion').toBe('none');
    }
  });

  test('meaningful fx-* classes stay on but cap at <= 240 ms', async ({ page }) => {
    await page.goto('/');
    // fx-rise is applied by AppShell on every route. We inject a probe node
    // rather than relying on AppShell internals so the smoke is robust to
    // a future refactor that moves the class. The probe element joins the
    // DOM after navigation, so it picks up the cascade exactly as a real
    // .fx-rise element would.
    const fxRiseAnim = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'fx-rise';
      document.body.appendChild(el);
      const cs = getComputedStyle(el);
      const out = {
        name: cs.animationName,
        duration: cs.animationDuration,
        iterationCount: cs.animationIterationCount
      };
      el.remove();
      return out;
    });
    expect(
      fxRiseAnim.name,
      'fx-rise must use a dedicated reduced-motion keyframe (fx-rise-rm)'
    ).toBe('fx-rise-rm');
    // CSS animation-duration comes back as seconds like "0.4s". Parse to ms.
    const ms = Number(fxRiseAnim.duration.replace(/s$/, '')) * 1000;
    expect(ms, 'meaningful tier must cap at <= --dur-standard (240 ms)').toBeLessThanOrEqual(241);
    expect(fxRiseAnim.iterationCount, 'meaningful tier must run exactly once').toBe('1');

    // Same check for fx-glow-pulse — it carries "live" state and must keep
    // a softened settle under reduced motion.
    const fxGlowAnim = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'fx-glow-pulse';
      document.body.appendChild(el);
      const cs = getComputedStyle(el);
      const out = {
        name: cs.animationName,
        duration: cs.animationDuration,
        iterationCount: cs.animationIterationCount
      };
      el.remove();
      return out;
    });
    expect(fxGlowAnim.name).toBe('fx-glow-pulse-rm');
    const glowMs = Number(fxGlowAnim.duration.replace(/s$/, '')) * 1000;
    expect(glowMs).toBeLessThanOrEqual(241);
    expect(fxGlowAnim.iterationCount).toBe('1');
  });

  test('AnimatedNumber snaps directly to its final value', async ({ page }) => {
    await page.goto('/');
    // The hero displays one or more AnimatedNumber instances. Locate the
    // first and verify its rendered text matches the final value (i.e. no
    // mid-tween value is being shown). We re-read after a short tick to be
    // sure the snap happened (it should be effectively immediate).
    const nums = page.locator('[data-testid="animated-number"], .tabular-nums').first();
    if ((await nums.count()) === 0) {
      // No AnimatedNumber on landing — skip without failing the suite. The
      // snap-under-RM behavior is unit-checked in components/ui/AnimatedNumber
      // and via this e2e on whichever page mounts it.
      test.skip(true, 'No AnimatedNumber on landing; nothing to probe.');
    }
    const first = await nums.textContent();
    await page.waitForTimeout(50);
    const second = await nums.textContent();
    expect(second, 'AnimatedNumber must snap (final value stable)').toBe(first);
  });
});
