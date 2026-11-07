/**
 * Layout checks for the Sessions page pieces, in a real browser engine.
 *
 * jsdom cannot tell whether a long session name pushes a row past a phone's edge,
 * or whether the header's button crowds its title. Each check names something
 * that is a defect under any design.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Browser } from "playwright-core";

import { VIEWPORTS, chromiumPath, inspect, pageHtml, report } from "@/test-utils/visual";
import { OperatingBriefCard, SessionCard, SessionsHeader } from "@/components/workspace/SessionsView";
import { ShowMoreList } from "@/components/workspace/ShowMoreList";
import { buildOperatingBrief } from "@/lib/operating-brief";
import type { Session } from "@/lib/supabase/database.types";

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

const wrap = (...inner: React.ReactElement[]) =>
  renderToStaticMarkup(React.createElement("div", { className: "mx-auto max-w-5xl p-4" }, ...inner));

const LONG = "Fund IV capital call notice — reconcile LP commitments against the Annex of Side Letters before Friday";
const session = (id: string, over: Partial<Session & { updated_at: string | null }> = {}) =>
  ({
    id,
    name: `Session ${id}`,
    color: "#38bdf8",
    group_id: null,
    created_at: "2026-10-01T09:00:00Z",
    updated_at: "2026-10-12T09:00:00Z",
    ...over,
  }) as Session & { updated_at: string | null };

// Twenty-five sessions: more than the first ten, so the list folds.
const recentList = () =>
  wrap(
    React.createElement(ShowMoreList, {
      items: Array.from({ length: 25 }, (_, i) =>
        React.createElement(SessionCard, { key: i, s: session(`r${i}`, { name: i === 0 ? LONG : `Session r${i}` }), groupName: null }),
      ),
    }),
  );
const header = () => wrap(React.createElement(SessionsHeader));
const list = () =>
  wrap(
    React.createElement(
      "div",
      { className: "flex flex-col gap-1.5" },
      React.createElement(SessionCard, { s: session("a", { name: LONG }), groupName: "Investor Relations and Capital Formation Workstream" }),
      React.createElement(SessionCard, { s: session("b"), groupName: null }),
      React.createElement(SessionCard, { s: session("c", { name: "Unbroken" + "x".repeat(80) }), groupName: null }),
    ),
  );
const brief = () =>
  wrap(
    React.createElement(OperatingBriefCard, {
      brief: buildOperatingBrief({
        userRole: "owner",
        organizationName: "Bey Group International Capital Partners",
        operatorRole: null,
        strategy: null,
        activeWorkflows: 3,
        pendingApprovals: 2,
        blockedWorkflows: 1,
        openDeals: 7,
        investors: 40,
        documents: 12,
        connectedChannels: 2,
        recentSessions: 50,
      }),
    }),
  );

describeVisual("The Sessions page pieces", () => {
  const cases: [string, () => string][] = [
    ["Sessions header", header],
    ["Session list", list],
    ["Recent list, folded", recentList],
    ["Operating brief", brief],
  ];
  for (const [name, markup] of cases) {
    for (const vp of VIEWPORTS) {
      it(`${name} lays out cleanly at ${vp.width}px`, async () => {
        const issues = await inspect(browser, markup(), { width: vp.width });
        expect(report(name, vp.width, issues)).toBe(report(name, vp.width, []));
      });
    }
  }

  it("keeps the New conversation button on screen and thumb-sized on a phone", async () => {
    const page = await browser.newPage({ viewport: { width: 400, height: 900 } });
    try {
      await page.setContent(await pageHtml(header()), { waitUntil: "load" });
      const r = await page.evaluate(() => {
        const a = document.querySelector('a[href="#earn-composer"]') as HTMLElement;
        const b = a.getBoundingClientRect();
        return { right: Math.round(b.right), h: Math.round(b.height), w: Math.round(b.width), text: a.textContent?.trim() };
      });
      expect(r.text).toBe("New conversation");
      expect(r.right).toBeLessThanOrEqual(400);
      expect(r.h).toBeGreaterThanOrEqual(36);
    } finally {
      await page.close();
    }
  });

  it("makes the brief's disclosure toggle a thumb-sized control", async () => {
    const page = await browser.newPage({ viewport: { width: 400, height: 900 } });
    try {
      await page.setContent(await pageHtml(brief()), { waitUntil: "load" });
      const h = await page.evaluate(() => Math.round((document.querySelector("summary") as HTMLElement).getBoundingClientRect().height));
      expect(h).toBeGreaterThanOrEqual(36);
    } finally {
      await page.close();
    }
  });

  it("folds a long Recent list to ten rows, with a thumb-sized button that stays on screen", async () => {
    const page = await browser.newPage({ viewport: { width: 400, height: 900 } });
    try {
      await page.setContent(await pageHtml(recentList()), { waitUntil: "load" });
      const r = await page.evaluate(() => {
        const button = document.querySelector("button") as HTMLElement;
        const b = button.getBoundingClientRect();
        return { rows: document.querySelectorAll("a").length, right: Math.round(b.right), h: Math.round(b.height), text: button.textContent?.trim() };
      });
      expect(r.rows).toBe(10);
      expect(r.text).toBe("Show all 25 sessions");
      expect(r.right).toBeLessThanOrEqual(400);
      expect(r.h).toBeGreaterThanOrEqual(36);
    } finally {
      await page.close();
    }
  });
});
