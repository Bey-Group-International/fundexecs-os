/**
 * The green room, measured in a real browser engine.
 *
 * Two things jsdom cannot see. That the two-column layout holds without a
 * sideways scroll at a phone's width as well as a laptop's. And that the Join
 * button is on screen on a phone without scrolling — it is pinned to the bottom
 * there, because under a full-width preview it used to be a scroll away. And
 * that the folded device pickers take no room at all.
 */
jest.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  useParams: () => ({ roomId: "abc-defg-hij" }),
  useSearchParams: () => new URLSearchParams(),
}));

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Browser } from "playwright-core";

import { chromiumPath, pageHtml } from "@/test-utils/visual";
import { MeetingGreenRoom } from "@/app/(app)/meetings/[roomId]/MeetingGreenRoom";

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

function room(): string {
  return renderToStaticMarkup(
    React.createElement(MeetingGreenRoom, {
      roomCode: "abc-defg-hij",
      isHost: false,
      joining: false,
      displayName: "Rae Okafor-Lindqvist",
      onDisplayNameChange: () => {},
      meetingTitle: "Fund IV quarterly sync",
      onJoin: () => {},
    }),
  );
}

async function measure(width: number, height: number) {
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await page.setContent(await pageHtml(room()), { waitUntil: "load" });
    return (await page.evaluate(`(() => {
      const vw = document.documentElement.clientWidth;
      const join = Array.from(document.querySelectorAll("button")).find((b) => /join meeting/i.test(b.textContent || ""));
      const r = join ? join.getBoundingClientRect() : null;
      return {
        sideways: document.documentElement.scrollWidth - vw,
        joinVisible: !!r && r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= vw,
        foldedHeight: document.getElementById("green-room-devices")?.getBoundingClientRect().height ?? -1,
      };
    })()`)) as { sideways: number; joinVisible: boolean; foldedHeight: number };
  } finally {
    await page.close();
  }
}

describeVisual("Green room layout", () => {
  for (const [width, height] of [[360, 640], [400, 740], [768, 900], [1280, 800]] as const) {
    it(`fits ${width}px with Join on screen`, async () => {
      const m = await measure(width, height);
      expect(m.sideways).toBeLessThanOrEqual(1);
      expect(m.joinVisible).toBe(true);
      // Folded means gone: a utility display class once outranked [hidden]
      // and left an empty bordered box under the summary line.
      expect(m.foldedHeight).toBe(0);
    }, 60_000);
  }
});
