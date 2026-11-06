/**
 * Layout checks for the Build hub's chrome, in a real browser engine.
 *
 * The readiness card used to be a panel fixed to the corner of every Build page.
 * jsdom cannot see that it covered the content or the Ask Earn button, so these
 * checks ask the browser where things are.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Browser } from "playwright-core";

import { VIEWPORTS, chromiumPath, inspect, pageHtml, report } from "@/test-utils/visual";
import { ReadinessSummary } from "@/components/build/ReadinessSummary";
import { ReadinessPanel } from "@/components/build/ReadinessPanel";
import { HubTabs } from "@/app/(app)/[hub]/HubTabs";
import { HUB_BY_KEY } from "@/lib/hubs";
import type { BuildReadiness } from "@/lib/build-readiness";

jest.mock("next/navigation", () => ({ usePathname: () => "/build/data_room" }));

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

const mod = (key: string, label: string, done: number, total: number) => ({
  key,
  label,
  href: `/build/${key}`,
  score: Math.round((done / total) * 100),
  status: done === total ? "complete" : done > 0 ? "started" : "empty",
  doneCount: done,
  total,
  checks: [],
});
const readiness = {
  overall: 42,
  stage: { key: "seed", label: "Seed-ready", threshold: 30, blurb: "Enough to start conversations with investors.", unlocked: true, current: true },
  stages: [
    { key: "seed", label: "Seed-ready", threshold: 30, blurb: "", unlocked: true, current: true },
    { key: "raise", label: "Raise-ready", threshold: 60, blurb: "", unlocked: false, current: false },
    { key: "close", label: "Close-ready", threshold: 85, blurb: "", unlocked: false, current: false },
  ],
  modules: [
    mod("profile", "Firm Identity", 3, 8),
    mod("track_record", "Track Record", 0, 4),
    mod("team", "Team", 1, 3),
    mod("data_room", "Materials & Data Room", 2, 9),
    mod("documents", "Documents", 0, 5),
  ],
  statuses: {},
  nextAction: {
    moduleKey: "profile",
    moduleLabel: "Firm Identity",
    label: "Add your firm's legal name and jurisdiction so investors can verify who you are",
    href: "/build/profile#identity",
  },
  dataRoom: {},
} as unknown as BuildReadiness;

const wrap = (...inner: React.ReactElement[]) =>
  renderToStaticMarkup(React.createElement("div", { className: "mx-auto max-w-6xl p-4" }, ...inner));

const summary = () =>
  wrap(
    React.createElement(
      ReadinessSummary as React.ComponentType<{ readiness: BuildReadiness; children?: React.ReactNode }>,
      { readiness },
      React.createElement(ReadinessPanel, { readiness, embedded: true }),
    ),
  );
// The opened card: the same frame the component draws, with the full breakdown in it.
const opened = () =>
  wrap(
    React.createElement(
      "section",
      { className: "mb-5 rounded-2xl border border-line bg-surface-1" },
      React.createElement("div", { className: "border-t border-line px-4 py-4" }, React.createElement(ReadinessPanel, { readiness, embedded: true })),
    ),
  );
const tabs = () =>
  wrap(
    React.createElement(HubTabs, {
      hubKey: "build",
      modules: HUB_BY_KEY.build.modules,
      statuses: { profile: "started", track_record: "empty", team: "started", data_room: "started", documents: "empty" },
    }),
  );

describeVisual("The Build hub chrome", () => {
  const cases: [string, () => string][] = [
    ["Readiness summary", summary],
    ["Readiness details", opened],
    ["Hub tabs", tabs],
  ];
  for (const [name, markup] of cases) {
    for (const vp of VIEWPORTS) {
      it(`${name} lays out cleanly at ${vp.width}px`, async () => {
        const issues = await inspect(browser, markup(), { width: vp.width });
        expect(report(name, vp.width, issues)).toBe(report(name, vp.width, []));
      });
    }
  }

  it("keeps the readiness card in the page flow, never fixed over the content", async () => {
    const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
    try {
      await page.setContent(await pageHtml(summary()), { waitUntil: "load" });
      const fixed = await page.evaluate(
        () => Array.from(document.querySelectorAll("*")).filter((el) => getComputedStyle(el).position === "fixed").length,
      );
      expect(fixed).toBe(0);
    } finally {
      await page.close();
    }
  });

  it("is a compact row on a phone, with thumb-sized controls", async () => {
    const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
    try {
      await page.setContent(await pageHtml(summary()), { waitUntil: "load" });
      const r = await page.evaluate(() => {
        const card = (document.querySelector('[data-testid="readiness-summary"]') as HTMLElement).getBoundingClientRect();
        const controls = Array.from(document.querySelectorAll("a, button")).map((e) => Math.round(e.getBoundingClientRect().height));
        return { height: Math.round(card.height), controls };
      });
      expect(r.height).toBeLessThanOrEqual(150);
      expect(r.controls.length).toBeGreaterThanOrEqual(2);
      for (const h of r.controls) expect(h).toBeGreaterThanOrEqual(36);
    } finally {
      await page.close();
    }
  });

  it("lets the tab strip scroll sideways on a phone without widening the page", async () => {
    const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
    try {
      await page.setContent(await pageHtml(tabs()), { waitUntil: "load" });
      const r = await page.evaluate(() => {
        const strip = document.querySelector("a")!.parentElement as HTMLElement;
        const active = document.querySelector('a[aria-current="page"]') as HTMLElement;
        return {
          page: document.documentElement.scrollWidth,
          scrolls: strip.scrollWidth > strip.clientWidth,
          activeH: Math.round(active.getBoundingClientRect().height),
        };
      });
      expect(r.page).toBeLessThanOrEqual(400);
      expect(r.scrolls).toBe(true);
      expect(r.activeH).toBeGreaterThanOrEqual(36);
    } finally {
      await page.close();
    }
  });
});
