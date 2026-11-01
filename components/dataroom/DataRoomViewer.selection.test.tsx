/**
 * The viewer's nav can change under a live selection: in the GP-side preview,
 * scoping to a link removes whole sections while one of them is being read.
 * The selection used to be repaired in an effect, which runs only after the
 * render that already dropped the section — so the viewer painted a frame with
 * an empty content pane and no nav item highlighted before correcting itself.
 * These tests pin the resolved-during-render behaviour that replaced it.
 */
const trackReading = jest.fn(async () => undefined);
const recordRoomOpen = jest.fn(async () => undefined);
jest.mock("./viewer-actions", () => ({
  trackReading: (...args: unknown[]) => trackReading(...(args as [])),
  recordRoomOpen: (...args: unknown[]) => recordRoomOpen(...(args as [])),
  recordNdaSignature: jest.fn(),
  passEmailGate: jest.fn(),
}));
jest.mock("@/components/build/materials-actions", () => ({
  verifySharePassword: jest.fn(),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));

import { render, screen, fireEvent } from "@testing-library/react";
import { DataRoomViewer, type ViewerSection } from "./DataRoomViewer";

const ORG = {
  name: "Alpha Capital",
  tagline: null,
  legal_name: null,
  entity_type: null,
  jurisdiction: null,
  website: null,
  brand_color: null,
  logo_url: null,
};

const BLENDED = {
  dealCount: 0,
  realizedCount: 0,
  weightedGrossIrr: null,
  pooledMoic: null,
  dpi: null,
  totalInvested: null,
  vintageRange: null,
};

function section(key: string, label: string, docName: string): ViewerSection {
  return {
    key,
    label,
    docs: [
      {
        id: `${key}-1`,
        name: docName,
        content: `Body text unique to ${key}.`,
        hasFile: false,
        doc_type: key,
      },
    ],
  };
}

function view(docSections: ViewerSection[], preview = true) {
  return (
    <DataRoomViewer
      token="preview"
      shareId="preview"
      org={ORG}
      blended={BLENDED}
      thesis={null}
      team={[]}
      entities={[]}
      docSections={docSections}
      gateConfig={{ requireEmail: false, requireNda: false, ndaText: null, passwordProtected: false }}
      contentReady
      preview={preview}
    />
  );
}

const FINANCIALS = section("financials", "Financials & Audits", "Audited Financials");
const LEGAL = section("legal", "Legal & Structure", "Formation Documents");

/** The nav always opens on Overview, so a section has to be picked first for
 * "the selected section disappears" to mean anything. */
function selectSection(label: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(label.split(" ")[0], "i") }));
}

it("shows the section a reader picked", () => {
  render(view([FINANCIALS, LEGAL]));
  selectSection("Financials");
  expect(screen.getByText(/Body text unique to financials/)).toBeInTheDocument();
});

it("falls back to a surviving section when the selected one is scoped away", () => {
  const { rerender } = render(view([FINANCIALS, LEGAL]));
  selectSection("Financials");
  expect(screen.getByText(/Body text unique to financials/)).toBeInTheDocument();

  // Scoping to a link that publishes only Legal drops the section being read.
  rerender(view([LEGAL]));

  // The pane must show a real section rather than an empty frame. Overview is
  // the first surviving nav item, so that is what the reader lands on.
  expect(screen.queryByText(/Body text unique to financials/)).not.toBeInTheDocument();
  // SectionHeader renders the pane's own <h1>, so a real section is showing
  // rather than the null ContentPanel returned for an unmatched selection.
  expect(screen.getByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument();
});

it("keeps the selection when some other section is removed", () => {
  const { rerender } = render(view([FINANCIALS, LEGAL]));
  selectSection("Financials");
  rerender(view([FINANCIALS]));
  expect(screen.getByText(/Body text unique to financials/)).toBeInTheDocument();
});

it("never records anything from a preview", () => {
  render(view([FINANCIALS, LEGAL]));
  selectSection("Financials");
  expect(trackReading).not.toHaveBeenCalled();
  expect(recordRoomOpen).not.toHaveBeenCalled();
});

describe("a live reader", () => {
  beforeEach(() => {
    trackReading.mockClear();
    recordRoomOpen.mockClear();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it("reports the open once and the time read, credited before leaving a section", () => {
    const { rerender } = render(view([FINANCIALS, LEGAL], false));
    rerender(view([FINANCIALS, LEGAL], false));
    expect(recordRoomOpen).toHaveBeenCalledTimes(1);

    // Twelve seconds of an active reader, then a move to another section.
    for (let i = 0; i < 4; i++) {
      fireEvent.scroll(window);
      jest.advanceTimersByTime(3_000);
    }
    selectSection("Financials");
    expect(trackReading).toHaveBeenCalledTimes(1);
    const [token, , entries] = trackReading.mock.calls[0] as unknown as [string, string, { documentId: string | null; seconds: number }[]];
    expect(token).toBe("preview");
    // jsdom has no layout, so nothing is "in view": the time lands on the overview.
    expect(entries).toEqual([{ documentId: null, seconds: 12 }]);
  });

  it("stops counting a reader who has walked away", () => {
    render(view([FINANCIALS, LEGAL], false));
    jest.advanceTimersByTime(10 * 60_000);
    selectSection("Financials");
    const sent = trackReading.mock.calls.flatMap((c) => (c as unknown as [string, string, { seconds: number }[]])[2]);
    const total = sent.reduce((n, e) => n + e.seconds, 0);
    // Only the first two minutes (before going idle) can count.
    expect(total).toBeLessThanOrEqual(120);
  });
});

describe("mobile navigation", () => {
  it("closes from a backdrop that is not inside the transformed sidebar", () => {
    const { container } = render(view([FINANCIALS], false));
    fireEvent.click(screen.getByRole("button", { name: "Toggle navigation" }));
    const backdrop = screen.getByRole("button", { name: "Close navigation" });
    // A fixed child of a transformed ancestor covers only that ancestor, so a
    // tap on the page behind the open menu would never reach it.
    expect(container.querySelector("aside")?.contains(backdrop)).toBe(false);
    fireEvent.click(backdrop);
    expect(screen.queryByRole("button", { name: "Close navigation" })).toBeNull();
  });
});

describe("a document section that shares its name with a Build page", () => {
  // A room's "Investment Strategy & Thesis" documents are filed under `thesis`,
  // and its "Track Record & Performance" documents under `track_record`: the same
  // keys as the firm's own thesis and track-record pages. Picking the document
  // section used to open the page instead, so the files in it could not be read.
  const THESIS_DOCS = section("thesis", "Investment Strategy & Thesis", "Fund I Investment Memorandum");
  const TRACK_DOCS = section("track_record", "Track Record & Performance", "Fund I Assumptions and Model Package");
  const TEAM_DOCS = section("team", "Team & Governance", "Team Bios");
  const OVERVIEW_DOCS = section("overview", "Firm Overview", "Firm Overview Deck");
  const THESIS = { strategy: "Build page strategy text", edge: null, targetReturns: null, sectors: [], geographies: [] } as never;

  function withBuildPages(docSections: ViewerSection[]) {
    return (
      <DataRoomViewer
        token="preview"
        shareId="preview"
        org={ORG}
        blended={{ ...BLENDED, dealCount: 2 }}
        thesis={THESIS}
        team={[{ name: "Pat Principal", title: "Partner", bio: null } as never]}
        entities={[]}
        docSections={docSections}
        gateConfig={{ requireEmail: false, requireNda: false, ndaText: null, passwordProtected: false }}
        contentReady
        preview
      />
    );
  }

  it.each([
    ["Investment Strategy & Thesis", "thesis", "Fund I Investment Memorandum"],
    ["Track Record & Performance", "track_record", "Fund I Assumptions and Model Package"],
    ["Team & Governance", "team", "Team Bios"],
    ["Firm Overview", "overview", "Firm Overview Deck"],
  ])("opens the %s documents, not the page of the same name", (label, key, docName) => {
    render(withBuildPages([THESIS_DOCS, TRACK_DOCS, TEAM_DOCS, OVERVIEW_DOCS]));
    fireEvent.click(screen.getByRole("button", { name: (accessibleName) => accessibleName.startsWith(label) }));
    expect(screen.getByRole("heading", { level: 1, name: label })).toBeInTheDocument();
    expect(screen.getByText(docName)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Body text unique to ${key}`))).toBeInTheDocument();
  });

  it("still opens the Build pages from their own nav entries", () => {
    render(withBuildPages([THESIS_DOCS]));
    fireEvent.click(screen.getByRole("button", { name: /^Investment Thesis$/ }));
    expect(screen.getByRole("heading", { level: 1, name: "Investment Thesis" })).toBeInTheDocument();
    expect(screen.queryByText("Fund I Investment Memorandum")).not.toBeInTheDocument();
  });
});

describe("the All documents view", () => {
  const MARKETING = {
    key: "marketing",
    label: "Marketing & Materials",
    docs: [
      { id: "m1", name: "Executive Summary", content: "x", hasFile: true, doc_type: "marketing", uploaded: true, preview_kind: "pdf" as const },
      { id: "m2", name: "Fund I Teaser", content: "x", hasFile: true, doc_type: "marketing", uploaded: true, preview_kind: "pdf" as const },
    ],
  };
  const THESIS = section("thesis", "Investment Strategy & Thesis", "Investment Memorandum");
  const TRACK = section("track_record", "Track Record & Performance", "Assumptions and Model Package");

  it("lists every published document, grouped by section as the room's Contents lists them", () => {
    render(view([MARKETING, THESIS, TRACK]));
    fireEvent.click(screen.getByRole("button", { name: /^All documents/ }));
    expect(screen.getByRole("heading", { level: 1, name: "All documents" })).toBeInTheDocument();
    for (const name of ["Executive Summary", "Fund I Teaser", "Investment Memorandum", "Assumptions and Model Package"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    // Section labels sit above their documents, in order.
    const text = document.body.textContent ?? "";
    const at = (s: string) => text.lastIndexOf(s);
    expect(at("Marketing & Materials")).toBeLessThan(at("Executive Summary"));
    expect(at("Fund I Teaser")).toBeLessThan(at("Investment Strategy & Thesis"));
    expect(at("Investment Memorandum")).toBeLessThan(at("Track Record & Performance"));
  });

  it("shows the total in the nav", () => {
    render(view([MARKETING, THESIS, TRACK]));
    expect(screen.getByRole("button", { name: /^All documents\s*4$/ })).toBeInTheDocument();
  });

  it("does not open a file preview for every document at once", () => {
    const { container } = render(view([MARKETING, THESIS, TRACK]));
    fireEvent.click(screen.getByRole("button", { name: /^All documents/ }));
    expect(container.querySelectorAll("iframe, video, img[alt]").length).toBe(0);
  });

  it("is absent when the room has nothing published", () => {
    render(view([]));
    expect(screen.queryByRole("button", { name: /^All documents/ })).not.toBeInTheDocument();
  });
});

describe("what a reader sees on opening the room", () => {
  it("is the room's published contents, with no click needed", () => {
    render(view([section("marketing", "Marketing & Materials", "Executive Summary"), section("thesis", "Investment Strategy & Thesis", "Investment Memorandum")]));
    expect(screen.getByRole("heading", { level: 1, name: "All documents" })).toBeInTheDocument();
    expect(screen.getByText("Executive Summary")).toBeInTheDocument();
    expect(screen.getByText("Investment Memorandum")).toBeInTheDocument();
  });

  it("still opens on Overview when nothing is published", () => {
    render(view([]));
    expect(screen.getByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument();
  });
});
