/**
 * A recorded call's meta line, measured in a real browser engine.
 *
 * Written after rendering the page at 400px and looking at it, which is how the
 * defect was found: the line holding the date, the consent note and the mention
 * count is a flex row, and without wrapping its items SHRANK rather than moved.
 * A phone showed a ragged three-column block —
 *
 *   Sep 7, 2:47   · consent   · 14
 *   PM            recorded    mentions
 *
 * — which reads as three broken phrases rather than one sentence about a call.
 * Nothing in the shared layout checks fires on it: nothing escapes the viewport,
 * nothing overlaps, and no two controls read alike. It is simply wrong, and only
 * a layout engine can say so.
 *
 * The measure is `getClientRects().length`: an inline element that fits on one
 * line has exactly one rect, and one that folds across two has two. That is the
 * defect stated as a number rather than as a screenshot to eyeball.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Browser } from "playwright-core";

import { VIEWPORTS, chromiumPath, inspect, pageHtml, report } from "@/test-utils/visual";
import { CallArchive } from "@/app/(app)/meetings/calls/CallArchive";
import type { CallHit, Snippet } from "@/lib/meetings/call-archive";

const exe = chromiumPath();

if (!exe && process.env.CI) {
  throw new Error(
    "Chromium not found and CI=true. The visual checks cannot run — install it " +
      "with `npx playwright install --with-deps chromium`.",
  );
}

const describeVisual = exe ? describe : describe.skip;
if (!exe) {
  console.warn("[visual] Chromium not found — skipping. `npx playwright install chromium`");
}

let browser: Browser;

beforeAll(async () => {
  const { chromium } = require("playwright-core") as typeof import("playwright-core");
  browser = await chromium.launch({ executablePath: exe!, args: ["--no-sandbox"] });
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

const snippet: Snippet = {
  speaker: "Priya Shah",
  parts: [
    { value: "…forty is above where we had it, and I will send the ", match: false },
    { value: "valuation", match: true },
    { value: " memo on Friday.", match: false },
  ],
};

/** The dense row: every meta item present at once, which is the crowded case. */
const CALLS: CallHit[] = [
  {
    id: "c1",
    roomCode: "rec-101",
    title: "Dunbar diligence note",
    at: "2026-09-07T14:47:00.000Z",
    durationSeconds: 754,
    recordingId: "r1",
    summary: "Walked through the outstanding diligence note and agreed who chases counsel.",
    consented: true,
    matches: 14,
    snippet,
  },
  {
    id: "c2",
    roomCode: "rec-102",
    title: "Call",
    at: "2026-09-02T11:05:00.000Z",
    durationSeconds: 128,
    summary: "",
    consented: false,
    matches: 0,
    snippet: null,
  },
];

function archive(): string {
  // Every part of the page at once: the stats line, the filters, a row with a
  // play button and one without, and Load more.
  return renderToStaticMarkup(
    React.createElement(CallArchive, {
      initial: CALLS,
      initialHasMore: true,
      stats: { count: 12, seconds: 15_000, days: 30 },
    }),
  );
}

// Serialised into the page, so it closes over nothing out here.
//
// Measured as HEIGHT against the item's own line-height, and not as
// `getClientRects().length`, which was the first attempt and does not work here:
// these items are flex children, flex children are blockified, and a block box
// whose text wraps still reports one rect. The taller box is what folding
// actually looks like from the outside.
const FOLDED = `() => {
  const out = [];
  for (const line of document.querySelectorAll('[data-call-meta]')) {
    for (const item of line.children) {
      const lineHeight = parseFloat(getComputedStyle(item).lineHeight) || 16;
      const height = item.getBoundingClientRect().height;
      if (height > lineHeight * 1.5) {
        out.push((item.textContent || '').trim().slice(0, 40) +
          ' is ' + Math.round(height) + 'px tall on a ' + Math.round(lineHeight) + 'px line');
      }
    }
  }
  return out;
}`;

async function foldedMetaItems(width: number): Promise<string[]> {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  try {
    await page.setContent(await pageHtml(archive()), { waitUntil: "load" });
    // Invoked, not passed: Playwright evaluates a bare string as an expression,
    // so handing it the source alone yields the function rather than its result —
    // and `undefined` compares unequal to [] in a way that looks like a failure
    // rather than a mistake.
    return (await page.evaluate(`(${FOLDED})()`)) as string[];
  } finally {
    await page.close();
  }
}

/**
 * Widths the meta line is checked at.
 *
 * 360 is added here, and it is the width the defect actually appeared at: the
 * shared VIEWPORTS start at 400, which is the wide end of a phone rather than the
 * narrow one. Measured on the broken version — items were 32px tall on a 16px
 * line at 320, 360 and 375, and 16px at 400. So a check that ran only at 400
 * would have watched this ship on every iPhone SE, every 13 mini and most
 * Android handsets.
 */
const NARROW = 360;

describeVisual("the recorded-call archive's layout", () => {
  for (const width of [NARROW, ...VIEWPORTS.map((v) => v.width)]) {
    it(`keeps each meta item on one line at ${width}px`, async () => {
      expect(await foldedMetaItems(width)).toEqual([]);
    }, 60_000);
  }

  for (const width of [NARROW, 400]) {
    it(`never scrolls sideways and leaves the title room at ${width}px`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        await page.setContent(await pageHtml(archive()), { waitUntil: "load" });
        const m = (await page.evaluate(`(() => {
          const title = document.querySelector('li a span.truncate');
          return {
            scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            title: title ? title.getBoundingClientRect().width : 0,
          };
        })()`)) as { scroll: number; title: number };
        expect(m.scroll).toBeLessThanOrEqual(0);
        // Two 44px buttons beside the row must still leave a readable title.
        expect(m.title).toBeGreaterThanOrEqual(120);
      } finally {
        await page.close();
      }
    }, 60_000);
  }

  for (const { name, width } of VIEWPORTS) {
    it(`has no escaping, overlapping or indistinguishable controls at ${name} (${width}px)`, async () => {
      const issues = await inspect(browser, archive(), { width });
      expect(issues).toEqual([]);
      if (issues.length) throw new Error(report("call archive", width, issues));
    }, 60_000);
  }
});
