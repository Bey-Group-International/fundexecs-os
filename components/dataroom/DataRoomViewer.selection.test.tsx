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

/** The nav always opens on Overview, so a section has to be picked first for
 * "the selected section disappears" to mean anything. */
function selectSection(label: string) {
  fireEvent.click(
    screen.getByRole("button", { name: new RegExp(label.split(" ")[0], "i") }),
  );
}

it("shows the section a reader picked", () => {
  render(view([FINANCIALS, LEGAL]));
  selectSection("Financials");
  expect(
    screen.getByText(/Body text unique to financials/),
  ).toBeInTheDocument();
});

it("falls back to a surviving section when the selected one is scoped away", () => {
  const { rerender } = render(view([FINANCIALS, LEGAL]));
  selectSection("Financials");
  expect(
    screen.getByText(/Body text unique to financials/),
  ).toBeInTheDocument();

  // Scoping to a link that publishes only Legal drops the section being read.
  rerender(view([LEGAL]));

  // The pane must show a real section rather than an empty frame. Overview is
  // the first surviving nav item, so that is what the reader lands on.
  expect(
    screen.queryByText(/Body text unique to financials/),
  ).not.toBeInTheDocument();
  // SectionHeader renders the pane's own <h1>, so a real section is showing
  // rather than the null ContentPanel returned for an unmatched selection.
  expect(
    screen.getByRole("heading", { level: 1, name: "Overview" }),
  ).toBeInTheDocument();
});

it("keeps the selection when some other section is removed", () => {
  const { rerender } = render(view([FINANCIALS, LEGAL]));
  selectSection("Financials");
  rerender(view([FINANCIALS]));
  expect(
    screen.getByText(/Body text unique to financials/),
  ).toBeInTheDocument();
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
    const [token, , entries] = trackReading.mock.calls[0] as unknown as [
      string,
      string,
      { documentId: string | null; seconds: number }[],
    ];
    expect(token).toBe("preview");
    // jsdom has no layout, so nothing is "in view": the time lands on the overview.
    expect(entries).toEqual([{ documentId: null, seconds: 12 }]);
  });

  it("stops counting a reader who has walked away", () => {
    render(view([FINANCIALS, LEGAL], false));
    jest.advanceTimersByTime(10 * 60_000);
    selectSection("Financials");
    const sent = trackReading.mock.calls.flatMap(
      (c) => (c as unknown as [string, string, { seconds: number }[]])[2],
    );
    const total = sent.reduce((n, e) => n + e.seconds, 0);
    // Only the first two minutes (before going idle) can count.
    expect(total).toBeLessThanOrEqual(120);
  });
});

describe("mobile navigation", () => {
  // Below the desktop breakpoint the contents rail is hidden and a selector under
  // the header takes its place, so there is no slide-out menu to open or dismiss.
  it("offers the sections as a selector, and choosing one opens it", () => {
    render(view([FINANCIALS, LEGAL], false));
    const select = screen.getByRole("combobox", { name: "Section" });
    expect(
      Array.from(select.querySelectorAll("option")).map((o) => o.textContent),
    ).toEqual([
      "Overview",
      "All documents (2)",
      // The room's own section order, not the order they were given in.
      "Legal & Structure",
      "Financials & Audits",
    ]);
    fireEvent.change(select, { target: { value: "docs:legal" } });
    expect(
      screen.getByRole("heading", { level: 1, name: "Legal & Structure" }),
    ).toBeInTheDocument();
    expect(select).toHaveValue("docs:legal");
  });

  it("has no slide-out menu to toggle or dismiss", () => {
    render(view([FINANCIALS], false));
    expect(
      screen.queryByRole("button", { name: "Toggle navigation" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Close navigation" }),
    ).toBeNull();
  });

  it("keeps the rail off phones and off paper", () => {
    const { container } = render(view([FINANCIALS], false));
    const aside = container.querySelector("aside")!;
    expect(aside.className).toMatch(/\bhidden\b/);
    expect(aside.className).toMatch(/lg:flex/);
    expect(aside.className).toMatch(/print:hidden/);
  });

  it("shows the phone layout in the preview when asked, whatever the window width", () => {
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
        gateConfig={{
          requireEmail: false,
          requireNda: false,
          ndaText: null,
          passwordProtected: false,
        }}
      />,
    );
    expect(
      screen.getByRole("combobox", { name: "Section" }),
    ).toBeInTheDocument();
    expect(container.querySelector("aside")?.className).toMatch(/\bhidden\b/);
  });

  it("is not shown in the GP preview, which keeps its own rail", () => {
    render(view([FINANCIALS], true));
    expect(screen.queryByRole("combobox", { name: "Section" })).toBeNull();
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
    expect(screen.getByText("Confidential · Data room")).toBeInTheDocument();
    expect(
      screen.getByText("Culture, Capital, and Control", {
        selector: "p.text-base",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /LP · Delaware\s+·\s+2 documents\s+·\s+Updated Oct 12, 2026/,
      ),
    ).toBeInTheDocument();
  });

  it("dates every document, in a form that reads the same on server and browser", () => {
    render(view([MARKETING]));
    expect(screen.getByText("Oct 12, 2026")).toHaveAttribute(
      "datetime",
      "2026-10-12T09:00:00Z",
    );
    expect(screen.getByText("Sep 1, 2026")).toBeInTheDocument();
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
    "opens the %s documents, not the page of the same name",
    (label, key, docName) => {
      render(
        withBuildPages([THESIS_DOCS, TRACK_DOCS, TEAM_DOCS, OVERVIEW_DOCS]),
      );
      fireEvent.click(
        screen.getByRole("button", {
          name: (accessibleName) => accessibleName.startsWith(label),
        }),
      );
      expect(
        screen.getByRole("heading", { level: 1, name: label }),
      ).toBeInTheDocument();
      expect(screen.getByText(docName)).toBeInTheDocument();
      expect(
        screen.getByText(new RegExp(`Body text unique to ${key}`)),
      ).toBeInTheDocument();
    },
  );

  it("has one entry for the thesis and one for the track record, not a page and a section each", () => {
    render(withBuildPages([THESIS_DOCS, TRACK_DOCS]));
    const labels = screen.getAllByRole("button").map((b) => b.textContent);
    expect(labels.filter((l) => /Investment/.test(l ?? ""))).toHaveLength(1);
    expect(labels.filter((l) => /Track Record/.test(l ?? ""))).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: /^Investment Thesis$/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Track Record$/ }),
    ).not.toBeInTheDocument();
  });

  it("shows the Build thesis and the thesis documents together in one section", () => {
    render(withBuildPages([THESIS_DOCS]));
    fireEvent.click(
      screen.getByRole("button", {
        name: (n) => n.startsWith("Investment Strategy"),
      }),
    );
    expect(screen.getByText("Build thesis title")).toBeInTheDocument();
    expect(screen.getByText("Build thesis summary text")).toBeInTheDocument();
    expect(
      screen.getByText("Fund I Investment Memorandum"),
    ).toBeInTheDocument();
  });

  it("shows the Build track record and the track record documents together in one section", () => {
    render(withBuildPages([TRACK_DOCS], { deals: 3 }));
    fireEvent.click(
      screen.getByRole("button", { name: (n) => n.startsWith("Track Record") }),
    );
    expect(screen.getByText("Gross IRR")).toBeInTheDocument();
    expect(screen.getByText(/3 deals/)).toBeInTheDocument();
    expect(
      screen.getByText("Fund I Assumptions and Model Package"),
    ).toBeInTheDocument();
  });

  it("offers the thesis section from Build alone, with no document filed there", () => {
    render(withBuildPages([], { deals: 0 }));
    fireEvent.click(
      screen.getByRole("button", {
        name: (n) => n.startsWith("Investment Strategy"),
      }),
    );
    expect(screen.getByText("Build thesis summary text")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: (n) => n.startsWith("Track Record"),
      }),
    ).not.toBeInTheDocument();
  });

  it("offers neither section when Build has nothing and no document is filed there", () => {
    render(withBuildPages([], { thesis: null, deals: 0 }));
    expect(
      screen.queryByRole("button", {
        name: (n) => n.startsWith("Investment Strategy"),
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: (n) => n.startsWith("Track Record"),
      }),
    ).not.toBeInTheDocument();
  });
});

describe("the All documents view", () => {
  const MARKETING = {
    key: "marketing",
    label: "Marketing & Materials",
    docs: [
      {
        id: "m1",
        name: "Executive Summary",
        content: "x",
        hasFile: true,
        doc_type: "marketing",
        uploaded: true,
        preview_kind: "pdf" as const,
      },
      {
        id: "m2",
        name: "Fund I Teaser",
        content: "x",
        hasFile: true,
        doc_type: "marketing",
        uploaded: true,
        preview_kind: "pdf" as const,
      },
    ],
  };
  const THESIS = section(
    "thesis",
    "Investment Strategy & Thesis",
    "Investment Memorandum",
  );
  const TRACK = section(
    "track_record",
    "Track Record & Performance",
    "Assumptions and Model Package",
  );

  it("lists every published document, grouped by section as the room's Contents lists them", () => {
    render(view([MARKETING, THESIS, TRACK]));
    fireEvent.click(screen.getByRole("button", { name: /^All documents/ }));
    expect(
      screen.getByRole("heading", { level: 1, name: "All documents" }),
    ).toBeInTheDocument();
    for (const name of [
      "Executive Summary",
      "Fund I Teaser",
      "Investment Memorandum",
      "Assumptions and Model Package",
    ]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    // Section labels sit above their documents, in order.
    const text = document.body.textContent ?? "";
    const at = (s: string) => text.lastIndexOf(s);
    expect(at("Marketing & Materials")).toBeLessThan(at("Executive Summary"));
    expect(at("Fund I Teaser")).toBeLessThan(
      at("Investment Strategy & Thesis"),
    );
    expect(at("Investment Memorandum")).toBeLessThan(
      at("Track Record & Performance"),
    );
  });

  it("shows the total in the nav", () => {
    render(view([MARKETING, THESIS, TRACK]));
    expect(
      screen.getByRole("button", { name: /^All documents\s*4$/ }),
    ).toBeInTheDocument();
  });

  it("does not open a file preview for every document at once", () => {
    const { container } = render(view([MARKETING, THESIS, TRACK]));
    fireEvent.click(screen.getByRole("button", { name: /^All documents/ }));
    expect(container.querySelectorAll("iframe, video, img[alt]").length).toBe(
      0,
    );
  });

  it("is absent when the room has nothing published", () => {
    render(view([]));
    expect(
      screen.queryByRole("button", { name: /^All documents/ }),
    ).not.toBeInTheDocument();
  });
});

describe("what a reader sees on opening the room", () => {
  it("is the room's published contents, with no click needed", () => {
    render(
      view([
        section("marketing", "Marketing & Materials", "Executive Summary"),
        section(
          "thesis",
          "Investment Strategy & Thesis",
          "Investment Memorandum",
        ),
      ]),
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "All documents" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Executive Summary")).toBeInTheDocument();
    expect(screen.getByText("Investment Memorandum")).toBeInTheDocument();
  });

  it("still opens on Overview when nothing is published", () => {
    render(view([]));
    expect(
      screen.getByRole("heading", { level: 1, name: "Overview" }),
    ).toBeInTheDocument();
  });
});

describe("a gated link", () => {
  // The first render sends no content (the reader has not cleared the gate); the
  // server then refreshes the page with the room. The viewer is the same
  // instance across that refresh, so its state must not be frozen at the empty
  // render's defaults.
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

  it("lands on the room's contents once the gate opens", () => {
    const { rerender } = render(gated(false, []));
    rerender(gated(true, ROOM));
    expect(
      screen.getByRole("heading", { level: 1, name: "All documents" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Investment Memorandum")).toBeInTheDocument();
  });

  it("keeps a section the reader picked when the page refreshes again", () => {
    const { rerender } = render(gated(true, ROOM));
    fireEvent.click(
      screen.getByRole("button", {
        name: (n) => n.startsWith("Investment Strategy"),
      }),
    );
    rerender(gated(true, [...ROOM]));
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Investment Strategy & Thesis",
      }),
    ).toBeInTheDocument();
  });
});
