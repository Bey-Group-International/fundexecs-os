/**
 * Layout checks for the Source hub's chrome, in a real browser engine.
 *
 * Every Source page opens with a readiness card, a header with a live control and
 * a row of stat tiles, and a stats block, all above the list the person came for.
 * On a phone the question is how much of the first screen is chrome, and whether
 * the controls can be hit with a thumb.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Browser } from "playwright-core";

import { VIEWPORTS, chromiumPath, inspect, pageHtml, report } from "@/test-utils/visual";
import { SourceMomentumPanel } from "@/components/source/SourceMomentumPanel";
import { SourceLiveHeader } from "@/components/source/SourceLiveHeader";
import { ModuleDashboard } from "@/components/source/ModuleDashboard";
import type { SourceMomentum } from "@/lib/source-readiness";
import type { ModuleSummary } from "@/lib/source-stats";

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

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

const stage = (key: string, label: string, threshold: number, unlocked: boolean, current: boolean) => ({
  key,
  label,
  threshold,
  blurb: "Enough investors and partners on the bench to start working a real raise.",
  unlocked,
  current,
});
const momentum: SourceMomentum = {
  overall: 38,
  stage: stage("building", "Building the bench", 25, true, true),
  stages: [stage("building", "Building the bench", 25, true, true), stage("working", "Working the raise", 60, false, false)],
  coverage: { target: 50_000_000, equity: 12_000_000, debt: 3_000_000, stack: 15_000_000, pct: 30 },
  velocity: { active: 14, stalled: 5, oldestDays: 63 },
  modules: [],
  nextAction: {
    label: "Add five more allocators so the raise has enough coverage to start outreach",
    href: "/source/lp_pipeline",
    moduleLabel: "LP Pipeline",
  },
};
const summary: ModuleSummary = {
  stats: [
    { label: "Allocators", value: "128", tone: "default" },
    { label: "Active", value: "14", tone: "default" },
    { label: "Committed", value: "$4.2M", tone: "default", hint: "Estimate from check sizes" },
    { label: "Quiet 21d+", value: "5", tone: "default" },
  ] as never,
  funnel: {
    title: "Relationship funnel",
    stages: [
      { key: "cold", label: "Cold", count: 80, share: 1, tone: "default" },
      { key: "warm", label: "Warm", count: 30, share: 0.4, tone: "default" },
      { key: "active", label: "Active", count: 14, share: 0.2, tone: "default" },
    ] as never,
  },
};

const wrap = (...inner: React.ReactElement[]) =>
  renderToStaticMarkup(React.createElement("div", { className: "mx-auto max-w-4xl p-4" }, ...inner));

const chrome = () =>
  wrap(
    React.createElement(SourceMomentumPanel, { momentum }),
    React.createElement(SourceLiveHeader, {
      title: "LP Pipeline",
      subtitle: "Allocators matched to your mandate, with who is warm and who has gone quiet.",
      stats: [
        { label: "Allocators", value: "128" },
        { label: "Active", value: "14" },
        { label: "Committed", value: "$4.2M", hint: "Estimate" },
        { label: "Quiet 21d+", value: "5" },
      ],
    }),
    React.createElement(ModuleDashboard, { summary, empty: false }),
  );

describeVisual("The Source hub chrome", () => {

  for (const vp of VIEWPORTS) {
    it(`lays out cleanly at ${vp.width}px`, async () => {
      const issues = await inspect(browser, chrome(), { width: vp.width });
      expect(report("Source chrome", vp.width, issues)).toBe(report("Source chrome", vp.width, []));
    });
  }

  it("leaves room for the list on a phone's first screen", async () => {
    const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
    try {
      await page.setContent(await pageHtml(chrome()), { waitUntil: "load" });
      // To the bottom of the last thing drawn (the body itself is padded out to
      // the viewport height, so its own height says nothing).
      const bottom = await page.evaluate(() =>
        Math.round(Math.max(...Array.from(document.querySelectorAll("body *")).filter((e) => e.checkVisibility()).map((e) => e.getBoundingClientRect().bottom))),
      );
      // The chrome used to run 924px, longer than the screen. It should now leave a quarter of an 800px screen or more for the list.
      expect(bottom).toBeLessThanOrEqual(580);
    } finally {
      await page.close();
    }
  });

  it("makes every control in the chrome thumb-sized on a phone", async () => {
    const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
    try {
      await page.setContent(await pageHtml(chrome()), { waitUntil: "load" });
      const small = await page.evaluate(() =>
        Array.from(document.querySelectorAll("a, button, summary"))
          .map((e) => ({ text: (e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 30), h: Math.round(e.getBoundingClientRect().height) }))
          .filter((c) => c.h < 36),
      );
      expect(small).toEqual([]);
    } finally {
      await page.close();
    }
  });
});
