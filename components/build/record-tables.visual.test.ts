/**
 * Layout checks for Build's record tables and the Firm Identity rail, in a real
 * browser engine.
 *
 * A seven-column table cannot fit a 400px phone. The defects are a table that
 * clips its figures (nothing to scroll to), one that widens the whole page, a
 * row name that scrolls away from its numbers, and row buttons too small to hit.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Browser } from "playwright-core";

import { VIEWPORTS, chromiumPath, inspect, pageHtml, report } from "@/test-utils/visual";
import { SortableTrackRecordList } from "@/components/build/TrackRecordAnalytics";
import { TrackRecordCells } from "@/components/build/TrackRecordRow";
import { TableRecordEditor } from "@/components/build/RecordEditor";
import { FirmIdentityRail } from "@/components/build/FirmIdentityRail";
import type { TrackRecord } from "@/lib/supabase/database.types";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));
jest.mock("@/app/(app)/build/profile/actions", () => ({ answerIdentityQuestion: jest.fn() }));

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

const rec = (id: string, over: Partial<TrackRecord> = {}) =>
  ({
    id,
    deal_name: `Deal ${id}`,
    asset_class: "Lower mid-market credit",
    vintage_year: 2021,
    invested_amount: 12_500_000,
    realized_value: 4_000_000,
    gross_irr: 18.4,
    gross_moic: 1.9,
    is_realized: false,
    ...over,
  }) as unknown as TrackRecord;

const records = [
  rec("a", { deal_name: "Meridian Logistics Holdings Senior Secured Term Loan — Amended and Extended" }),
  rec("b", { vintage_year: 2019 }),
  rec("c", { deal_name: "Unbroken" + "x".repeat(60) }),
];

const row = (r: TrackRecord) =>
  React.createElement(
    TableRecordEditor as React.ComponentType<{
      id: string;
      action: (fd: FormData) => Promise<void>;
      colCount: number;
      actions?: React.ReactNode;
      display: React.ReactNode;
      children?: React.ReactNode;
    }>,
    {
      key: r.id,
      id: r.id,
      action: async () => {},
      colCount: 7,
      actions: React.createElement("button", { className: "fx-mini-btn fx-mini-btn-danger" }, "✕"),
      display: React.createElement(TrackRecordCells, { r }),
    },
    null,
  );

const table = () =>
  renderToStaticMarkup(
    React.createElement(
      "div",
      { className: "mx-auto max-w-6xl p-4" },
      React.createElement(SortableTrackRecordList, {
        records,
        rows: records.map((r) => ({ id: r.id, node: row(r) })),
      }),
    ),
  );

const progress = {
  overall: 42,
  status: "started" as const,
  sections: (["identity", "thesis", "brand", "entity"] as const).map((key, i) => ({
    key,
    label: ["Identity", "Thesis", "Brand", "Entity"][i],
    eyebrow: "Section",
    anchor: key,
    total: 8,
    doneCount: i + 1,
    score: 30,
    status: "started" as const,
  })),
};
const rail = () =>
  renderToStaticMarkup(
    React.createElement(
      "div",
      { className: "mx-auto max-w-6xl p-4" },
      React.createElement(FirmIdentityRail, {
        firmName: "Bey Group International Capital Partners",
        progress,
        questions: [
          {
            id: "q1",
            question: "What is your firm's legal name, and in which jurisdiction is it registered?",
          } as never,
        ],
      }),
    ),
  );

describeVisual("Build record tables and the Firm Identity rail", () => {
  const cases: [string, () => string][] = [
    ["Track record table", table],
    ["Firm Identity rail", rail],
  ];
  for (const [name, markup] of cases) {
    for (const vp of VIEWPORTS) {
      it(`${name} lays out cleanly at ${vp.width}px`, async () => {
        const issues = await inspect(browser, markup(), { width: vp.width });
        expect(report(name, vp.width, issues)).toBe(report(name, vp.width, []));
      });
    }
  }

  it("scrolls the table inside its frame on a phone, with every column reachable", async () => {
    const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
    try {
      await page.setContent(await pageHtml(table()), { waitUntil: "load" });
      const r = await page.evaluate(() => {
        const t = document.querySelector("table")!;
        const frame = t.parentElement as HTMLElement;
        return {
          page: document.documentElement.scrollWidth,
          scrolls: frame.scrollWidth > frame.clientWidth,
          overflowX: getComputedStyle(frame).overflowX,
        };
      });
      expect(r.page).toBeLessThanOrEqual(400);
      expect(r.scrolls).toBe(true);
      expect(r.overflowX).toBe("auto");
    } finally {
      await page.close();
    }
  });

  it("keeps each deal's name in view while its figures scroll", async () => {
    const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
    try {
      await page.setContent(await pageHtml(table()), { waitUntil: "load" });
      const r = await page.evaluate(async () => {
        const frame = document.querySelector("table")!.parentElement as HTMLElement;
        const cell = document.querySelector("tbody tr td") as HTMLElement;
        frame.scrollLeft = frame.scrollWidth;
        await new Promise((res) => requestAnimationFrame(() => res(null)));
        const c = cell.getBoundingClientRect();
        const f = frame.getBoundingClientRect();
        return { cellLeft: Math.round(c.left - f.left), scrolled: frame.scrollLeft > 0 };
      });
      expect(r.scrolled).toBe(true);
      expect(Math.abs(r.cellLeft)).toBeLessThanOrEqual(1);
    } finally {
      await page.close();
    }
  });

  it("makes the row buttons and sort buttons thumb-sized on a phone", async () => {
    const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
    try {
      await page.setContent(await pageHtml(table()), { waitUntil: "load" });
      const heights = await page.evaluate(() =>
        Array.from(document.querySelectorAll("button")).map((b) => Math.round(b.getBoundingClientRect().height)),
      );
      expect(heights.length).toBeGreaterThan(6);
      for (const h of heights) expect(h).toBeGreaterThanOrEqual(36);
    } finally {
      await page.close();
    }
  });

  it("keeps the Firm Identity rail compact and its controls thumb-sized on a phone", async () => {
    const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
    try {
      await page.setContent(await pageHtml(rail()), { waitUntil: "load" });
      const r = await page.evaluate(() => {
        const card = document.querySelector("aside > div") as HTMLElement;
        const buttons = Array.from(document.querySelectorAll("aside button")).map((b) => Math.round(b.getBoundingClientRect().height));
        return { height: Math.round(card.getBoundingClientRect().height), buttons };
      });
      expect(r.height).toBeLessThanOrEqual(420);
      for (const h of r.buttons) expect(h).toBeGreaterThanOrEqual(40);
    } finally {
      await page.close();
    }
  });
});
