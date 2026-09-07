// The report markdown, put through the exporters that will actually render it.
//
// report-export.test.ts proves the markdown says the right things. This proves
// the five formats can carry it: a heading level or a list shape the renderers
// mishandle would otherwise only show up in a downloaded file.

import {
  isBinaryFormat,
  renderArtifact,
  type ExportFormat,
} from "@/lib/artifacts/export";
import { renderArtifactBinary } from "@/lib/artifacts/export-binary";
import { buildReportMarkdown, type ReportExportInput } from "@/lib/meetings/report-export";

const report: ReportExportInput = {
  title: "Q3 LP Update",
  createdAt: "2026-09-07T14:00:00.000Z",
  startedAt: "2026-09-07T14:00:00.000Z",
  endedAt: "2026-09-07T14:32:00.000Z",
  summary: "Walked the LPs through Q3 marks and the timing of the close.",
  keyPoints: ["NAV up 4%", "Two new commitments", "Fees unchanged"],
  actionItems: ["Send the deck to Alina", "Confirm the October date"],
  analysis: {
    decisions: ["Hold the close until October"],
    follow_up_draft: "Hi all,\n\nThanks for the time today.\n\n— Ray",
    next_meeting_suggestion: "Reconvene after the October close",
    sentiment: "positive",
  },
  fullTranscript: "Alina: Morning everyone.\nRay: Let's start with the marks.",
};

const FORMATS: ExportFormat[] = ["md", "html", "rtf", "docx", "pdf"];

describe("report export renders in every offered format", () => {
  const markdown = buildReportMarkdown(report, { includeTranscript: true });

  it.each(FORMATS)("renders %s without throwing", async (format) => {
    if (isBinaryFormat(format)) {
      const bytes = await renderArtifactBinary(format, markdown, report.title ?? undefined);
      expect(bytes.byteLength).toBeGreaterThan(500);
    } else {
      const text = renderArtifact(format, markdown, report.title ?? undefined);
      expect(text.length).toBeGreaterThan(200);
    }
  });

  // Magic bytes, so a renderer that silently produced text where a binary was
  // expected cannot pass by being merely long enough.
  it("produces a real PDF", async () => {
    const bytes = await renderArtifactBinary("pdf", markdown, "Q3 LP Update");
    expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
  });

  it("produces a real docx (a zip)", async () => {
    const bytes = await renderArtifactBinary("docx", markdown, "Q3 LP Update");
    expect(Buffer.from(bytes.slice(0, 2)).toString("latin1")).toBe("PK");
  });

  it("carries the content through to HTML rather than escaping it away", () => {
    const html = renderArtifact("html", markdown, "Q3 LP Update");
    expect(html).toContain("Q3 LP Update");
    expect(html).toContain("NAV up 4%");
    expect(html).toContain("<ul>");
  });

  // An empty report still has to render: the summary is the only guaranteed
  // field, and a meeting with nothing else must not produce a broken file.
  it("renders a summary-only report in every format", async () => {
    const bare = buildReportMarkdown({
      ...report, keyPoints: null, actionItems: null, analysis: null, fullTranscript: null,
    });
    for (const format of FORMATS) {
      if (isBinaryFormat(format)) {
        await expect(renderArtifactBinary(format, bare, "Bare")).resolves.toBeDefined();
      } else {
        expect(() => renderArtifact(format, bare, "Bare")).not.toThrow();
      }
    }
  });
});
