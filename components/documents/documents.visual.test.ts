/**
 * Layout checks for the Documents client surfaces, in a real browser engine.
 *
 * These exist because #1104 shipped two defects through a fully green CI run:
 * five buttons that all read "AI DRAFT" with no way to tell them apart, and an
 * action button sitting on top of the label it belonged to at phone width.
 * Every jsdom test passed, correctly — jsdom has no layout engine, so it can
 * only ever confirm what the DOM contains, never where any of it lands.
 *
 * Deliberately not screenshot diffing. There are no golden images to churn
 * whenever a padding changes; each check names something that is a defect under
 * any design.
 */

// Server actions and the Supabase client are stubbed. None of them affects
// layout — they are imported only so form `action` props have something to
// bind to — and loading them for real drags in `server-only`, which throws
// outside a server render by design.
jest.mock("@/components/documents/document-actions", () => ({
  addDocument: jest.fn(),
  newDocument: jest.fn(),
  updateDocumentStatus: jest.fn(),
}));
jest.mock("@/components/documents/upload-actions", () => ({
  removeDocumentFile: jest.fn(),
  createUploadTicket: jest.fn(),
  finalizeUpload: jest.fn(),
  abandonUpload: jest.fn(),
}));
jest.mock("@/components/documents/create-actions", () => ({
  newDocumentFromTemplate: jest.fn(),
  newBlankDocument: jest.fn(),
}));
jest.mock("@/components/build/room-actions", () => ({
  publishDocument: jest.fn(),
  unpublishDocument: jest.fn(),
}));
jest.mock("@/components/build/builder-actions", () => ({
  generateAiDocument: jest.fn(),
}));
jest.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Browser } from "playwright-core";

import { VIEWPORTS, chromiumPath, inspect, report } from "@/test-utils/visual";
import { CreateWorkspace } from "@/components/documents/CreateWorkspace";
import { LibraryWorkspace } from "@/components/documents/LibraryWorkspace";
import { groupTemplates, keyMaterialStatus, missingMaterialCount } from "@/lib/document-create";
import type { LibraryDoc, LibrarySection } from "@/components/documents/LibraryControls";

const exe = chromiumPath();

// Locally a contributor may simply not have a browser; that should not fail
// their `npm run test:visual`. In CI it means the install step did not run, and
// silently skipping would make this suite worthless exactly where it matters.
if (!exe && process.env.CI) {
  throw new Error(
    "Chromium not found and CI=true. The visual checks cannot run — install it " +
      "with `npx playwright install --with-deps chromium`.",
  );
}

const describeVisual = exe ? describe : describe.skip;
if (!exe) {
  console.warn("[visual] Chromium not found — skipping. `npx playwright install chromium`");
}

let browser: Browser;

beforeAll(async () => {
  const { chromium } = require("playwright-core") as typeof import("playwright-core");
  browser = await chromium.launch({ executablePath: exe!, args: ["--no-sandbox"] });
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ORG = "11111111-1111-1111-1111-111111111111";

function doc(over: Partial<LibraryDoc> & { id: string; name: string; section: string }): LibraryDoc {
  return {
    storageKey: null,
    hasContent: true,
    kind: "Written",
    sizeBytes: null,
    uploaded: false,
    status: "ready",
    qualityScore: null,
    qualityLevel: null,
    qualityGaps: null,
    roomIds: [],
    updatedAt: "2026-09-01T00:00:00.000Z",
    updatedLabel: "2w ago",
    ...over,
  };
}

/** The dense case: long names, every badge lit, every row action present. */
const LIBRARY_SECTIONS: LibrarySection[] = [
  {
    key: "fund_terms",
    label: "Fund Terms",
    description: "PPM, LPA, fees & carry, key terms, and side letters.",
    viaBuild: false,
    aiDraftable: false,
    docs: [
      doc({
        id: "d1",
        name: "Fund IV Amended & Restated Limited Partnership Agreement (Execution Copy)",
        section: "fund_terms",
        storageKey: `${ORG}/d1/abc.pdf`,
        hasContent: false,
        kind: "PDF",
        sizeBytes: 2_400_000,
        uploaded: true,
        status: "review",
        qualityScore: 62,
        qualityLevel: "Solid",
        qualityGaps: 4,
        roomIds: ["r1", "r2"],
      }),
      doc({ id: "d2", name: "Fee Schedule", section: "fund_terms" }),
    ],
  },
  {
    key: "marketing",
    label: "Marketing & Materials",
    description: "Executive summary, investor deck, one-pager, and teasers.",
    viaBuild: false,
    aiDraftable: true,
    docs: [
      doc({
        id: "d3",
        name: "Investor Deck",
        section: "marketing",
        storageKey: "https://drive.example.com/deck",
        hasContent: false,
        kind: "Link",
        roomIds: ["r1"],
      }),
    ],
  },
];

const CREATE_MATERIALS = keyMaterialStatus(["Fund IV Pitch Deck", "2026 Exec Summary (final)"]);

const SURFACES: Array<{ name: string; markup: string }> = [
  {
    name: "Documents › Create",
    markup: renderToStaticMarkup(
      React.createElement(CreateWorkspace, {
        materials: CREATE_MATERIALS,
        groups: groupTemplates(),
        missingCount: missingMaterialCount(CREATE_MATERIALS),
        usedTemplateSections: ["marketing", "overview"],
      }),
    ),
  },
  {
    name: "Documents › Library",
    markup: renderToStaticMarkup(
      React.createElement(LibraryWorkspace, {
        sections: LIBRARY_SECTIONS,
        rooms: [
          { id: "r1", name: "LP Room" },
          { id: "r2", name: "Co-invest Room" },
        ],
      }),
    ),
  },
];

// ─── The checks ──────────────────────────────────────────────────────────────

describeVisual("Documents layout", () => {
  for (const surface of SURFACES) {
    for (const vp of VIEWPORTS) {
      it(`${surface.name} lays out cleanly at ${vp.width}px`, async () => {
        const issues = await inspect(browser, surface.markup, { width: vp.width });
        expect(report(surface.name, vp.width, issues)).toBe(
          `${surface.name} at ${vp.width}px — 0 layout issues:`,
        );
      }, 60_000);
    }
  }

  it("keeps every surface inside a 400px viewport", async () => {
    // Called out separately from the per-surface checks because a phone-width
    // horizontal scroll is the single most reported layout complaint, and the
    // failure message should say so rather than being one line in a longer list.
    for (const surface of SURFACES) {
      const issues = await inspect(browser, surface.markup, { width: 400 });
      const escapes = issues.filter((i) => i.kind === "viewport-escape");
      expect(report(surface.name, 400, escapes)).toBe(
        `${surface.name} at 400px — 0 layout issues:`,
      );
    }
  }, 60_000);
});
