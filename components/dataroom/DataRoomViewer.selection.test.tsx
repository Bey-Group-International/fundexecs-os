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
        storage_key: null,
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
