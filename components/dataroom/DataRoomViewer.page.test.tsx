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
// pdf.js needs a real browser module system; the signing sheet is not what this test is about.
jest.mock("@/components/signing/PdfPages", () => ({ PdfPages: () => null }));
jest.mock("./viewer-actions", () => ({
  trackReading: (...args: unknown[]) => trackReading(...(args as [])),
  recordRoomOpen: (...args: unknown[]) => recordRoomOpen(...(args as [])),
  recordNdaSignature: jest.fn(),
  passEmailGate: jest.fn(),
}));
jest.mock("@/components/build/materials-actions", () => ({
  verifySharePassword: jest.fn(),
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

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
      gateConfig={{
        requireEmail: false,
        requireNda: false,
        ndaText: null,
        passwordProtected: false,
      }}
      contentReady
      preview={preview}
    />
  );
}

const FINANCIALS = section(
  "financials",
  "Financials & Audits",
  "Audited Financials",
);
const LEGAL = section("legal", "Legal & Structure", "Formation Documents");

/** The menu is a row of buttons under the header. */
const menuLabels = () =>
  Array.from(
    screen.getByRole("navigation", { name: "Sections" }).querySelectorAll("button"),
  ).map((b) => b.textContent);

describe("the room as one page", () => {
  // Earlier tests unmount live viewers, which report their time on the way out.
  beforeEach(() => {
    trackReading.mockClear();
    recordRoomOpen.mockClear();
  });

  it("shows the hero and every section on one scroll, in the room's order, with no sidebar", () => {
    const { container } = render(view([FINANCIALS, LEGAL], false));
    expect(
      screen.getByRole("heading", { level: 1, name: "Alpha Capital" }),
    ).toBeInTheDocument();
    // Every section's documents are on the page without picking one.
    expect(screen.getByText(/Body text unique to financials/)).toBeInTheDocument();
    expect(screen.getByText(/Body text unique to legal/)).toBeInTheDocument();
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual(["Legal & Structure", "Financials & Audits"]);
    expect(container.querySelector("aside")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Section" })).toBeNull();
  });

  it("offers a menu entry per section, in the same order as the page", () => {
    render(view([FINANCIALS, LEGAL], false));
    expect(menuLabels()).toEqual(["Legal & Structure", "Financials & Audits"]);
  });

  it("jumps to a section from the menu", () => {
    const scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(view([FINANCIALS, LEGAL], false));
    fireEvent.click(screen.getByRole("button", { name: "Financials & Audits" }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    const band = scrollIntoView.mock.instances[0] as HTMLElement;
    expect(band.dataset.band).toBe("sec-financials");
    expect(screen.getByRole("button", { name: "Financials & Audits" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("drops a section from the page and the menu when a link no longer allows it", () => {
    const { rerender } = render(view([FINANCIALS, LEGAL]));
    expect(screen.getByText(/Body text unique to financials/)).toBeInTheDocument();
    rerender(view([LEGAL]));
    expect(screen.queryByText(/Body text unique to financials/)).toBeNull();
    expect(menuLabels()).toEqual(["Legal & Structure"]);
  });

  it("says so when nothing has been published", () => {
    render(view([]));
    expect(screen.getByText("Nothing has been published to this room yet.")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull();
  });

  it("never records anything from a preview", () => {
    render(view([FINANCIALS, LEGAL]));
    fireEvent.click(screen.getByRole("button", { name: "Financials & Audits" }));
    expect(trackReading).not.toHaveBeenCalled();
    expect(recordRoomOpen).not.toHaveBeenCalled();
  });

  it("does not open a file preview for every document at once", () => {
    const m = {
      key: "marketing",
      label: "Marketing & Materials",
      docs: ["a", "b"].map((id) => ({
        id,
        name: `Doc ${id}`,
        content: "x",
        hasFile: true,
        doc_type: "marketing",
        uploaded: true,
        preview_kind: "pdf" as const,
      })),
    };
    const { container } = render(view([m, FINANCIALS], false));
    expect(container.querySelectorAll("iframe, video, img[alt]").length).toBe(0);
  });
});

describe("the room's own type and palette", () => {
  it("scopes the room, ready or behind a gate, to the fx-room class and nothing outside it", () => {
    const { container, rerender } = render(view([FINANCIALS], false));
    expect(container.firstElementChild).toHaveClass("fx-room");
    rerender(
      <DataRoomViewer
        token="t"
        shareId="s"
        org={ORG}
        blended={BLENDED}
        thesis={null}
        team={[]}
        entities={[]}
        docSections={[]}
        gateConfig={{ requireEmail: true, requireNda: false, ndaText: null, passwordProtected: false }}
        contentReady={false}
      />,
    );
    expect(container.firstElementChild).toHaveClass("fx-room");
  });

  it("sets the serif, the sans and the white palette on that class only", () => {
    const css = require("fs").readFileSync(require("path").join(process.cwd(), "app/globals.css"), "utf8") as string;
    const block = css.match(/\.fx-room \{([^}]*)\}/)![1];
    expect(block).toMatch(/--font-display:\s*var\(--font-room-serif\)/);
    expect(block).toMatch(/--font-sans:\s*var\(--font-room-sans\)/);
    expect(block).toMatch(/--font-mono:\s*var\(--font-room-sans\)/);
    expect(block).toMatch(/--fx-surface-0:\s*255 255 255/);
    // The app's own tokens are untouched.
    expect(css).toMatch(/:root \{[^}]*--fx-surface-0: 240 245 252/);
  });
});

describe("the hero", () => {
  const props = (over: object = {}) => ({
    token: "t",
    shareId: "s",
    org: { ...ORG, tagline: "Culture, Capital, and Control", entity_type: "LP", jurisdiction: "Delaware" },
    blended: BLENDED,
    thesis: null,
    team: [],
    entities: [],
    docSections: [FINANCIALS],
    gateConfig: { requireEmail: false, requireNda: false, ndaText: null, passwordProtected: false },
    contentReady: true,
    ...over,
  });

  it("names the firm, the room and the firm's note to the reader", () => {
    render(
      <DataRoomViewer
        {...props({ room: { name: "Fund III Raise", welcomeNote: "Welcome.\nStart with the memo." } })}
      />,
    );
    expect(screen.getByText("Culture, Capital, and Control")).toBeInTheDocument();
    expect(screen.getByText(/Data room · Fund III Raise/)).toBeInTheDocument();
    expect(screen.getByText(/Start with the memo\./)).toBeInTheDocument();
  });

  it("shows no note box when there is no note", () => {
    render(<DataRoomViewer {...props({ room: { name: "Fund III Raise", welcomeNote: null } })} />);
    expect(screen.queryByText(/Welcome\./)).toBeNull();
  });

  it("shows the track record figures it has, the document count and the last change", () => {
    render(
      <DataRoomViewer
        {...props({
          blended: { ...BLENDED, dealCount: 4, weightedGrossIrr: 21.4, pooledMoic: 2.5, dpi: null, totalInvested: 5_000_000 },
          docSections: [
            {
              ...FINANCIALS,
              docs: [{ ...FINANCIALS.docs[0], updatedAt: "2026-10-12T09:00:00Z" }],
            },
          ],
        })}
      />,
    );
    const hero = screen.getByRole("region", { name: "Overview" });
    const text = hero.textContent ?? "";
    expect(text).toContain("21%");
    expect(text).toContain("2.5x");
    expect(text).toContain("$5.0M");
    // DPI is unknown: no tile of dashes for it.
    expect(text).not.toContain("DPI");
    expect(text).toContain("Document");
    expect(text).toContain("Oct 12, 2026");
  });

  it("offers View documents and Contact the team, and only when each can work", () => {
    const { rerender } = render(
      <DataRoomViewer
        {...props({ team: [{ name: "Pat", title: null, email: "pat@alpha.com" }] })}
      />,
    );
    expect(screen.getByRole("button", { name: "View documents" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contact the team" })).toHaveAttribute("href", "mailto:pat@alpha.com");
    // Documents but nobody to write to: the button stays, the mail link does not.
    rerender(<DataRoomViewer {...props({ team: [{ name: "Pat", title: null, email: null }] })} />);
    expect(screen.getByRole("button", { name: "View documents" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Contact the team" })).toBeNull();
    rerender(<DataRoomViewer {...props({ docSections: [] })} />);
    expect(screen.queryByRole("button", { name: "View documents" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Contact the team" })).toBeNull();
  });

  it("has no hero on a link to one document", () => {
    render(
      <DataRoomViewer
        {...props({ viewControls: { allowDownload: true, watermark: false, singleDocument: true } })}
      />,
    );
    expect(screen.queryByRole("region", { name: "Overview" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull();
    expect(screen.getByText(/Body text unique to financials/)).toBeInTheDocument();
  });
});

describe("a live reader", () => {
  beforeEach(() => {
    trackReading.mockClear();
    recordRoomOpen.mockClear();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it("reports the open once and the time read", () => {
    const { rerender, unmount } = render(view([FINANCIALS, LEGAL], false));
    rerender(view([FINANCIALS, LEGAL], false));
    expect(recordRoomOpen).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 4; i++) {
      fireEvent.scroll(window);
      jest.advanceTimersByTime(3_000);
    }
    unmount();
    const sent = trackReading.mock.calls.flatMap(
      (c) => (c as unknown as [string, string, { seconds: number }[]])[2],
    );
    expect(sent.reduce((n, e) => n + e.seconds, 0)).toBe(12);
  });

  it("stops counting a reader who has walked away", () => {
    const { unmount } = render(view([FINANCIALS, LEGAL], false));
    jest.advanceTimersByTime(10 * 60_000);
    unmount();
    const sent = trackReading.mock.calls.flatMap(
      (c) => (c as unknown as [string, string, { seconds: number }[]])[2],
    );
    expect(sent.reduce((n, e) => n + e.seconds, 0)).toBeLessThanOrEqual(120);
  });
});

describe("the phone layout", () => {
  it("is a single column with no rail or selector, in the preview too", () => {
    const { container } = render(
      <DataRoomViewer
        token="preview"
        shareId="preview"
        org={ORG}
        blended={BLENDED}
        thesis={null}
        team={[]}
        entities={[]}
        docSections={[FINANCIALS, LEGAL]}
        compact
        preview
        contentReady
        gateConfig={{ requireEmail: false, requireNda: false, ndaText: null, passwordProtected: false }}
      />,
    );
    expect(container.querySelector("aside")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Section" })).toBeNull();
    expect(screen.getByRole("navigation", { name: "Sections" }).className).toMatch(/overflow-x-auto/);
  });
});

describe("the institutional index", () => {
  const dated = (
    over: Partial<ViewerSection["docs"][number]> & { id: string; name: string },
  ) => ({
    content: "x",
    hasFile: false,
    doc_type: "marketing",
    ...over,
  });
  const MARKETING = {
    key: "marketing",
    label: "Marketing & Materials",
    docs: [
      dated({
        id: "a",
        name: "Executive Summary",
        updatedAt: "2026-10-12T09:00:00Z",
        isNew: true,
      }),
      dated({
        id: "b",
        name: "Fund I Teaser",
        updatedAt: "2026-09-01T09:00:00Z",
        isNew: false,
      }),
    ],
  };

  it("opens with a cover: the firm, what it is, how much is in the room and when it last changed", () => {
    render(
      <DataRoomViewer
        token="t"
        shareId="s"
        org={{
          ...ORG,
          tagline: "Culture, Capital, and Control",
          entity_type: "LP",
          jurisdiction: "Delaware",
        }}
        blended={BLENDED}
        thesis={null}
        team={[]}
        entities={[]}
        docSections={[MARKETING]}
        gateConfig={{
          requireEmail: false,
          requireNda: false,
          ndaText: null,
          passwordProtected: false,
        }}
        contentReady
      />,
    );
    const hero = screen.getByRole("region", { name: "Overview" });
    expect(hero).toHaveTextContent("Confidential · Data room");
    expect(hero).toHaveTextContent("Culture, Capital, and Control");
    expect(hero).toHaveTextContent(/LP\s+·\s+Delaware/);
    expect(hero).toHaveTextContent("2Documents");
    expect(hero).toHaveTextContent("Oct 12, 2026Last updated");
  });

  it("dates every document, in a form that reads the same on server and browser", () => {
    render(view([MARKETING]));
    const times = Array.from(document.querySelectorAll("time"));
    expect(times.map((t) => [t.textContent, t.getAttribute("datetime")])).toEqual([
      ["Oct 12, 2026", "2026-10-12T09:00:00Z"],
      ["Sep 1, 2026", "2026-09-01T09:00:00Z"],
    ]);
  });

  it("marks only what is new since the reader's last visit", () => {
    render(view([MARKETING]));
    expect(screen.getAllByText("New")).toHaveLength(1);
    const row = screen.getByText("Executive Summary").closest("[data-doc-id]")!;
    expect(row).toHaveTextContent("New");
    expect(
      screen.getByText("Fund I Teaser").closest("[data-doc-id]"),
    ).not.toHaveTextContent("New");
  });

  it("shows no date or marker for a document without one", () => {
    render(
      view([section("legal", "Legal & Structure", "Formation Documents")]),
    );
    expect(screen.queryByText("New")).toBeNull();
    expect(document.querySelector("time")).toBeNull();
  });

  it("states on paper who the room was prepared for, and not in the GP preview", () => {
    const { rerender } = render(
      <DataRoomViewer
        token="t"
        shareId="s"
        org={ORG}
        blended={BLENDED}
        thesis={null}
        team={[]}
        entities={[]}
        docSections={[MARKETING]}
        viewerLabel="lp@example.com"
        gateConfig={{
          requireEmail: false,
          requireNda: false,
          ndaText: null,
          passwordProtected: false,
        }}
        contentReady
      />,
    );
    const footer = screen.getByText(/Prepared for lp@example.com/);
    expect(footer.className).toMatch(/print:block/);
    expect(footer.className).toMatch(/\bhidden\b/);
    rerender(view([MARKETING], true));
    expect(screen.queryByText(/Prepared for/)).toBeNull();
  });
});

describe("a document section that shares its name with a Build page", () => {
  // A room's "Investment Strategy & Thesis" documents are filed under `thesis`,
  // and its "Track Record & Performance" documents under `track_record`: the same
  // keys as the firm's own thesis and track-record pages. Picking the document
  // section used to open the page instead, so the files in it could not be read.
  const THESIS_DOCS = section(
    "thesis",
    "Investment Strategy & Thesis",
    "Fund I Investment Memorandum",
  );
  const TRACK_DOCS = section(
    "track_record",
    "Track Record & Performance",
    "Fund I Assumptions and Model Package",
  );
  const TEAM_DOCS = section("team", "Team & Governance", "Team Bios");
  const OVERVIEW_DOCS = section(
    "overview",
    "Firm Overview",
    "Firm Overview Deck",
  );
  const THESIS = {
    title: "Build thesis title",
    summary: "Build thesis summary text",
    asset_classes: ["Private credit"],
    geographies: null,
    target_irr: 18,
    target_moic: null,
    check_size_min: null,
    check_size_max: null,
  };

  function withBuildPages(
    docSections: ViewerSection[],
    build: { thesis?: typeof THESIS | null; deals?: number } = {},
  ) {
    return (
      <DataRoomViewer
        token="preview"
        shareId="preview"
        org={ORG}
        blended={{ ...BLENDED, dealCount: build.deals ?? 2 }}
        thesis={build.thesis === undefined ? THESIS : build.thesis}
        team={[{ name: "Pat Principal", title: "Partner", bio: null } as never]}
        entities={[]}
        docSections={docSections}
        gateConfig={{
          requireEmail: false,
          requireNda: false,
          ndaText: null,
          passwordProtected: false,
        }}
        contentReady
        preview
      />
    );
  }

  it.each([
    ["Investment Strategy & Thesis", "thesis", "Fund I Investment Memorandum"],
    [
      "Track Record & Performance",
      "track_record",
      "Fund I Assumptions and Model Package",
    ],
    ["Team & Governance", "team", "Team Bios"],
    ["Firm Overview", "overview", "Firm Overview Deck"],
  ])(
    "shows the %s documents on the page, not only the page of the same name",
    (label, key, docName) => {
      render(
        withBuildPages([THESIS_DOCS, TRACK_DOCS, TEAM_DOCS, OVERVIEW_DOCS]),
      );
      expect(
        screen.getByRole("heading", { level: 2, name: label }),
      ).toBeInTheDocument();
      expect(screen.getByText(docName)).toBeInTheDocument();
      expect(
        screen.getByText(new RegExp(`Body text unique to ${key}`)),
      ).toBeInTheDocument();
    },
  );

  it("has one band and one menu entry for the thesis and one for the track record", () => {
    render(withBuildPages([THESIS_DOCS, TRACK_DOCS]));
    const labels = menuLabels();
    expect(labels.filter((l) => /Investment/.test(l ?? ""))).toHaveLength(1);
    expect(labels.filter((l) => /Track Record/.test(l ?? ""))).toHaveLength(1);
    expect(
      screen.getAllByRole("heading", { level: 2, name: /Investment Strategy/ }),
    ).toHaveLength(1);
  });

  it("shows the Build thesis and the thesis documents together in one band", () => {
    render(withBuildPages([THESIS_DOCS]));
    const band = screen
      .getByRole("heading", { level: 2, name: "Investment Strategy & Thesis" })
      .closest("section")!;
    expect(band).toHaveTextContent("Build thesis title");
    expect(band).toHaveTextContent("Build thesis summary text");
    expect(band).toHaveTextContent("Fund I Investment Memorandum");
  });

  it("shows the Build track record and the track record documents together in one band", () => {
    render(withBuildPages([TRACK_DOCS], { deals: 3 }));
    const band = screen
      .getByRole("heading", { level: 2, name: "Track Record & Performance" })
      .closest("section")!;
    expect(band).toHaveTextContent("Gross IRR");
    expect(band).toHaveTextContent(/3 deals/);
    expect(band).toHaveTextContent("Fund I Assumptions and Model Package");
  });

  it("offers the thesis band from Build alone, with no document filed there", () => {
    render(withBuildPages([], { deals: 0 }));
    expect(screen.getByText("Build thesis summary text")).toBeInTheDocument();
    expect(menuLabels()).toEqual(["Investment Strategy & Thesis", "Team"]);
  });

  it("offers neither band when Build has nothing and no document is filed there", () => {
    render(withBuildPages([], { thesis: null, deals: 0 }));
    expect(
      screen.queryByRole("heading", { level: 2, name: /Investment Strategy/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("heading", { level: 2, name: /Track Record/ }),
    ).toBeNull();
  });
});

describe("a gated link", () => {
  // The first render sends no content (the reader has not cleared the gate); the
  // server then refreshes the page with the room. The viewer is the same
  // instance across that refresh and must show the room, not the empty render.
  function gated(ready: boolean, docSections: ViewerSection[]) {
    return (
      <DataRoomViewer
        token="tok"
        shareId="share-1"
        org={ORG}
        blended={BLENDED}
        thesis={null}
        team={[]}
        entities={[]}
        docSections={docSections}
        gateConfig={{
          requireEmail: true,
          requireNda: false,
          ndaText: null,
          passwordProtected: false,
        }}
        contentReady={ready}
      />
    );
  }
  const ROOM = [
    section("marketing", "Marketing & Materials", "Executive Summary"),
    section("thesis", "Investment Strategy & Thesis", "Investment Memorandum"),
  ];

  it("shows nothing of the room before the gate, and the whole page once it opens", () => {
    const { rerender } = render(gated(false, []));
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull();
    rerender(gated(true, ROOM));
    expect(
      screen.getByRole("heading", { level: 1, name: "Alpha Capital" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Executive Summary")).toBeInTheDocument();
    expect(screen.getByText("Investment Memorandum")).toBeInTheDocument();
  });
});
