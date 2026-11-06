/**
 * Layout checks for the deal screens, in a real browser engine: the pipeline
 * table, the signal feed with its filter chips, and the sector heatmap.
 *
 * jsdom cannot tell whether a long deal name pushes the page past a phone's
 * edge, or how big a filter chip really is. Each check names something that is a
 * defect under any design.
 */
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }));
jest.mock("@/app/(app)/[hub]/[module]/actions", () => ({
  advanceDealStageAction: jest.fn(),
  createModuleRow: jest.fn(),
}));
jest.mock("@/components/source/SourceDeleteControls", () => ({ DeleteDealBtn: () => null }));
jest.mock("@/components/source/InlineContactEdit", () => ({ InlineContactEdit: () => null }));
jest.mock("@/components/source/PipelineStageOverlay", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/source/VerificationBadge", () => ({ VerificationPill: () => null }));

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Browser } from "playwright-core";

import { VIEWPORTS, chromiumPath, inspect, pageHtml, report } from "@/test-utils/visual";
import { DealPipeline, type DealEntry } from "@/components/source/DealPipeline";
import { DealSignalFeed } from "@/components/intelligence/DealSignalFeed";
import { SectorHeatmap } from "@/components/intelligence/SectorHeatmap";
import type { DealSignal, HeatmapCell } from "@/lib/deal-intelligence";

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

const wrap = (inner: React.ReactElement) =>
  renderToStaticMarkup(React.createElement("div", { className: "mx-auto max-w-6xl p-4" }, inner));

const LONG = "Meridian Logistics Holdings — Series C Growth Equity Recapitalisation (Phase Two)";
const deal = (id: string, over: Partial<DealEntry> = {}): DealEntry => ({
  id,
  name: `Deal ${id}`,
  stage: "diligence",
  assetClass: "Private credit",
  geography: "United States",
  targetAmount: 48_000_000,
  thesisFit: 72,
  expectedClose: "2026-12-15",
  website: "https://example.com",
  verified: true,
  confidence: 90,
  provider: "manual",
  ...over,
});

const pipeline = () =>
  wrap(
    React.createElement(DealPipeline, {
      deals: [deal("a", { name: LONG, assetClass: "Real estate — multifamily value-add" }), deal("b"), deal("c", { stage: "ic_review" })],
      enrichCap: 25,
      pipelineStages: [],
    } as never),
  );

const signal = (id: string, over: Partial<DealSignal> = {}): DealSignal => ({
  id,
  signalType: "funding_round",
  title: LONG,
  sector: "Logistics",
  geography: "United States",
  relevanceScore: 75,
  thesisMatchScore: 65,
  publishedAt: "2026-10-12T09:00:00Z",
  ...over,
});
const feed = () =>
  wrap(React.createElement(DealSignalFeed, { signals: [signal("1"), signal("2", { signalType: "acquisition" }), signal("3", { signalType: "exit" })] }));

const cells = (): { cells: HeatmapCell[]; sectors: string[]; stages: string[] } => {
  const sectors = ["Logistics", "Healthcare services", "Industrial technology and automation"];
  const stages = ["sourced", "screening", "diligence", "ic_review", "closing"];
  return {
    sectors,
    stages,
    cells: sectors.flatMap((sector, i) =>
      stages.map((stage, j) => ({ sector, stage, dealCount: i + j, activityLevel: (["low", "moderate", "high", "very_high"] as const)[(i + j) % 4] })),
    ),
  };
};
const heatmap = () => {
  const h = cells();
  return wrap(React.createElement(SectorHeatmap, { cells: h.cells, sectors: h.sectors, stages: h.stages }));
};

describeVisual("The deal screens", () => {
  const cases: [string, () => string][] = [
    ["Deal pipeline", pipeline],
    ["Deal signal feed", feed],
    ["Sector heatmap", heatmap],
  ];
  for (const [name, markup] of cases) {
    for (const vp of VIEWPORTS) {
      it(`${name} lays out cleanly at ${vp.width}px`, async () => {
        const issues = await inspect(browser, markup(), { width: vp.width });
        expect(report(name, vp.width, issues)).toBe(report(name, vp.width, []));
      });
    }
  }

  it("keeps the deal's name beside the other columns when the table is scrolled on a phone", async () => {
    const page = await browser.newPage({ viewport: { width: 400, height: 900 } });
    try {
      await page.setContent(await pageHtml(pipeline()), { waitUntil: "load" });
      const r = await page.evaluate(() => {
        const scroller = document.querySelector("table")!.parentElement as HTMLElement;
        const cell = document.querySelector("tbody tr td:first-child") as HTMLElement;
        const before = cell.getBoundingClientRect().left;
        scroller.scrollLeft = scroller.scrollWidth;
        const after = cell.getBoundingClientRect().left;
        const frame = scroller.getBoundingClientRect().left;
        return { canScroll: scroller.scrollWidth > scroller.clientWidth, before, after, frame, wide: Math.round(cell.getBoundingClientRect().width) };
      });
      expect(r.canScroll).toBe(true); // the premise: the table really does scroll on a phone
      expect(Math.abs(r.after - r.frame)).toBeLessThan(2); // pinned to the frame's left edge
      expect(r.wide).toBeLessThanOrEqual(180); // and a long name does not take over the screen
    } finally {
      await page.close();
    }
  });

  it("gives the stage button a thumb-sized tap target and a label that names its deal", async () => {
    const page = await browser.newPage({ viewport: { width: 400, height: 900 } });
    try {
      await page.setContent(await pageHtml(pipeline()), { waitUntil: "load" });
      const r = await page.evaluate(() => {
        const b = document.querySelector("tbody button[aria-expanded]") as HTMLElement;
        return { h: Math.round(b.getBoundingClientRect().height), label: b.getAttribute("aria-label") };
      });
      expect(r.h).toBeGreaterThanOrEqual(30);
      expect(r.label).toContain("change stage for");
    } finally {
      await page.close();
    }
  });

  it("keeps the heatmap's sector names in view when it is scrolled sideways on a phone", async () => {
    const page = await browser.newPage({ viewport: { width: 400, height: 900 } });
    try {
      await page.setContent(await pageHtml(heatmap()), { waitUntil: "load" });
      const r = await page.evaluate(() => {
        const scroller = document.querySelector(".overflow-x-auto") as HTMLElement;
        const label = [...document.querySelectorAll("span")].find((e) => e.textContent === "Logistics")!;
        scroller.scrollLeft = scroller.scrollWidth;
        return { canScroll: scroller.scrollWidth > scroller.clientWidth, labelLeft: label.getBoundingClientRect().left, frameLeft: scroller.getBoundingClientRect().left };
      });
      expect(r.canScroll).toBe(true);
      expect(r.labelLeft).toBeGreaterThanOrEqual(r.frameLeft - 1);
    } finally {
      await page.close();
    }
  });

  it("makes the signal feed's filter chips thumb-sized", async () => {
    const page = await browser.newPage({ viewport: { width: 400, height: 900 } });
    try {
      await page.setContent(await pageHtml(feed()), { waitUntil: "load" });
      const heights = await page.evaluate(() =>
        [...document.querySelectorAll("button")]
          .filter((b) => b.className.includes("rounded-full"))
          .map((b) => Math.round(b.getBoundingClientRect().height)),
      );
      expect(heights.length).toBeGreaterThan(2);
      for (const h of heights) expect(h).toBeGreaterThanOrEqual(32);
    } finally {
      await page.close();
    }
  });
});
