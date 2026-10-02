/**
 * The control bar, measured in a real browser engine.
 *
 * jsdom lays nothing out, so whether the reorganised bar actually fits a phone
 * — the busiest case: a host, recording, on a weak link, with people waiting,
 * unread chat and a hand up — is a question for a layout engine. A control
 * pushed past the right edge of a phone is a control the host cannot press,
 * and on this bar the right-most one is End.
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
import { ControlBar } from "@/app/(app)/meetings/[roomId]/CallParts";

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

const noop = () => {};

function bar(isHost: boolean): string {
  return renderToStaticMarkup(
    React.createElement(ControlBar, {
      micOn: false, camOn: true, shareOn: false, shareStarting: false, isHost, handRaised: true,
      panel: null, canShareDocs: true, participantCount: 12,
      handsUp: 3, handsUpNote: "Rae and 2 others have a hand up", layout: "grid", layoutForced: false,
      chatUnread: 12, waitingCount: isHost ? 4 : 0,
      elapsed: { current: { spans: [], openedAt: null } },
      roomCode: "abc-defg-hij", bwMode: "audio-only", activeMicId: "", activeCamId: "", camStarting: false,
      leaving: false, backgroundActive: true, backgroundBtnRef: { current: null },
      recordingState: "recording", recordingBy: "Alina", recordingStartedAt: Date.now(),
      onToggleMic: noop, onToggleCam: noop, onToggleScreen: noop, onOpenPanel: noop, onLeave: noop,
      onEndForAll: noop, onSwitchMic: noop, onSwitchCam: noop, onSwitchSpeaker: noop, onRaiseHand: noop,
      onReaction: noop, onMuteAll: noop, onToggleLayout: noop, onFlipCamera: noop, onOpenBackgrounds: noop,
      onToggleRecording: noop,
    }),
  );
}

/** Every visible control that is not wholly on screen, by its name. */
async function offscreen(markup: string, width: number): Promise<string[]> {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  try {
    await page.setContent(await pageHtml(`<div style="position:fixed;left:0;right:0;bottom:0">${markup}</div>`), { waitUntil: "load" });
    return (await page.evaluate(`(${COLLECT})()`)) as string[];
  } finally {
    await page.close();
  }
}

// Serialised into the page. One pixel of slack for sub-pixel rounding.
const COLLECT = function collect(): string[] {
  const out: string[] = [];
  const vw = document.documentElement.clientWidth;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("button, [role=img]"))) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue; // display:none at this width
    if (r.left < -1 || r.right > vw + 1) {
      out.push(`${el.getAttribute("aria-label") ?? el.textContent?.trim()} spans ${Math.round(r.left)}–${Math.round(r.right)} of ${vw}`);
    }
  }
  if (document.documentElement.scrollWidth > vw + 1) out.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${vw}`);
  return out;
};

describeVisual("Control bar layout", () => {
  for (const width of [360, 400, 640, 768, 1024, 1280, 1536]) {
    for (const host of [true, false]) {
      it(`keeps every ${host ? "host" : "guest"} control on screen at ${width}px`, async () => {
        expect(await offscreen(bar(host), width)).toEqual([]);
      }, 60_000);
    }
  }

  // The control: the check has to be able to fail, or the passes above prove
  // nothing. The same bar squeezed to an impossible width must report.
  it("would notice a control pushed off screen", async () => {
    expect((await offscreen(bar(true), 200)).length).toBeGreaterThan(0);
  }, 60_000);
});
