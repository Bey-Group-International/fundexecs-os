/**
 * Layout checks for the Dashboard pieces, in a real browser engine.
 *
 * jsdom cannot tell whether the Needs-you strip wraps cleanly at phone width, or
 * whether a long system detail or activity title pushes a row past the edge. Each
 * check names something that is a defect under any design.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Browser } from "playwright-core";

import { VIEWPORTS, chromiumPath, inspect, report } from "@/test-utils/visual";
import { NeedsYouStrip } from "@/components/dashboard/NeedsYouStrip";
import { SystemsOfRecord } from "@/components/dashboard/SystemsOfRecord";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import type { ActivityItem, SystemStatus } from "@/lib/dashboard/institutional";

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

const strip = () =>
  wrap(
    React.createElement(NeedsYouStrip, {
      approvals: 5,
      approvalsCapped: true,
      staleDeals: { count: 12, oldestDays: 187 },
      readinessNext: {
        label: "Complete your investment thesis so Earn can score deal fit against it",
        href: "/build/profile#thesis",
      },
    }),
  );

const system = (key: string, over: Partial<SystemStatus> = {}): SystemStatus => ({
  key,
  label: key.replace(/_/g, " "),
  primary: "1,284",
  unit: "records",
  detail: "Fund IV Amended & Restated Limited Partnership Agreement (Execution Copy)",
  health: "live",
  lastActivity: "2026-10-12T09:00:00Z",
  href: `/${key}`,
  ...over,
});

const systems = () =>
  wrap(
    React.createElement(SystemsOfRecord, {
      systems: [
        system("capital"),
        system("deals"),
        system("portfolio"),
        system("finance"),
        system("documents", { health: "empty", lastActivity: null }),
        system("comms"),
        system("network"),
        system("automation"),
      ],
    }),
  );

const activity = (): ActivityItem[] => [
  {
    id: "1",
    kind: "capital",
    title: "Capital call #7 issued to 142 limited partners across Fund IV and the Fund IV Co-Investment Vehicle",
    detail: "Called $12,400,000 against $48,000,000 of unfunded commitments, due 30 November",
    href: "/execute/capital_events",
    at: "2026-10-12T09:00:00Z",
  },
  { id: "2", kind: "deal", title: "Maple Street acquisition moved to IC review", detail: null, href: "/deal/1", at: "2026-10-11T09:00:00Z" },
];

describeVisual("The Dashboard pieces", () => {
  const cases: [string, () => string][] = [
    ["Needs-you strip", strip],
    ["Systems of record", systems],
    ["Activity feed", () => wrap(React.createElement(ActivityFeed, { items: activity() }))],
  ];
  for (const [name, markup] of cases) {
    for (const vp of VIEWPORTS) {
      it(`${name} lays out cleanly at ${vp.width}px`, async () => {
        const issues = await inspect(browser, markup(), { width: vp.width });
        expect(report(name, vp.width, issues)).toBe(report(name, vp.width, []));
      });
    }
  }
});
