/**
 * Layout checks for the Materials & Data Room workspace, in a real browser engine.
 *
 * The workspace is a rail plus a working pane. On a phone the rail stacks above
 * the pane, so what matters there is that nothing is wider than the screen, that
 * the rail does not bury the contents, and that the tabs are thumb-sized.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Browser } from "playwright-core";

import { VIEWPORTS, chromiumPath, inspect, pageHtml, report } from "@/test-utils/visual";
import { RoomWorkspace } from "@/components/build/RoomWorkspace";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));
jest.mock("@/components/build/room-actions", () => ({
  unpublishDocument: jest.fn(),
  publishDocument: jest.fn(),
  moveRoomDocument: jest.fn(),
  setDocumentSignature: jest.fn(),
}));
jest.mock("@/components/build/room-preview-actions", () => ({ loadRoomPreview: jest.fn() }));
// The preview embeds the PDF viewer (import.meta), which jest cannot load and which
// is hidden until its tab is opened. This check is about the rail and the contents.
jest.mock("@/components/build/RoomPreview", () => ({ RoomPreview: () => null }));

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

const LONG = "Fund IV Limited Partnership Agreement — Amended and Restated, including Annex of Side Letters (execution copy)";
const doc = (id: string, name: string) => ({
  id,
  name,
  status: "final",
  hasBody: true,
  isLink: false,
  requireSignature: false,
  hasSignatureBlocks: false,
  signers: [],
});
const sections = [
  { key: "strategy", label: "Investment Strategy & Thesis", docs: [doc("1", LONG), doc("2", "Deck")] },
  { key: "track", label: "Track Record & Performance", docs: [doc("3", "Unbroken" + "x".repeat(70))] },
  { key: "legal", label: "Legal & Compliance", docs: [doc("4", "PPM")] },
  { key: "team", label: "Team", docs: [] },
];

const workspace = () =>
  renderToStaticMarkup(
    React.createElement(
      "div",
      { className: "mx-auto max-w-6xl p-4" },
      React.createElement(RoomWorkspace, {
        roomId: "r1",
        roomName: "Fund IV Data Room",
        roomDescription: "Primary room for institutional allocators and their consultants",
        sections: sections as never,
        available: [],
        warnings: { unfinished: ["2"], empty: [] },
        coverage: { weightedPercent: 62, readyCount: 5, total: 8 },
        activeLinkCount: 3,
        nextGap: "Add audited financials so allocators can complete diligence without asking.",
        sharing: React.createElement("p", null, "sharing"),
        activity: React.createElement("p", null, "activity"),
        previewShares: [],
      }),
    ),
  );

describeVisual("The data room workspace", () => {
  for (const vp of VIEWPORTS) {
    it(`lays out cleanly at ${vp.width}px`, async () => {
      const issues = await inspect(browser, workspace(), { width: vp.width });
      expect(report("Room workspace", vp.width, issues)).toBe(report("Room workspace", vp.width, []));
    });
  }

  it("shows the room's contents within the first screen of a phone", async () => {
    const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
    try {
      await page.setContent(await pageHtml(workspace()), { waitUntil: "load" });
      const top = await page.evaluate(() => {
        const h = Array.from(document.querySelectorAll("h3")).find((e) => e.textContent?.includes("Room contents"))!;
        return Math.round(h.getBoundingClientRect().top);
      });
      expect(top).toBeLessThan(800);
    } finally {
      await page.close();
    }
  });

  it("makes every tab a readable, thumb-sized button on a phone", async () => {
    const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
    try {
      await page.setContent(await pageHtml(workspace()), { waitUntil: "load" });
      const tabs = await page.evaluate(() =>
        ["Contents", "Sharing", "Activity", "Preview as LP"].map((label) => {
          const b = Array.from(document.querySelectorAll("button")).find((e) => e.textContent?.trim().startsWith(label))!;
          const r = b.getBoundingClientRect();
          return { label, h: Math.round(r.height), upper: getComputedStyle(b).textTransform === "uppercase" };
        }),
      );
      for (const t of tabs) {
        expect(`${t.label} ${t.h >= 36}`).toBe(`${t.label} true`);
        expect(`${t.label} ${t.upper}`).toBe(`${t.label} false`);
      }
    } finally {
      await page.close();
    }
  });
});
