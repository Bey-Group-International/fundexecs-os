/**
 * Layout checks for the Inbox list, in a real browser engine.
 *
 * jsdom cannot say whether a long sender or subject pushes a row past a phone's
 * edge, or how big a tap target really is. Each check names something that is a
 * defect under any design.
 */
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("next/dynamic", () => () => function ThreadConversationStub() { return null; });
jest.mock("./actions", () => ({
  actOnThread: jest.fn(),
  shareCommandCenter: jest.fn(),
  setThreadStatus: jest.fn(),
  deleteThreadAction: jest.fn(),
  clearInbox: jest.fn(),
  assignThread: jest.fn(),
  setThreadStar: jest.fn(),
  bulkThreadAction: jest.fn(),
  snoozeThread: jest.fn(),
}));

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Browser } from "playwright-core";

import { VIEWPORTS, chromiumPath, inspect, pageHtml, report } from "@/test-utils/visual";
import { InboxBoard, type InboxCardData } from "./InboxBoard";

const exe = chromiumPath();
if (!exe && process.env.CI) {
  throw new Error(
    "Chromium not found and CI=true. The visual checks cannot run — install it " +
      "with `npx playwright install --with-deps chromium`.",
  );
}
const describeVisual = exe ? describe : describe.skip;

let browser: Browser;
beforeAll(async () => {
  const { chromium } = require("playwright-core") as typeof import("playwright-core");
  browser = await chromium.launch({ executablePath: exe!, args: ["--no-sandbox"] });
}, 120_000);
afterAll(async () => {
  await browser?.close();
});

function card(id: string, over: Partial<InboxCardData> = {}): InboxCardData {
  return {
    id,
    channel: "gmail",
    channelLabel: "Gmail",
    channelIcon: "✉",
    category: "messaging",
    subject: `Subject ${id}`,
    counterparty: `Sender ${id}`,
    summary: `Earn summary for ${id}`,
    snippet: `Latest message in ${id}`,
    lastMessageAt: "2026-01-05T15:00:00.000Z",
    intent: null,
    priority: 50,
    bucket: "now",
    tab: "focused",
    unread: false,
    starred: false,
    status: "open",
    snoozedUntil: null,
    meetingAt: null,
    meetingUrl: null,
    context: null,
    assignee: null,
    meeting: null,
    connected: true,
    suggested: null,
    quickReplies: [],
    nudge: null,
    canShare: false,
    shareTier: 2,
    draft: null,
    ...over,
  };
}

const LONG = "Fund IV Amended & Restated Limited Partnership Agreement (Execution Copy) — Annex of Side Letters";
const board = () =>
  renderToStaticMarkup(
    React.createElement(
      "div",
      { className: "mx-auto max-w-6xl p-4" },
      React.createElement(InboxBoard, {
        cards: [
          card("a", { unread: true, counterparty: "Alexandria Montgomery-Featherstonehaugh III", subject: LONG, snippet: LONG }),
          card("b", { starred: true, draft: { body: "x", origin: "Meeting follow-up", revision: "1" } }),
          card("c"),
        ],
        teammates: [],
      }),
    ),
  );

describeVisual("The Inbox list", () => {
  for (const vp of VIEWPORTS) {
    it(`lays out cleanly at ${vp.width}px, with long names and subjects`, async () => {
      const issues = await inspect(browser, board(), { width: vp.width });
      expect(report("inbox list", vp.width, issues)).toBe(report("inbox list", vp.width, []));
    });
  }

  it("gives each row's select box and star a thumb-sized tap target on a phone", async () => {
    const page = await browser.newPage({ viewport: { width: 400, height: 900 } });
    try {
      await page.setContent(await pageHtml(board()), { waitUntil: "load" });
      const sizes = await page.evaluate(() => {
        const box = (el: Element | null) => {
          const r = el?.getBoundingClientRect();
          return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null;
        };
        const label = document.querySelector("li label")!;
        const star = document.querySelector("li button[aria-pressed]");
        return { label: box(label), star: box(star) };
      });
      expect(sizes.label!.w).toBeGreaterThanOrEqual(30);
      expect(sizes.label!.h).toBeGreaterThanOrEqual(30);
      expect(sizes.star!.w).toBeGreaterThanOrEqual(30);
      expect(sizes.star!.h).toBeGreaterThanOrEqual(30);
    } finally {
      await page.close();
    }
  });
});
