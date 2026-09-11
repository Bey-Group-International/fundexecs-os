// lib/data-room-audit.test.ts
import {
  buildAuditCsv,
  csvField,
  csvRow,
  auditFilename,
  AUDIT_COLUMNS,
  type AuditView,
} from "@/lib/data-room-audit";

function view(over: Partial<AuditView> & { createdAt: string }): AuditView {
  return {
    kind: "room",
    shareId: null,
    documentId: null,
    viewerEmail: null,
    sessionId: null,
    durationSeconds: null,
    ...over,
  };
}

describe("csvField", () => {
  it("passes plain values through", () => {
    expect(csvField("Exec Summary")).toBe("Exec Summary");
    expect(csvField(42)).toBe("42");
  });

  it("renders null and undefined as empty", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });

  it("quotes and escapes commas, quotes and newlines", () => {
    expect(csvField("Smith, Jane")).toBe('"Smith, Jane"');
    expect(csvField('He said "no"')).toBe('"He said ""no"""');
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
  });

  it("neutralizes spreadsheet formula injection", () => {
    // Link labels and viewer emails are attacker-influenced free text. Opened
    // in Excel, a leading = would execute rather than display.
    expect(csvField("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1");
    expect(csvField("+1 555 0100")).toBe("'+1 555 0100");
    expect(csvField("-2")).toBe("'-2");
    expect(csvField("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("still quotes a formula-prefixed value that also contains a comma", () => {
    expect(csvField("=A1,B2")).toBe(`"'=A1,B2"`);
  });
});

describe("csvRow", () => {
  it("joins fields with commas", () => {
    expect(csvRow(["a", 1, null])).toBe("a,1,");
  });
});

describe("buildAuditCsv", () => {
  const shares = [
    { id: "s1", label: "Q3 raise", recipientEmail: "lp@example.com" },
    { id: "s2", label: null, recipientEmail: null },
  ];
  const docs = [{ id: "d1", name: "Investor Deck" }];

  it("writes the header row", () => {
    const csv = buildAuditCsv({ roomName: "Fund III", views: [], shares, docs });
    expect(csv).toBe(AUDIT_COLUMNS.join(",") + "\r\n");
  });

  it("resolves a document view against its link and document", () => {
    const csv = buildAuditCsv({
      roomName: "Fund III",
      views: [
        view({
          createdAt: "2026-06-01T10:00:00.000Z",
          kind: "document",
          shareId: "s1",
          documentId: "d1",
          viewerEmail: "reader@example.com",
          sessionId: "sess-1",
          durationSeconds: 95,
        }),
      ],
      shares,
      docs,
    });
    const row = csv.split("\r\n")[1];
    expect(row).toBe(
      "2026-06-01T10:00:00.000Z,Document opened,Q3 raise,lp@example.com,reader@example.com,Investor Deck,95,sess-1",
    );
  });

  it("orders rows newest first", () => {
    const csv = buildAuditCsv({
      roomName: "Fund III",
      views: [
        view({ createdAt: "2026-06-01T10:00:00.000Z" }),
        view({ createdAt: "2026-06-03T10:00:00.000Z" }),
        view({ createdAt: "2026-06-02T10:00:00.000Z" }),
      ],
      shares,
      docs,
    });
    const days = csv
      .split("\r\n")
      .slice(1)
      .filter(Boolean)
      .map((l) => l.slice(8, 10));
    expect(days).toEqual(["03", "02", "01"]);
  });

  it("labels a link with no label and a document that no longer exists", () => {
    const csv = buildAuditCsv({
      roomName: "Fund III",
      views: [
        view({
          createdAt: "2026-06-01T10:00:00.000Z",
          kind: "document",
          shareId: "s2",
          documentId: "gone",
        }),
      ],
      shares,
      docs,
    });
    expect(csv).toContain("(unlabelled link)");
    expect(csv).toContain("(deleted document)");
  });

  it("leaves link and document blank for a room view with neither", () => {
    const csv = buildAuditCsv({
      roomName: "Fund III",
      views: [view({ createdAt: "2026-06-01T10:00:00.000Z" })],
      shares,
      docs,
    });
    expect(csv.split("\r\n")[1]).toBe("2026-06-01T10:00:00.000Z,Room opened,,,,,,");
  });
});

describe("auditFilename", () => {
  it("slugs the room name and stamps the date", () => {
    expect(auditFilename("Fund III Raise", new Date("2026-06-01T00:00:00Z"))).toBe(
      "fund-iii-raise-audit-2026-06-01.csv",
    );
  });

  it("falls back when the name has nothing sluggable", () => {
    expect(auditFilename("!!!", new Date("2026-06-01T00:00:00Z"))).toBe(
      "data-room-audit-2026-06-01.csv",
    );
  });
});
