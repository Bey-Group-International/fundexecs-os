import { conversationFilename, threadToMarkdown, type ExportableTurn } from "./conversation-export";

const EXPORTED_AT = new Date("2026-08-28T14:00:00Z");

describe("conversationFilename", () => {
  it("slugs the conversation label and stamps the date", () => {
    expect(conversationFilename("Project Atlas", EXPORTED_AT)).toBe("earn-project-atlas-2026-08-28.md");
  });

  it("strips characters a filesystem would choke on", () => {
    expect(conversationFilename("Run › Diligence / Q3", EXPORTED_AT)).toBe("earn-run-diligence-q3-2026-08-28.md");
  });

  it("falls back to a generic name when the label slugs to nothing", () => {
    expect(conversationFilename("···", EXPORTED_AT)).toBe("earn-conversation-2026-08-28.md");
    expect(conversationFilename("", EXPORTED_AT)).toBe("earn-conversation-2026-08-28.md");
  });
});

describe("threadToMarkdown", () => {
  it("attributes each turn and keeps the order", () => {
    const turns: ExportableTurn[] = [
      { role: "user", text: "What's the cap rate spread on Atlas?" },
      { role: "earn", answer: "~120 bps wide of the Sun Belt comp set." },
    ];
    const md = threadToMarkdown(turns, { label: "Project Atlas", operator: "Dana Reyes", exportedAt: EXPORTED_AT });
    expect(md).toContain("# Earn · Project Atlas");
    expect(md).toContain("**Operator:** Dana Reyes");
    expect(md).toContain("**Exported:** 2026-08-28");
    expect(md.indexOf("### You")).toBeLessThan(md.indexOf("### Earn"));
    expect(md).toContain("What's the cap rate spread on Atlas?");
    expect(md).toContain("~120 bps wide of the Sun Belt comp set.");
  });

  it("marks an answer the operator stopped early", () => {
    const md = threadToMarkdown(
      [{ role: "earn", answer: "Partial thought", stopped: true }],
      { label: "Wallet", exportedAt: EXPORTED_AT },
    );
    expect(md).toContain("_(answer stopped early)_");
  });

  it("exports a plan turn as its title and steps, not a blank", () => {
    const md = threadToMarkdown(
      [{ role: "earn", planTitle: "Source Sun Belt multifamily", steps: [{ agent: "deal_sourcer", title: "Screen targets" }] }],
      { label: "Source", exportedAt: EXPORTED_AT },
    );
    expect(md).toContain("**Planned:** Source Sun Belt multifamily");
    expect(md).toContain("- deal_sourcer: Screen targets");
  });

  it("skips empty turns rather than emitting bare headings", () => {
    const md = threadToMarkdown(
      [{ role: "user", text: "   " }, { role: "earn", answer: "" }],
      { label: "Workspace", exportedAt: EXPORTED_AT },
    );
    expect(md).toContain("_This conversation is empty._");
    expect(md).not.toContain("### You");
  });

  it("omits the operator line when the name is unknown", () => {
    const md = threadToMarkdown(
      [{ role: "user", text: "hi" }],
      { label: "Workspace", operator: null, exportedAt: EXPORTED_AT },
    );
    expect(md).not.toContain("**Operator:**");
  });
});
