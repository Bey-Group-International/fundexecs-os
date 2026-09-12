/**
 * The library's two-pane workspace replaced a sixteen-section accordion in
 * which finding one document meant opening sections until it appeared. These
 * tests pin the behaviours that make the replacement worth having: the rail
 * keeps the library's true counts while the table narrows, the deep link from
 * readiness lands on a selected section rather than a flashed button, and the
 * per-row file actions match what the row actually holds — a document with no
 * file must not offer to open or detach one.
 */
jest.mock("./document-actions", () => ({
  addDocument: jest.fn(),
  newDocument: jest.fn(),
  updateDocumentStatus: jest.fn(),
}));
jest.mock("./upload-actions", () => ({ removeDocumentFile: jest.fn() }));
jest.mock("./DocumentUploader", () => ({
  DocumentUploader: ({ sectionLabel }: { sectionLabel: string }) => (
    <div>upload-zone:{sectionLabel}</div>
  ),
  ReplaceFileButton: ({ hasFile }: { hasFile: boolean }) => (
    <button type="button">{hasFile ? "Replace" : "Attach"}</button>
  ),
}));
jest.mock("@/components/build/room-actions", () => ({
  publishDocument: jest.fn(),
  unpublishDocument: jest.fn(),
}));
jest.mock("@/components/build/DeleteDocumentButton", () => ({
  DeleteDocumentButton: ({ name }: { name: string }) => (
    <button type="button">Delete {name}</button>
  ),
}));
jest.mock("@/components/build/GenerateAiButton", () => ({
  GenerateAiButton: () => <button type="button">Draft with Earn</button>,
}));

import { render, screen, within, fireEvent } from "@testing-library/react";
import { LibraryWorkspace } from "./LibraryWorkspace";
import type { LibraryDoc, LibrarySection } from "./LibraryControls";

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

function uploaded(id: string, name: string, section: string): LibraryDoc {
  return doc({
    id,
    name,
    section,
    storageKey: `${ORG}/${id}/abc.pdf`,
    hasContent: false,
    kind: "PDF",
    sizeBytes: 2_400_000,
    uploaded: true,
  });
}

const SECTIONS: LibrarySection[] = [
  {
    key: "fund_terms",
    label: "Fund Terms",
    description: "PPM, LPA, fees & carry.",
    viaBuild: false,
    aiDraftable: false,
    docs: [
      uploaded("d1", "Fund IV LPA", "fund_terms"),
      doc({ id: "d2", name: "Fee Schedule Notes", section: "fund_terms" }),
    ],
  },
  {
    key: "marketing",
    label: "Marketing & Materials",
    description: "Executive summary, investor deck.",
    viaBuild: false,
    aiDraftable: true,
    docs: [
      doc({
        id: "d3",
        name: "Investor Deck",
        section: "marketing",
        hasContent: false,
        kind: "Empty",
      }),
    ],
  },
];

function renderWorkspace() {
  return render(<LibraryWorkspace sections={SECTIONS} rooms={[{ id: "r1", name: "LP Room" }]} />);
}

function tableRows(): HTMLElement[] {
  const table = screen.getByRole("table");
  return within(table).getAllByRole("row").slice(1); // drop the header row
}

afterEach(() => {
  window.location.hash = "";
});

describe("LibraryWorkspace", () => {
  it("lists every document across sections by default", () => {
    renderWorkspace();
    expect(tableRows()).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Fund IV LPA" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Investor Deck" })).toBeInTheDocument();
  });

  it("narrows the table on search while the rail keeps the library's true counts", () => {
    renderWorkspace();
    fireEvent.change(screen.getByLabelText("Search documents"), { target: { value: "lpa" } });

    expect(tableRows()).toHaveLength(1);
    expect(screen.getByText("1 of 3 shown")).toBeInTheDocument();
    // The rail still reports what the firm holds, not what the search left.
    const railButton = screen.getByRole("button", { name: /All documents/ });
    expect(within(railButton).getByText("3")).toBeInTheDocument();
  });

  it("searches by section name and by file kind, not just document name", () => {
    renderWorkspace();
    const search = screen.getByLabelText("Search documents");

    fireEvent.change(search, { target: { value: "marketing" } });
    expect(tableRows()).toHaveLength(1);

    fireEvent.change(search, { target: { value: "pdf" } });
    expect(tableRows()).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Fund IV LPA" })).toBeInTheDocument();
  });

  it("scopes to a section and drops the now-redundant Section column", () => {
    renderWorkspace();
    expect(screen.getByRole("columnheader", { name: /Section/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Fund Terms/ }));

    expect(tableRows()).toHaveLength(2);
    expect(screen.queryByRole("columnheader", { name: /Section/ })).not.toBeInTheDocument();
    // New material now lands in the section being worked in.
    expect(screen.getByText("upload-zone:Fund Terms")).toBeInTheDocument();
  });

  it("filters to documents with nothing a reader could open", () => {
    renderWorkspace();
    // Only the deck has no file, no link, and nothing written.
    fireEvent.click(screen.getByRole("button", { name: /Nothing to open · 1/ }));

    const rows = tableRows();
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByRole("link", { name: "Investor Deck" })).toBeInTheDocument();
  });

  it("offers Open and Detach only for a document that actually has a file", () => {
    renderWorkspace();
    const rows = tableRows();
    const lpaRow = rows.find((r) => within(r).queryByRole("link", { name: "Fund IV LPA" }))!;
    const notesRow = rows.find((r) => within(r).queryByRole("link", { name: "Fee Schedule Notes" }))!;

    expect(within(lpaRow).getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      "/api/documents/d1/file",
    );
    expect(within(lpaRow).getByRole("button", { name: "Detach" })).toBeInTheDocument();
    expect(within(lpaRow).getByRole("button", { name: "Replace" })).toBeInTheDocument();

    expect(within(notesRow).queryByRole("link", { name: "Open" })).not.toBeInTheDocument();
    expect(within(notesRow).queryByRole("button", { name: "Detach" })).not.toBeInTheDocument();
    // A document with no file is offered one.
    expect(within(notesRow).getByRole("button", { name: "Attach" })).toBeInTheDocument();
  });

  it("reports an uploaded file's size and kind", () => {
    renderWorkspace();
    const lpaRow = tableRows().find((r) => within(r).queryByRole("link", { name: "Fund IV LPA" }))!;
    expect(within(lpaRow).getByText("PDF")).toBeInTheDocument();
    expect(within(lpaRow).getByText("2.3 MB")).toBeInTheDocument();
  });

  it("selects the section a readiness deep link points at", () => {
    window.location.hash = "#section-marketing";
    renderWorkspace();

    expect(tableRows()).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Investor Deck" })).toBeInTheDocument();
    expect(screen.getByText("upload-zone:Marketing & Materials")).toBeInTheDocument();
  });

  it("ignores a deep link to a section that does not exist", () => {
    window.location.hash = "#section-nonsense";
    renderWorkspace();
    expect(tableRows()).toHaveLength(3);
  });

  it("clears every filter at once from the empty state", () => {
    renderWorkspace();
    fireEvent.change(screen.getByLabelText("Search documents"), { target: { value: "zzzz" } });
    expect(screen.getByText("No documents match.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(tableRows()).toHaveLength(3);
  });
});
