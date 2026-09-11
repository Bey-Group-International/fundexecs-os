/**
 * The viewer's nav can change under a live selection: in the GP-side preview,
 * scoping to a link removes whole sections while one of them is being read.
 * The selection used to be repaired in an effect, which runs only after the
 * render that already dropped the section — so the viewer painted a frame with
 * an empty content pane and no nav item highlighted before correcting itself.
 * These tests pin the resolved-during-render behaviour that replaced it.
 */
const trackDwell = jest.fn();
jest.mock("@/components/build/materials-actions", () => ({
  trackDwell: (...args: unknown[]) => trackDwell(...args),
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

function view(docSections: ViewerSection[]) {
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
      preview
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

it("never records dwell time from a preview", () => {
  render(view([FINANCIALS, LEGAL]));
  selectSection("Financials");
  expect(trackDwell).not.toHaveBeenCalled();
});
