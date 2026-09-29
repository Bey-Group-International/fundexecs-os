/**
 * The meeting log's rows, measured in a real browser engine.
 *
 * Written because of what the log just gained. A searched row now carries a
 * SNIPPET — a sentence out of a transcript, other people's words, of a length
 * nobody on this side chooses — sitting in a row that already holds a title, a
 * date, three counts and an attendee badge. jsdom asserts the snippet is in the
 * DOM; every rect it reports is zero, so it cannot say whether the row it lands
 * in is still a row at phone width.
 *
 * That gap is the reason this harness exists: two defects shipped through a
 * green CI run in #1104 and were found only by rendering the page and looking at
 * it. So this renders the list and asks the browser where everything actually is.
 *
 * The hostile case on purpose: a long untruncated title, a long speaker name, a
 * snippet with a long unbroken token in it, and the word marked mid-sentence.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Browser } from "playwright-core";

import { VIEWPORTS, chromiumPath, inspect, pageHtml, report } from "@/test-utils/visual";
import { MeetingLogs } from "@/app/(app)/meetings/MeetingLogs";
import type { LoggedMeeting } from "@/lib/meetings/meeting-log";
import type { Snippet } from "@/lib/meetings/call-archive";

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
  speaker: "Priya Shah-Lindqvist",
  parts: [
    { value: "…forty is above where we had it, and the file they sent is ", match: false },
    { value: "valuation", match: true },
    { value: "-memo-fund-iv-2026-Q3-final-v4-SIGNED.pdf, which nobody can open.", match: false },
  ],
};

function row(over: Partial<LoggedMeeting & { hit: unknown }> = {}) {
  return {
    id: "m1",
    roomCode: "dun-bar-42",
    title: "Dunbar Capital — Series B follow-up with the whole syndicate and counsel",
    occurredAt: "2026-09-07T14:47:00.000Z",
    durationMinutes: 147,
    attendeeCount: 12,
    counts: { keyPoints: 6, decisions: 4, actionItems: 5 },
    hasReport: true,
    canRegenerate: true,
    attended: true,
    isHost: true,
    ...over,
  } as LoggedMeeting;
}

/** The list as the server renders it, before anything has been clicked. */
function list(meetings: LoggedMeeting[]): string {
  return renderToStaticMarkup(React.createElement(MeetingLogs, { meetings }));
}

/**
 * Every element that scrolls sideways, named by the text that did it.
 *
 * Separate from the shared viewport-escape check, and for the reason the chat
 * panel needed the same thing: a `truncate` or an `overflow-y-auto` ancestor
 * clips, so a row that has quietly become a sideways scroller never bursts out
 * of the page — it just takes its content off-screen where nobody drags to find
 * it.
 */
async function sidewaysScrollers(markup: string, width: number): Promise<string[]> {
  const page = await browser.newPage({ viewport: { width, height: 1400 } });
  try {
    await page.setContent(await pageHtml(markup), { waitUntil: "load" });
    return (await page.evaluate(`(${COLLECT})()`)) as string[];
  } finally {
    await page.close();
  }
}

// Serialised into the page, so it closes over nothing out here. One pixel of
// slack because sub-pixel layout rounds against us at some widths.
//
// `auto` and `scroll` only, which the first run of this test taught: the row's
// title and subtitle are `truncate`, and truncation is overflow HIDDEN plus an
// ellipsis — content wider than the box by design, reported by scrollWidth, and
// not draggable. Flagging those made the check fire on the feature. What is worth
// failing over is a box that became scrollable sideways, because then the row's
// content goes off-screen where nobody looks for it.
const COLLECT = function collect(): string[] {
  const out: string[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    const overflowX = getComputedStyle(el).overflowX;
    if (overflowX !== "auto" && overflowX !== "scroll") continue;
    const label = (el.textContent ?? "").trim().slice(0, 60);
    out.push(`${el.tagName.toLowerCase()} (${el.scrollWidth}>${el.clientWidth}) “${label}”`);
  }
  return out;
};

/**
 * 360 as well as the shared widths: VIEWPORTS starts at 400, which is the wide
 * end of a phone. The sibling check on the call archive found a real fold at 375
 * and below that 400 could not see.
 */
const WIDTHS = [{ name: "narrow", width: 360 }, ...VIEWPORTS];

describeVisual("the meeting log's layout", () => {
  for (const { name, width } of WIDTHS) {
    it(`holds a plain list together at ${name} (${width}px)`, async () => {
      const markup = list([row(), row({ id: "m2", title: "Untitled meeting", attendeeCount: 0, hasReport: false })]);
      const issues = await inspect(browser, markup, { width });
      expect(issues).toEqual([]);
      if (issues.length) throw new Error(report("meeting log", width, issues));
    }, 60_000);

    it(`keeps a searched row a row at ${name} (${width}px)`, async () => {
      // The snippet is the new element and the untested one: a sentence of
      // somebody else's, with a filename in it, under a title that is already
      // long.
      const markup = list([
        row({ hit: { reason: "transcript", matches: 14, snippet } }),
        row({ id: "m2", title: "Short one", hit: { reason: "metadata", matches: 0, snippet: null } }),
      ]);
      const issues = await inspect(browser, markup, { width });
      expect(issues).toEqual([]);
      if (issues.length) throw new Error(report("meeting log, searched", width, issues));
    }, 60_000);

    it(`does not turn a row into a sideways scroller at ${name} (${width}px)`, async () => {
      const markup = list([row({ hit: { reason: "transcript", matches: 14, snippet } })]);
      expect(await sidewaysScrollers(markup, width)).toEqual([]);
    }, 60_000);
  }
});
