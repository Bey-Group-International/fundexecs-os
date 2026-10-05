/**
 * The control bar's fold, running in a real browser.
 *
 * ControlBar.visual.test.ts renders the bar's markup and looks at it, which
 * checks what the breakpoints do. It cannot check the fold at all: the fold is a
 * measurement taken in a layout effect and kept up to date by a ResizeObserver,
 * and server-rendered markup has run neither. So this one builds the component
 * into a bundle, runs it, and asks the browser where the controls ended up.
 *
 * It is here because it earned its place. The fold went past 32 jsdom tests and a
 * mutation sweep carrying a defect that only a real engine showed: with every
 * foldable control moved into More there was nothing left on the bar to measure a
 * control's width by, so the next measurement answered "unknown" — and unknown
 * folds nothing, which brought the whole row back and hung it off both edges of a
 * 320px window. A stub ResizeObserver cannot reproduce it, because it answers
 * before React has committed the first fold.
 *
 * What is asserted is the user's complaint, not an implementation: no control is
 * drawn where it cannot be pressed, and no control is offered in two places at
 * once.
 */
import type { Browser, Page } from "playwright-core";

import { chromiumPath, clientBundle, runningPage } from "@/test-utils/visual";

const exe = chromiumPath();

if (!exe && process.env.CI) {
  throw new Error(
    "Chromium not found and CI=true. The visual checks cannot run — install it " +
      "with `npx playwright install --with-deps chromium`.",
  );
}

const describeVisual = exe ? describe : describe.skip;

/**
 * The busiest bar there is: a host, recording, on a degraded link, with people
 * waiting, unread chat and a hand up. Every optional control is present and the
 * left-hand side is showing both of its notices, so the row has the least room it
 * ever gets.
 */
const ENTRY = `
import React from "react";
import { createRoot } from "react-dom/client";
import { ControlBar } from "@/app/(app)/meetings/[roomId]/CallParts";

const noop = () => {};
const w = window;

// A device chooser with nothing to choose from is a short menu, and a short menu
// fits any window. These are the names that put a camera list off the screen in
// the first place: a manufacturer's full string, which no panel was ever sized
// for.
const LONG = "Logitech BRIO 4K Stream Edition Pro Webcam (046d:085e) — Communications, Default Input Device";
Object.defineProperty(navigator, "mediaDevices", {
  configurable: true,
  value: {
    enumerateDevices: async () => [
      { deviceId: "mic-a", kind: "audioinput", label: LONG + " A", groupId: "g1" },
      { deviceId: "mic-b", kind: "audioinput", label: LONG + " B", groupId: "g2" },
      { deviceId: "cam-a", kind: "videoinput", label: LONG + " C", groupId: "g3" },
    ],
    addEventListener() {},
    removeEventListener() {},
  },
});
const props = {
  micOn: false, camOn: true, shareOn: false, shareStarting: false, isHost: !!w.__isHost, handRaised: true,
  panel: null, canShareDocs: true, participantCount: 12,
  handsUp: 3, handsUpNote: "Rae and 2 others have a hand up", layout: "grid", layoutForced: false,
  chatUnread: 12, waitingCount: w.__isHost ? 4 : 0,
  elapsed: { current: { spans: [], openedAt: null } },
  roomCode: "abc-defg-hij", bwMode: "audio-only", activeMicId: "", activeCamId: "", camStarting: false,
  leaving: false, backgroundActive: true, backgroundBtnRef: { current: null },
  recordingState: "recording", recordingBy: "Alina", recordingStartedAt: Date.now(),
  onToggleMic: noop, onToggleCam: noop, onToggleScreen: noop, onOpenPanel: noop, onLeave: noop,
  onEndForAll: noop, onSwitchMic: noop, onSwitchCam: noop, onSwitchSpeaker: noop, onRaiseHand: noop,
  onReaction: noop, onMuteAll: noop, onToggleLayout: noop, onFlipCamera: noop, onOpenBackgrounds: noop,
  onToggleRecording: noop,
};

const host = document.getElementById("root");
host.setAttribute("style", "position:fixed;left:0;right:0;bottom:0");
createRoot(host).render(React.createElement(ControlBar, props));
// Two frames: one for React to commit, one for the measurement it takes to be
// reflected. Anything asserted before this is racing the first layout effect.
requestAnimationFrame(() => requestAnimationFrame(() => { window.__painted = true; }));
`;

/** Every visible control not wholly inside the window, by its name. */
const OFFSCREEN = function offscreen(): string[] {
  const out: string[] = [];
  const vw = document.documentElement.clientWidth;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("button, [role=img]"))) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue; // hidden at this width
    if (r.left < -1 || r.right > vw + 1) {
      const name = el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "?";
      out.push(`${name} spans ${Math.round(r.left)}–${Math.round(r.right)} of ${vw}`);
    }
  }
  return out;
};

/** The foldable controls that still have a visible button on the bar. */
const ON_BAR = function onBar(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>("button[data-bar-feature]"))
    .filter((el) => !el.closest("[role=menu]") && el.getBoundingClientRect().width > 0)
    .map((el) => el.dataset.barFeature ?? "?");
};

/** Controls visible both on the bar and inside the open menu. */
const OFFERED_TWICE = function offeredTwice(): string[] {
  const seen = (root: ParentNode) =>
    Array.from(root.querySelectorAll<HTMLElement>("[data-bar-feature]"))
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => el.dataset.barFeature ?? "?");
  const menu = document.querySelector("[role=menu]");
  if (!menu) return ["the menu did not open"];
  const inMenu = new Set(seen(menu));
  const bar = Array.from(document.querySelectorAll<HTMLElement>("button[data-bar-feature]"))
    .filter((el) => !el.closest("[role=menu]") && el.getBoundingClientRect().width > 0)
    .map((el) => el.dataset.barFeature ?? "?");
  return bar.filter((f) => inMenu.has(f));
};

describeVisual("Control bar fold, running", () => {
  let browser: Browser;
  let bundle: string;

  beforeAll(async () => {
    const { chromium } = require("playwright-core") as typeof import("playwright-core");
    browser = await chromium.launch({ executablePath: exe!, args: ["--no-sandbox"] });
    bundle = await clientBundle(ENTRY);
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
  });

  const open = (width: number, isHost: boolean): Promise<Page> =>
    runningPage(browser, { bundle, width, globals: { __isHost: isHost } });

  // 320px is a phone that was never on the old bar's list: it fits from 360
  // upward by breakpoint alone, and below that only the fold can save it.
  for (const width of [320, 360, 400, 640, 768, 1024, 1280, 1536]) {
    for (const isHost of [true, false]) {
      it(`leaves every ${isHost ? "host" : "guest"} control pressable at ${width}px`, async () => {
        const page = await open(width, isHost);
        try {
          expect(await page.evaluate(`(${OFFSCREEN})()`)).toEqual([]);
        } finally {
          await page.close();
        }
      }, 60_000);
    }
  }

  /**
   * The check has to be able to fail, or every pass above proves nothing. 200px
   * is narrower than the mic, the camera, More and the exit together, and not one
   * of those four can fold — so the bar cannot be saved and must say so.
   */
  it("still reports a bar that cannot be saved", async () => {
    const page = await open(200, true);
    try {
      const stuck = (await page.evaluate(`(${OFFSCREEN})()`)) as string[];
      expect(stuck.length).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("gives up controls as the window narrows, and takes them back", async () => {
    const wide = await open(1536, true);
    const narrow = await open(400, true);
    try {
      const atWide = (await wide.evaluate(`(${ON_BAR})()`)) as string[];
      const atNarrow = (await narrow.evaluate(`(${ON_BAR})()`)) as string[];
      // Not merely "nothing overflowed": the narrow bar really has fewer
      // controls, and the wide one really has them.
      expect(atNarrow.length).toBeLessThan(atWide.length);
      expect(atWide.length).toBeGreaterThanOrEqual(6);
      // And what is left is still the two that carry live numbers.
      expect(atNarrow).toContain("chat");
    } finally {
      await wide.close();
      await narrow.close();
    }
  }, 60_000);

  for (const width of [360, 1024]) {
    it(`offers no control twice at ${width}px`, async () => {
      const page = await open(width, true);
      try {
        await page.click("button[aria-label='More options']");
        await page.waitForSelector("[role=menu]", { timeout: 5_000 });
        expect(await page.evaluate(`(${OFFERED_TWICE})()`)).toEqual([]);
      } finally {
        await page.close();
      }
    }, 60_000);
  }

  /**
   * The other half of the same fault, and the one the complaint was about: a menu
   * that opens off the edge of the screen is a feature nobody can select.
   *
   * The device chooser is the case that proves it, because its width comes from
   * its contents — a manufacturer's full device name is wider than a phone, and
   * no amount of repositioning can rescue a panel wider than the window. 640px is
   * the narrowest width the chevron is offered at.
   */
  it("keeps a device chooser inside the window, however long the device is called", async () => {
    const page = await open(640, true);
    try {
      await page.click("button[aria-label='Choose microphone']");
      await page.waitForSelector("[role=menu]", { timeout: 5_000 });
      const box = await page.evaluate(`(() => {
        const el = document.querySelector("[role=menu]");
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, vw: document.documentElement.clientWidth, text: el.textContent.length };
      })()`) as { left: number; right: number; vw: number; text: number };
      // The names really are in there — otherwise this measures an empty panel.
      expect(box.text).toBeGreaterThan(100);
      expect(box.left).toBeGreaterThanOrEqual(-1);
      expect(box.right).toBeLessThanOrEqual(box.vw + 1);
      // And the names inside it, which is the same fault one level down: a panel
      // inside the window whose contents are not.
      const spill = (await page.evaluate(`(() => {
        const vw = document.documentElement.clientWidth;
        return [...document.querySelectorAll("[role=menu] *")]
          .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > vw + 1); })
          .map((el) => (el.textContent || "").trim().slice(0, 40));
      })()`)) as string[];
      expect(spill).toEqual([]);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("keeps an opened menu inside the window on a narrow phone", async () => {
    const page = await open(320, true);
    try {
      await page.click("button[aria-label='More options']");
      await page.waitForSelector("[role=menu]", { timeout: 5_000 });
      const menu = await page.evaluate(`(() => {
        const el = document.querySelector("[role=menu]");
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight };
      })()`) as { left: number; right: number; top: number; bottom: number; vw: number; vh: number };
      expect(menu.left).toBeGreaterThanOrEqual(-1);
      expect(menu.right).toBeLessThanOrEqual(menu.vw + 1);
      expect(menu.top).toBeGreaterThanOrEqual(-1);
      expect(menu.bottom).toBeLessThanOrEqual(menu.vh + 1);
      // Every item in it, too — a panel inside the window with items wider than
      // itself is the same fault one level down.
      const items = await page.evaluate(`(() => {
        const vw = document.documentElement.clientWidth;
        return [...document.querySelectorAll("[role=menu] [role=menuitem]")]
          .filter((el) => el.getBoundingClientRect().width > 0)
          .filter((el) => { const r = el.getBoundingClientRect(); return r.left < -1 || r.right > vw + 1; })
          .map((el) => el.textContent.trim());
      })()`) as string[];
      expect(items).toEqual([]);
    } finally {
      await page.close();
    }
  }, 60_000);
});
