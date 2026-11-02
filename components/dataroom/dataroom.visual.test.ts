/**
 * Layout checks for the LP-facing data room, in a real browser engine.
 *
 * The room is one landing page: a hero, a menu, then a band per section. jsdom
 * cannot tell whether the menu overflows a phone, whether the hero's figures
 * crowd each other, or whether a long document name pushes a row past the edge.
 * Each check names something that is a defect under any design.
 */
jest.mock("@/components/dataroom/viewer-actions", () => ({
  recordRoomOpen: jest.fn(),
  signRoomDocument: jest.fn(),
  trackReading: jest.fn(),
  recordNdaSignature: jest.fn(),
  passEmailGate: jest.fn(),
}));
jest.mock("@/components/build/materials-actions", () => ({ verifySharePassword: jest.fn() }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
// pdf.js's worker is loaded with import.meta, which ts-jest's CommonJS output
// cannot parse. The signing sheet is not part of these layout checks.
jest.mock("@/components/signing/PdfPages", () => ({ PdfPages: () => null }));

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Browser } from "playwright-core";

import { VIEWPORTS, chromiumPath, inspect, report } from "@/test-utils/visual";
import { DataRoomViewer, type ViewerSection } from "@/components/dataroom/DataRoomViewer";

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

const doc = (id: string, name: string, over: object = {}) => ({
  id,
  name,
  content: null,
  hasFile: true,
  uploaded: true,
  preview_kind: "pdf" as const,
  doc_type: "marketing",
  updatedAt: "2026-10-12T09:00:00Z",
  ...over,
});

const SECTIONS: ViewerSection[] = [
  {
    key: "marketing",
    label: "Marketing & Materials",
    docs: [
      doc("a", "Fund IV Amended & Restated Limited Partnership Agreement (Execution Copy) — Annex of Side Letters", { isNew: true }),
      doc("b", "Investor Deck"),
    ],
  },
  {
    key: "thesis",
    label: "Investment Strategy & Thesis",
    docs: [doc("c", "Investment Memorandum", { requiresSignature: true, signed: false, hasFile: false })],
  },
  { key: "track_record", label: "Track Record & Performance", docs: [doc("d", "Assumptions and Model Package")] },
  { key: "financials", label: "Financials & Audits", docs: [doc("e", "Audited Financials 2025")] },
  { key: "legal", label: "Legal & Structure", docs: [doc("f", "Formation Documents")] },
];

function room(over: Partial<React.ComponentProps<typeof DataRoomViewer>> = {}) {
  return renderToStaticMarkup(
    React.createElement(DataRoomViewer, {
      token: "t",
      shareId: "s",
      org: {
        name: "Bey Group International Capital Partners",
        tagline: "Culture, Capital, and Control",
        legal_name: "Bey Group International Capital Partners, L.P.",
        entity_type: "LP",
        jurisdiction: "Delaware",
        website: "beygroupintl.com",
        brand_color: null,
        logo_url: null,
      },
      blended: { dealCount: 6, realizedCount: 2, weightedGrossIrr: 24, pooledMoic: 2.4, dpi: 0.6, totalInvested: 42_000_000, vintageRange: { from: 2019, to: 2025 } },
      thesis: { title: "Private credit to cultural infrastructure", summary: "We lend against durable cash flows.", asset_classes: ["Private credit"], geographies: ["US"], target_irr: 18, target_moic: 2, check_size_min: 1_000_000, check_size_max: 5_000_000 },
      team: [{ name: "Pat Principal", title: "Managing Partner", email: "pat@bey.com" }],
      entities: [{ name: "Bey Fund IV, L.P.", entity_type: "Delaware LP" }],
      docSections: SECTIONS,
      room: { name: "Fund IV Raise", welcomeNote: "Thank you for your time.\nStart with the executive summary, then the memorandum." },
      gateConfig: { requireEmail: false, requireNda: false, ndaText: null, passwordProtected: false },
      contentReady: true,
      ...over,
    }),
  );
}

describeVisual("The LP data room page", () => {
  for (const vp of VIEWPORTS) {
    it(`lays out cleanly at ${vp.width}px`, async () => {
      const issues = await inspect(browser, room(), { width: vp.width });
      expect(report("data room", vp.width, issues)).toBe(report("data room", vp.width, []));
    });
  }

  it("keeps the menu inside a 400px phone, scrolling sideways rather than spilling", async () => {
    const page = await browser.newPage({ viewport: { width: 400, height: 900 } });
    try {
      const { pageHtml } = require("@/test-utils/visual") as typeof import("@/test-utils/visual");
      await page.setContent(await pageHtml(room()), { waitUntil: "load" });
      const m = await page.evaluate(() => {
        const nav = document.querySelector("nav[aria-label='Sections']") as HTMLElement;
        return {
          page: document.documentElement.scrollWidth,
          viewport: window.innerWidth,
          navScrolls: nav.scrollWidth > nav.clientWidth,
          navRight: nav.getBoundingClientRect().right,
        };
      });
      expect(m.page).toBeLessThanOrEqual(m.viewport);
      expect(m.navScrolls).toBe(true);
      expect(m.navRight).toBeLessThanOrEqual(m.viewport);
    } finally {
      await page.close();
    }
  });

  it("shows the firm, the note and the way in on the first screen of a laptop", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    try {
      const { pageHtml } = require("@/test-utils/visual") as typeof import("@/test-utils/visual");
      await page.setContent(await pageHtml(room()), { waitUntil: "load" });
      const fold = await page.evaluate(() => {
        const bottom = (el: Element | null) => (el ? el.getBoundingClientRect().bottom : Infinity);
        const h1 = document.querySelector("h1");
        const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "View documents") ?? null;
        return { h1: bottom(h1), btn: bottom(btn), height: window.innerHeight };
      });
      expect(fold.h1).toBeLessThan(fold.height);
      expect(fold.btn).toBeLessThan(fold.height);
    } finally {
      await page.close();
    }
  });
});
