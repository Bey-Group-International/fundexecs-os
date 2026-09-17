// test-utils/visual.ts
//
// Layout checks against a real browser engine.
//
// The jsdom component tests assert what the DOM contains. They cannot assert
// anything about where things end up, because jsdom has no layout engine —
// every rect it reports is zero. That gap is not theoretical: two defects
// shipped in #1104 through a fully green CI run, and were found only by
// rendering the page and looking at it. One was five buttons that all read
// "AI DRAFT"; the other was an action button sitting on top of the label it
// belonged to at phone width.
//
// So: server-render the component, paste it into headless Chromium with the
// app's real compiled CSS, and ask the browser where everything actually is.
//
// What this is NOT: a screenshot-diff suite. There are no golden images to
// churn every time a padding changes. It asserts a small set of things that are
// defects under any design — content wider than the viewport, controls sitting
// on top of each other, sibling controls that cannot be told apart.
import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Browser } from "playwright-core";

const run = promisify(execFile);

/** Widths every component is checked at. 400 is the narrow end of a phone. */
export const VIEWPORTS = [
  { name: "mobile", width: 400 },
  { name: "desktop", width: 1280 },
] as const;

export interface VisualIssue {
  kind: "viewport-escape" | "overlap" | "ambiguous-siblings";
  detail: string;
}

// ─── Chromium ────────────────────────────────────────────────────────────────

/**
 * Where Chromium lives, or null when it is not installed.
 *
 * Playwright's own resolution is preferred; the directory scan is the fallback
 * for images that ship a browser at a pinned path (PLAYWRIGHT_BROWSERS_PATH)
 * whose build number does not match what this playwright expects.
 */
export function chromiumPath(): string | null {
  try {
    const { chromium } = require("playwright-core") as typeof import("playwright-core");
    const p = chromium.executablePath();
    if (p && existsSync(p)) return p;
  } catch {
    // fall through to the scan
  }
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return null;
  for (const dir of readdirSync(root)) {
    if (!dir.startsWith("chromium-")) continue;
    const exe = join(root, dir, "chrome-linux", "chrome");
    if (existsSync(exe)) return exe;
  }
  return null;
}

// ─── The app's real stylesheet ───────────────────────────────────────────────

let cssPromise: Promise<string> | null = null;

/**
 * Compile app/globals.css through the project's own Tailwind config.
 *
 * The real stylesheet is the point — checking layout against hand-written CSS
 * would prove nothing about the app. Memoized per process; it takes a few
 * seconds, so the visual project runs single-worker to pay it once.
 */
export function appCss(): Promise<string> {
  cssPromise ??= (async () => {
    const dir = await mkdtemp(join(tmpdir(), "fx-visual-"));
    const out = join(dir, "app.css");
    await run("npx", ["tailwindcss", "-i", "app/globals.css", "-o", out, "--minify"], {
      cwd: process.cwd(),
      maxBuffer: 32 * 1024 * 1024,
    });
    return readFile(out, "utf8");
  })();
  return cssPromise;
}

// next/font sets these to real font families at runtime. Undefined here, text
// would fall back to a default that measures differently from production, so
// point them at the closest generic stacks. Metrics still are not identical —
// this catches structural collisions, not a two-pixel kerning difference.
const FONT_VARS = `
:root{
  --font-display: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
}
`;

export async function pageHtml(markup: string): Promise<string> {
  const css = await appCss();
  return `<!doctype html><html><head><meta charset="utf-8">
<style>${css}</style><style>${FONT_VARS}</style>
</head><body><div id="root">${markup}</div></body></html>`;
}

// ─── The checks ──────────────────────────────────────────────────────────────

// Runs inside the page. Kept as one self-contained function because it is
// serialized across the CDP boundary — it cannot close over anything here.
const COLLECT = `() => {
  // A hidden input is not a control. Counting them made every server-action
  // <form> (hidden inputs + one button) look like a cluster of three, so group
  // detection stopped at the form and never saw the row the buttons share.
  const INTERACTIVE =
    'button,a[href],input:not([type="hidden"]),select,textarea,[role="button"]';
  const issues = [];
  const doc = document.documentElement;

  // Elements sticking out past the viewport.
  //
  // NOT documentElement.scrollWidth: in a setContent document Chromium folds a
  // scroll container's content extent into it, so a table that its own
  // overflow-x-auto wrapper is correctly scrolling reads as a page overflow.
  // (Measured: wrapper clientWidth 398 / scrollWidth 1245, body.scrollWidth
  // 400, documentElement.scrollWidth 1235.) Asking which elements actually
  // stick out, ignoring any that an ancestor clips, says the same thing without
  // the quirk — and names the offender instead of a bare number.
  const clipped = (el) => {
    let p = el.parentElement;
    while (p) {
      const o = getComputedStyle(p).overflowX;
      if (o === 'auto' || o === 'scroll' || o === 'hidden') return true;
      p = p.parentElement;
    }
    return false;
  };
  const escapees = [...document.querySelectorAll('body *')].filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    if (r.right <= doc.clientWidth + 1 && r.left >= -1) return false;
    return !clipped(el);
  });
  for (const el of escapees.slice(0, 5)) {
    const r = el.getBoundingClientRect();
    const cls = (el.getAttribute('class') || '').replace(/\s+/g, '.').slice(0, 60);
    issues.push({
      kind: 'viewport-escape',
      detail: el.tagName.toLowerCase() + (cls ? '.' + cls : '') +
        ' spans ' + Math.round(r.left) + '→' + Math.round(r.right) +
        'px in a ' + doc.clientWidth + 'px viewport',
    });
  }

  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    // Overlays (dialogs, click-away layers, popovers) are meant to sit on top
    // of things. Only normal-flow boxes are checked for collisions.
    if (s.position !== 'static' && s.position !== 'relative') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const label = (el) =>
    (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim();

  const controls = [...document.querySelectorAll(INTERACTIVE)].filter(visible);

  // Elements carrying their own text, so a control landing on a label is seen.
  const texts = [...document.querySelectorAll('body *')].filter((el) => {
    if (el.matches(INTERACTIVE) || el.closest(INTERACTIVE)) return false;
    if (!visible(el)) return false;
    return [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  });

  const overlap = (a, b) => {
    const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    // A shared border or a rounding artefact is not a collision.
    return x > 2 && y > 2;
  };

  const describe = (el) => {
    const name = label(el).slice(0, 40);
    return el.tagName.toLowerCase() + (name ? ' "' + name + '"' : '');
  };

  const seen = new Set();
  for (const c of controls) {
    const cr = c.getBoundingClientRect();
    for (const other of [...controls, ...texts]) {
      if (other === c) continue;
      if (c.contains(other) || other.contains(c)) continue;
      if (!overlap(cr, other.getBoundingClientRect())) continue;
      const key = [describe(c), describe(other)].sort().join(' || ');
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({ kind: 'overlap', detail: key });
    }
  }

  // Controls in one group that read identically.
  //
  // "Group" is the nearest ancestor holding more than one control, not the
  // direct parent: a button wrapped in its own <form> (every server-action
  // button here) is an only child, so grouping by parent put each in a group of
  // one and saw nothing. Walking up to the first ancestor with two or more
  // controls lands on the row or grid a person actually reads as a set.
  //
  // It stops there deliberately. Two table rows both offering "Open" never
  // reach a common ancestor under this rule, because each row's action cluster
  // already holds several controls — and those are fine: the row gives them
  // meaning. What is not fine is several controls side by side in one cluster
  // with the same name and nothing else to tell them apart.
  // Counts only controls that are actually on screen: a group is what a person
  // sees side by side, not what the markup happens to contain.
  const visibleSet = new Set(controls);
  const countVisible = (el) =>
    [...el.querySelectorAll(INTERACTIVE)].filter((x) => visibleSet.has(x)).length;
  const groupOf = (c) => {
    let el = c.parentElement;
    while (el && countVisible(el) < 2) el = el.parentElement;
    return el;
  };
  const byParent = new Map();
  for (const c of controls) {
    const p = groupOf(c);
    if (!p) continue;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(c);
  }
  for (const [, group] of byParent) {
    const counts = new Map();
    for (const c of group) {
      const n = label(c);
      if (!n) continue;
      counts.set(n, (counts.get(n) || 0) + 1);
    }
    for (const [name, n] of counts) {
      if (n > 1) {
        issues.push({
          kind: 'ambiguous-siblings',
          detail: n + ' sibling controls all read "' + name.slice(0, 40) + '"',
        });
      }
    }
  }

  return issues;
}`;

/**
 * Render markup at one width and report what is wrong with the layout.
 *
 * `interact` runs before the checks, for states that only exist after a click
 * (an expanded preview, an opened form).
 */
export async function inspect(
  browser: Browser,
  markup: string,
  opts: { width: number; interact?: (page: import("playwright-core").Page) => Promise<void> },
): Promise<VisualIssue[]> {
  const page = await browser.newPage({ viewport: { width: opts.width, height: 900 } });
  try {
    await page.setContent(await pageHtml(markup), { waitUntil: "load" });
    await opts.interact?.(page);
    // Playwright evaluates a bare string as an expression, so the source has to
    // be invoked — passing COLLECT alone yields the function, not its result.
    return (await page.evaluate(`(${COLLECT})()`)) as VisualIssue[];
  } finally {
    await page.close();
  }
}

/** One readable block naming every issue, for an assertion message. */
export function report(name: string, width: number, issues: VisualIssue[]): string {
  return [
    `${name} at ${width}px — ${issues.length} layout issue${issues.length === 1 ? "" : "s"}:`,
    ...issues.map((i) => `  [${i.kind}] ${i.detail}`),
  ].join("\n");
}
