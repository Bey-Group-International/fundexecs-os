/**
 * A control-bar menu whose body arrives after it opens, running in a real browser.
 *
 * room-shared.menu.test.tsx asserts the attachment in jsdom, which has no layout:
 * every rect is zero, so it can check which edge the panel is pinned by and
 * nothing about where the options end up. That is the half that mattered here.
 *
 * The reported fault was the background picker "loading down" with its options
 * off the screen, and it was not the flip logic — that already prefers opening
 * above a bottom bar. It was WHEN the height is read. The picker's body lands
 * after the menu opens (its chunk is loaded dynamically and its saved images come
 * from IndexedDB), so the panel measured at open is nearly empty. Pinned by `top`
 * from that height, everything that arrived afterwards grew downward. Measured
 * here before the fix, at 900x700: the panel's bottom went from 650 to 1162,
 * eight of nine options sat below the bar and seven were off the screen.
 *
 * Only an engine shows this. jsdom reports no size for anything and runs no
 * ResizeObserver, so the growth it is about cannot happen there.
 */
import type { Browser } from "playwright-core";

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
 * A menu on a bar, holding a panel that grows once it has opened.
 *
 * `__rows` is how many options arrive, `__topBar` puts the bar at the top of the
 * window instead of the bottom — the one case that must still open downward — and
 * `__barOffset` puts it part-way down, where the side to open on changes as the
 * panel fills.
 */
const ENTRY = `
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { FloatingMenu } from "@/app/(app)/meetings/[roomId]/room-shared";

function Late() {
  const [rows, setRows] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => setRows((window as any).__rows), 20);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="w-[330px] p-1">
      <p className="px-1 pb-2 text-xs">Background</p>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} data-opt={i} style={{ height: 56, marginBottom: 8, background: "#333" }}>option {i}</div>
      ))}
    </div>
  );
}

function Harness() {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(true); (window as any).__painted = true; }, []);
  const offset = (window as any).__barOffset as number | undefined;
  const bar = (window as any).__topBar
    ? "absolute top-0 left-0 right-0 flex h-16 items-center justify-center"
    : "absolute bottom-0 left-0 right-0 flex h-16 items-center justify-center";
  return (
    <div className="fixed inset-0">
      <div
        className={offset === undefined ? bar : "absolute left-0 right-0 flex h-16 items-center justify-center"}
        style={offset === undefined ? undefined : { top: offset }}
      >
        <button ref={btn} data-anchor>Background</button>
      </div>
      <FloatingMenu open={open} anchorRef={btn} onClose={() => setOpen(false)} minWidth={330}>
        <Late />
      </FloatingMenu>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
`;

interface Geometry {
  panel: { top: number; bottom: number; height: number };
  anchorTop: number;
  viewport: number;
  /** Options drawn over or below the bar the menu hangs off. */
  pastTheBar: number;
  /** Whether the panel is capped and scrollable rather than overflowing. */
  scrolls: boolean;
}

describeVisual("a control-bar menu whose content arrives after it opens", () => {
  let browser: Browser;
  let bundle: string;

  beforeAll(async () => {
    const { chromium } = require("playwright-core") as typeof import("playwright-core");
    browser = await chromium.launch(exe ? { executablePath: exe } : {});
    bundle = await clientBundle(ENTRY);
  }, 180_000);

  afterAll(async () => { await browser?.close(); });

  const settled = async (
    rows: number,
    opts: { topBar?: boolean; barOffset?: number } = {},
  ): Promise<Geometry> => {
    const page = await runningPage(browser, {
      bundle, width: 900, height: 700,
      globals: { __rows: rows, __topBar: opts.topBar ?? false, __barOffset: opts.barOffset },
    });
    try {
      // The content lands on a timer and the reposition it triggers is another
      // frame after that.
      await page.waitForFunction("document.querySelectorAll('[data-opt]').length > 1", null, { timeout: 5_000 });
      await page.waitForTimeout(150);
      return await page.evaluate(() => {
        const panel = document.querySelector("[role=menu]") as HTMLElement;
        const anchor = document.querySelector("[data-anchor]") as HTMLElement;
        const p = panel.getBoundingClientRect();
        const a = anchor.getBoundingClientRect();
        const opts = Array.from(document.querySelectorAll("[data-opt]")) as HTMLElement[];
        return {
          panel: { top: Math.round(p.top), bottom: Math.round(p.bottom), height: Math.round(p.height) },
          anchorTop: Math.round(a.top),
          viewport: window.innerHeight,
          // Measured against the panel's own box, so an option merely scrolled
          // out of a capped panel does not count: that one is reachable.
          pastTheBar: opts.filter((e) => e.getBoundingClientRect().top >= a.top).length,
          scrolls: panel.scrollHeight > panel.clientHeight + 1,
        } satisfies Geometry;
      });
    } finally {
      await page.close();
    }
  };

  it("grows upward, so every option stays clear of the bar", async () => {
    const g = await settled(9);
    // The pin is the bottom edge, just above the bar; the growth went up.
    expect(g.panel.bottom).toBeLessThanOrEqual(g.anchorTop);
    expect(g.panel.top).toBeGreaterThanOrEqual(0);
    expect(g.panel.height).toBeGreaterThan(400);
    expect(g.pastTheBar).toBe(0);
  }, 60_000);

  it("keeps the whole panel on screen, capped and scrollable, when it cannot fit", async () => {
    // Thirty options is taller than the window. The panel may not grow off the
    // top; it has to stop and scroll.
    const g = await settled(30);
    expect(g.panel.top).toBeGreaterThanOrEqual(0);
    expect(g.panel.bottom).toBeLessThanOrEqual(g.viewport);
    expect(g.scrolls).toBe(true);
  }, 60_000);

  it("re-decides which side to open on once the panel is full", async () => {
    // The case the bottom pin alone cannot cover, and the reason the panel's own
    // size is observed. A bar 200px down has ~184px above it and ~428px below.
    // An almost-empty panel fits above, so that is where it opens — and if
    // nothing looks again it stays there, capped at 184px and scrolling, with
    // most of the list hidden behind a scrollbar while twice the room sat
    // unused underneath. Re-measuring flips it to the larger side.
    const g = await settled(30, { barOffset: 200 });
    expect(g.panel.height).toBeGreaterThan(300);
    expect(g.panel.top).toBeGreaterThanOrEqual(g.anchorTop);
    expect(g.panel.bottom).toBeLessThanOrEqual(g.viewport);
  }, 60_000);

  it("still opens downward from a bar at the top of the window", async () => {
    // There is no room above an anchor at the top, and pinning its bottom there
    // would put the panel off-screen. The flip has to survive the change.
    const g = await settled(30, { topBar: true });
    expect(g.panel.top).toBeGreaterThanOrEqual(0);
    expect(g.panel.bottom).toBeLessThanOrEqual(g.viewport);
    expect(g.panel.top).toBeGreaterThanOrEqual(g.anchorTop);
  }, 60_000);
});
