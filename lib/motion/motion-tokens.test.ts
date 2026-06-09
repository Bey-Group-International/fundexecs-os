import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { MOTION_DURATIONS_S, MOTION_EASING } from '../../components/dashboard/command/motion';

/* ----------------------------------------------------------------------------
 * Motion-token drift regression suite.
 *
 * The CSS motion tokens in `app/globals.css` and their JS twins in
 * `components/dashboard/command/motion.ts` MUST stay byte-equivalent — a
 * silent drift would mean the same animation reads one tempo in CSS and
 * another in motion/react. These tests parse the CSS file at runtime and
 * assert that every JS twin matches the corresponding `--dur-*` (in ms) or
 * `--ease-*` token. Pure functions only — no DOM, no network.
 *
 * If you add a new token, add it to BOTH files in the same commit. This
 * suite will fail loudly if you forget.
 * --------------------------------------------------------------------------*/

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = resolve(HERE, '..', '..', 'app', 'globals.css');
const CSS = readFileSync(CSS_PATH, 'utf8');

/** Extract the value of a `--ease-*` or `--dur-*` declaration from globals.css.
 *  Returns the raw value string (trimmed, no trailing `;`). Throws if the
 *  token isn't declared — that's a real drift signal, not a missing test
 *  artifact, so it's surfaced as the failure. */
function readCssToken(name: string): string {
  const re = new RegExp(`--${name}\\s*:\\s*([^;]+);`);
  const m = CSS.match(re);
  if (!m) throw new Error(`CSS token --${name} not declared in app/globals.css`);
  return m[1].trim();
}

/** Parse a CSS ms string (e.g. "420ms") to a number. */
function msToNumber(value: string): number {
  const m = value.match(/^(\d+(?:\.\d+)?)ms$/);
  if (!m) throw new Error(`Expected an "Nms" duration, got: ${value}`);
  return Number(m[1]);
}

test('every JS duration matches its CSS twin (value × 1000)', () => {
  // Map each JS key to the CSS token name (kebab-case). Add entries here
  // when a new duration token is introduced. Keep in lockstep with
  // MOTION_DURATIONS_S and the docs/MOTION.md table.
  const pairs: Array<[keyof typeof MOTION_DURATIONS_S, string]> = [
    ['instant', 'dur-instant'],
    ['quick', 'dur-quick'],
    ['standard', 'dur-standard'],
    ['status', 'dur-status'],
    ['page', 'dur-page'],
    ['celebrate', 'dur-celebrate'],
    ['collapse', 'dur-collapse'],
    ['think', 'dur-think'],
    ['celebrateGlow', 'dur-celebrate-glow'],
    ['cascade', 'dur-cascade'],
    ['onpoint', 'dur-onpoint'],
    ['glow', 'dur-glow'],
    ['orbPulse', 'dur-orb-pulse'],
    ['sweep', 'dur-sweep'],
    ['coinFloat', 'dur-coin-float'],
    ['textShimmer', 'dur-text-shimmer'],
    ['gridPan', 'dur-grid-pan'],
    ['aurora', 'dur-aurora'],
    ['spinOuter', 'dur-spin-outer'],
    ['spinInner', 'dur-spin-inner'],
    ['marquee', 'dur-marquee']
  ];

  // The JS map and the CSS file MUST cover the same set of tokens — assert
  // both directions so a one-sided addition trips the test.
  const cssDurNames = [...CSS.matchAll(/--(dur-[a-z-]+)\s*:/g)].map((m) => m[1]);
  const jsCovered = new Set(pairs.map(([, css]) => css));
  for (const css of cssDurNames) {
    assert.ok(
      jsCovered.has(css),
      `CSS declares --${css} but no MOTION_DURATIONS_S entry covers it. Add the JS twin in components/dashboard/command/motion.ts and a row in this test.`
    );
  }
  assert.equal(jsCovered.size, cssDurNames.length, 'duration token count drift');

  for (const [jsKey, cssName] of pairs) {
    const cssValue = readCssToken(cssName);
    const cssMs = msToNumber(cssValue);
    const jsSeconds = MOTION_DURATIONS_S[jsKey];
    const jsMs = jsSeconds * 1000;
    // Use a tight tolerance for floating-point — 0.5ms is well below any
    // perceptual threshold and avoids spurious failures from 0.42 * 1000.
    assert.ok(
      Math.abs(jsMs - cssMs) < 0.5,
      `Duration drift on ${jsKey}: JS ${jsSeconds}s (= ${jsMs}ms) != CSS --${cssName} (= ${cssMs}ms)`
    );
  }
});

test('every JS easing matches its CSS twin', () => {
  // The four physical curves used across the system. Aliased semantic tokens
  // (entrance, exit) are checked separately below to confirm they resolve to
  // the same underlying value as `standard`.
  const STANDARD = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

  // Direct (non-aliased) tokens — assert exact CSS-value equality.
  assert.equal(
    readCssToken('ease-standard'),
    STANDARD,
    '--ease-standard must be cubic-bezier(0.22, 0.61, 0.36, 1)'
  );
  assert.equal(
    readCssToken('ease-emphasize'),
    'ease-in-out',
    '--ease-emphasize must be ease-in-out'
  );
  assert.equal(readCssToken('ease-soft-out'), 'ease-out', '--ease-soft-out must be ease-out');
  assert.equal(readCssToken('ease-linear'), 'linear', '--ease-linear must be linear');

  // Aliased tokens — declared as `var(--ease-standard)` in CSS so they
  // resolve to the same value at runtime. We check that the alias is in
  // place; a future PR that diverges them must also update this test.
  assert.equal(
    readCssToken('ease-entrance'),
    'var(--ease-standard)',
    '--ease-entrance must alias --ease-standard until phase 2 gives entrances a distinct curve'
  );
  assert.equal(
    readCssToken('ease-exit'),
    'var(--ease-standard)',
    '--ease-exit must alias --ease-standard until phase 2 gives exits a distinct curve'
  );

  // JS side — assert the values mirror the CSS resolution.
  assert.deepEqual(
    MOTION_EASING.standard,
    [0.22, 0.61, 0.36, 1],
    'MOTION_EASING.standard must mirror the cubic-bezier values'
  );
  assert.deepEqual(
    MOTION_EASING.entrance,
    [0.22, 0.61, 0.36, 1],
    'MOTION_EASING.entrance must mirror MOTION_EASING.standard (alias)'
  );
  assert.deepEqual(
    MOTION_EASING.exit,
    [0.22, 0.61, 0.36, 1],
    'MOTION_EASING.exit must mirror MOTION_EASING.standard (alias)'
  );
  assert.equal(MOTION_EASING.emphasize, 'easeInOut');
  assert.equal(MOTION_EASING.softOut, 'easeOut');
  assert.equal(MOTION_EASING.linear, 'linear');
});

test('no inlined timing values remain in fx-* animation declarations', () => {
  // Every `animation:` shorthand on an `.fx-*` class must consume a token.
  // The `prefers-reduced-motion` neutralizer (`animation-duration: 0.001ms`)
  // is intentionally a literal — see the comment in app/globals.css. We
  // bound the scan to lines that begin an `fx-*` rule.
  const fxAnimLines = [...CSS.matchAll(/animation:\s+fx-[\w-]+\s+([^;]+);/g)].map((m) => m[1]);
  for (const line of fxAnimLines) {
    assert.ok(
      line.includes('var(--dur-'),
      `fx-* animation must consume a --dur-* token (got: "${line.trim()}")`
    );
    assert.ok(
      line.includes('var(--ease-'),
      `fx-* animation must consume an --ease-* token (got: "${line.trim()}")`
    );
    assert.ok(
      !/\b\d+(?:\.\d+)?(?:ms|s)\b/.test(line),
      `fx-* animation must not contain an inlined duration (got: "${line.trim()}")`
    );
    assert.ok(
      !/cubic-bezier\(/.test(line),
      `fx-* animation must not contain an inlined bezier (got: "${line.trim()}")`
    );
  }
});
