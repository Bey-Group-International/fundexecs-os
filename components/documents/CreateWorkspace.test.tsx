/**
 * Create exists because every one of these paths was already possible and none
 * was findable. These tests pin what it promises: the core-materials checklist
 * reflects the firm's actual library rather than a fixed list of gaps, a
 * material offers only the routes that exist for it, and every route creates a
 * draft — creating a document must never be a way to publish one.
 */
const newDocumentFromTemplate = jest.fn();
const newBlankDocument = jest.fn();
jest.mock("./create-actions", () => ({
  newDocumentFromTemplate: (fd: FormData) => newDocumentFromTemplate(fd),
  newBlankDocument: (fd: FormData) => newBlankDocument(fd),
}));
jest.mock("@/components/build/GenerateAiButton", () => ({
  GenerateAiButton: ({ sectionKey, docName }: { sectionKey: string; docName?: string }) => (
    <button type="button">{docName ? `AI ${docName}` : `AI ${sectionKey}`}</button>
  ),
}));

import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { CreateWorkspace } from "./CreateWorkspace";
import {
  AI_DRAFTABLE_SECTIONS,
  groupTemplates,
  keyMaterialStatus,
  missingMaterialCount,
} from "@/lib/document-create";
import { DATA_ROOM_SECTIONS } from "@/lib/data-room";

function renderCreate(docNames: string[] = [], usedSections: string[] = []) {
  const materials = keyMaterialStatus(docNames);
  render(
    <CreateWorkspace
      materials={materials}
      groups={groupTemplates()}
      missingCount={missingMaterialCount(materials)}
      usedTemplateSections={usedSections}
    />,
  );
  return materials;
}

// Each material row and template card is a labelled <article>, so a query can
// name the one it means instead of guessing at an ancestor div. Scoped by
// region because "Executive Summary" is both a core material and a template —
// the label alone is ambiguous here, as it would be to a screen reader.
function region(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

function materialRow(name: string): HTMLElement {
  return within(region("Core materials")).getByRole("article", { name });
}

function templateCard(label: string): HTMLElement {
  return within(region("Start from a template")).getByRole("article", { name: label });
}

beforeEach(() => {
  newDocumentFromTemplate.mockClear();
  newBlankDocument.mockClear();
});

describe("core materials", () => {
  it("counts what the firm already holds, not a fixed list of gaps", () => {
    renderCreate(["Fund IV Pitch Deck", "2026 Exec Summary"]);
    expect(within(region("Core materials")).getByText("2 of 5 in place")).toBeInTheDocument();
  });

  it("reports nothing in place for an empty library", () => {
    renderCreate([]);
    expect(within(region("Core materials")).getByText("0 of 5 in place")).toBeInTheDocument();
  });

  it("marks a held material as in the library and offers it no create routes", () => {
    renderCreate(["Investor Deck"]);
    const row = materialRow("Investor Deck");
    expect(within(row).getByText("In library")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Template" })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Blank" })).not.toBeInTheDocument();
  });

  it("offers a missing material every route that exists for it", () => {
    renderCreate([]);
    const row = materialRow("Executive Summary");
    // Has a template, and marketing is AI-draftable.
    expect(within(row).getByRole("button", { name: "Template" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "AI Executive Summary" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Blank" })).toBeInTheDocument();
  });

  it("omits the template route for a material that has no template", () => {
    renderCreate([]);
    const row = materialRow("Teaser");
    expect(within(row).queryByRole("button", { name: "Template" })).not.toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Blank" })).toBeInTheDocument();
  });

  it("starts a material from its template, named and filed as the material", async () => {
    renderCreate([]);
    const row = materialRow("Executive Summary");
    fireEvent.click(within(row).getByRole("button", { name: "Template" }));

    await waitFor(() => expect(newDocumentFromTemplate).toHaveBeenCalledTimes(1));
    const fd = newDocumentFromTemplate.mock.calls[0][0] as FormData;
    expect(fd.get("template_id")).toBe("exec_summary");
    expect(fd.get("name")).toBe("Executive Summary");
    // KEY_MATERIALS files it under marketing even though the template says overview.
    expect(fd.get("section")).toBe("marketing");
  });

  it("starts a material blank under its own section and name", async () => {
    renderCreate([]);
    fireEvent.click(within(materialRow("Teaser")).getByRole("button", { name: "Blank" }));

    await waitFor(() => expect(newBlankDocument).toHaveBeenCalledTimes(1));
    const fd = newBlankDocument.mock.calls[0][0] as FormData;
    expect(fd.get("name")).toBe("Teaser");
    expect(fd.get("section")).toBe("marketing");
  });
});

describe("template gallery", () => {
  it("shows every template, grouped under its section", () => {
    renderCreate();
    expect(screen.getAllByRole("button", { name: "Use template" })).toHaveLength(11);
    expect(templateCard("Due Diligence Questionnaire (DDQ)")).toBeInTheDocument();
    expect(templateCard("Investment Thesis")).toBeInTheDocument();
  });

  it("creates from a gallery template without naming a section", async () => {
    renderCreate();
    const card = templateCard("Investment Thesis");
    fireEvent.click(within(card).getByRole("button", { name: "Use template" }));

    await waitFor(() => expect(newDocumentFromTemplate).toHaveBeenCalledTimes(1));
    const fd = newDocumentFromTemplate.mock.calls[0][0] as FormData;
    expect(fd.get("template_id")).toBe("investment_thesis");
    // No override: the action falls back to the template's own section.
    expect(fd.get("section")).toBeNull();
  });

  it("previews a scaffold in place, and hides it again", () => {
    renderCreate();
    const card = templateCard("Investment Thesis");

    fireEvent.click(within(card).getByRole("button", { name: "Preview" }));
    // A heading from the scaffold body, not the card's own title.
    expect(within(card).getByText(/Market Opportunity/)).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Hide" })).toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: "Hide" }));
    expect(within(card).getByRole("button", { name: "Preview" })).toBeInTheDocument();
  });

  it("previews one template at a time", () => {
    renderCreate();
    const thesis = templateCard("Investment Thesis");
    const ddq = templateCard("Due Diligence Questionnaire (DDQ)");

    fireEvent.click(within(thesis).getByRole("button", { name: "Preview" }));
    fireEvent.click(within(ddq).getByRole("button", { name: "Preview" }));

    expect(within(thesis).getByRole("button", { name: "Preview" })).toBeInTheDocument();
    expect(within(ddq).getByRole("button", { name: "Hide" })).toBeInTheDocument();
  });
});

describe("start from scratch", () => {
  it("opens a named blank form and submits the chosen section", async () => {
    renderCreate();
    fireEvent.click(screen.getByRole("button", { name: "+ Blank document" }));

    fireEvent.change(screen.getByPlaceholderText("Document name (optional)"), {
      target: { value: "Side Letter Policy" },
    });
    fireEvent.change(screen.getByLabelText("Section"), { target: { value: "legal" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(newBlankDocument).toHaveBeenCalledTimes(1));
    const fd = newBlankDocument.mock.calls[0][0] as FormData;
    expect(fd.get("name")).toBe("Side Letter Policy");
    expect(fd.get("section")).toBe("legal");
  });

  it("names the section beside every draft button", () => {
    // Found by rendering in a real browser: GenerateAiButton's label is a fixed
    // "✦ AI Draft" with the section only in a tooltip. That reads fine in the
    // Library, where the button sits in a row that names itself, but five of
    // them side by side here were five identical buttons with nothing to choose
    // between.
    renderCreate();
    const scratch = within(region("Start from scratch"));
    for (const key of AI_DRAFTABLE_SECTIONS) {
      const label = DATA_ROOM_SECTIONS.find((s) => s.key === key)!.label;
      expect(scratch.getByText(label)).toBeInTheDocument();
    }
  });

  it("offers a draft button for exactly the AI-draftable sections", () => {
    renderCreate();
    const buttons = within(region("Start from scratch")).getAllByRole("button", {
      name: /^AI /,
    });
    expect(buttons).toHaveLength(AI_DRAFTABLE_SECTIONS.size);
  });

  it("can be dismissed without creating anything", () => {
    renderCreate();
    fireEvent.click(screen.getByRole("button", { name: "+ Blank document" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByPlaceholderText("Document name (optional)")).not.toBeInTheDocument();
    expect(newBlankDocument).not.toHaveBeenCalled();
  });
});
