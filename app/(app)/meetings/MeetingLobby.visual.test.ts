/**
 * The lobby toolbar, measured in a real browser engine: one wrapping row of
 * New meeting, Calls, Calendar, the booking link and the code field. jsdom
 * cannot say whether that still fits a phone without a sideways scroll, or
 * whether the code field gets a usable width once the booking link joined the
 * row.
 */
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Browser } from "playwright-core";

import { chromiumPath, pageHtml } from "@/test-utils/visual";
import { MeetingLobby } from "@/app/(app)/meetings/MeetingLobby";

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

// The booking link as the toolbar draws it at rest, with a request waiting:
// the widest it gets.
const BOOKING = React.createElement(
  React.Fragment,
  null,
  React.createElement("button", { className: "fx-btn shrink-0 rounded-lg border min-h-11 px-3 text-sm sm:min-h-10" }, "2 booking requests"),
  React.createElement("button", { className: "fx-btn flex shrink-0 items-center gap-2 rounded-lg border min-h-11 px-3 text-sm sm:min-h-10" }, "Copy booking link"),
  React.createElement("button", { className: "fx-btn shrink-0 rounded-lg border min-h-11 px-3 text-sm sm:min-h-10" }, "Availability"),
);

async function measure(width: number) {
  const page = await browser.newPage({ viewport: { width, height: 700 } });
  try {
    const markup = renderToStaticMarkup(React.createElement(MeetingLobby as React.ComponentType<{ booking?: React.ReactNode }>, { booking: BOOKING }));
    await page.setContent(await pageHtml(`<div style="padding:16px">${markup}</div>`), { waitUntil: "load" });
    return (await page.evaluate(`(() => {
      const vw = document.documentElement.clientWidth;
      const input = document.querySelector('input[aria-label="Meeting code or link"]');
      return {
        sideways: document.documentElement.scrollWidth - vw,
        inputWidth: input ? input.getBoundingClientRect().width : 0,
      };
    })()`)) as { sideways: number; inputWidth: number };
  } finally {
    await page.close();
  }
}

describeVisual("Lobby toolbar layout", () => {
  for (const width of [360, 400, 768, 1024, 1280]) {
    it(`fits ${width}px with a usable code field`, async () => {
      const m = await measure(width);
      expect(m.sideways).toBeLessThanOrEqual(1);
      expect(m.inputWidth).toBeGreaterThanOrEqual(150);
    }, 60_000);
  }
});
