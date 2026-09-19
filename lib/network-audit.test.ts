import { sanitizeAuditMetadata } from "@/lib/network-audit";
import { csvField, rosterToCsv, ROSTER_EXPORT_HEADERS } from "@/lib/network-csv";
import type { ActiveNetworkPerson } from "@/lib/network-active";

describe("sanitizeAuditMetadata", () => {
  it("redacts contact details and secrets", () => {
    expect(
      sanitizeAuditMetadata({ email: "ada@example.com", phone: "+15550100", notes: "private", stage: "engaged" }),
    ).toEqual({
      email: "[redacted]",
      phone: "[redacted]",
      notes: "[redacted]",
      stage: "engaged",
    });
  });

  it("redacts regardless of key casing", () => {
    expect(sanitizeAuditMetadata({ Email: "a@b.c", API_KEY: "sk-123" })).toEqual({
      Email: "[redacted]",
      API_KEY: "[redacted]",
    });
  });

  it("redacts inside nested objects", () => {
    expect(sanitizeAuditMetadata({ changes: { email: "a@b.c", stage: "committed" } })).toEqual({
      changes: { email: "[redacted]", stage: "committed" },
    });
  });

  it("truncates long strings", () => {
    const out = sanitizeAuditMetadata({ query: "x".repeat(900) }) as { query: string };
    expect(out.query.length).toBeLessThanOrEqual(501);
    expect(out.query.endsWith("…")).toBe(true);
  });

  it("caps arrays and recursion depth instead of walking forever", () => {
    const out = sanitizeAuditMetadata({ ids: Array.from({ length: 100 }, (_, i) => i) }) as { ids: number[] };
    expect(out.ids).toHaveLength(20);

    let deep: Record<string, unknown> = { email: "a@b.c" };
    for (let i = 0; i < 10; i += 1) deep = { nested: deep };
    expect(() => sanitizeAuditMetadata(deep)).not.toThrow();
  });

  it("passes primitives through and normalises null", () => {
    expect(sanitizeAuditMetadata({ rows: 42, bulk: true })).toEqual({ rows: 42, bulk: true });
    expect(sanitizeAuditMetadata(null)).toBeNull();
    expect(sanitizeAuditMetadata(undefined)).toBeNull();
  });
});

describe("csvField", () => {
  it("quotes fields containing commas, quotes, or newlines", () => {
    expect(csvField("Lovelace, Ada")).toBe('"Lovelace, Ada"');
    expect(csvField('She said "yes"')).toBe('"She said ""yes"""');
    expect(csvField("line one\nline two")).toBe('"line one\nline two"');
  });

  it("neutralises spreadsheet formula injection", () => {
    // An exported contact book gets mailed around; a name starting with '=' must
    // not become a live formula in the recipient's spreadsheet.
    expect(csvField("=1+1")).toBe("'=1+1");
    expect(csvField("+41 44 000")).toBe("'+41 44 000");
    expect(csvField("-lead")).toBe("'-lead");
    expect(csvField("@handle")).toBe("'@handle");
    expect(csvField('=HYPERLINK("http://x","click")')).toBe(
      '"\'=HYPERLINK(""http://x"",""click"")"',
    );
  });

  it("leaves ordinary values alone", () => {
    expect(csvField("Ada Lovelace")).toBe("Ada Lovelace");
    expect(csvField(42)).toBe("42");
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });
});

describe("rosterToCsv", () => {
  const person: ActiveNetworkPerson = {
    id: "p1",
    kind: "contact",
    name: "Ada Lovelace",
    org: "Analytical Engines",
    role: "Managing Partner",
    category: "limited_partner",
    temperature: "warm",
    warmth: 62,
    committedAmount: 0,
    lastContactAt: "2026-09-01T00:00:00.000Z",
    lastContactDays: 17,
    addedAt: "2025-01-05T00:00:00.000Z",
    nextAction: null,
    nextActionTier: null,
    introducer: null,
    introPath: null,
    thesisFitScore: null,
    email: "ada@example.com",
    stage: "engaged",
    ownerId: "u1",
    ownerName: "Grace Hopper",
    visibility: "org",
    lastActivityAt: "2026-09-10T00:00:00.000Z",
    openTasks: 2,
    tags: ["lp", "priority"],
    custom: {},
  };

  it("writes a header row and one row per person", () => {
    const csv = rosterToCsv([person]);
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(ROSTER_EXPORT_HEADERS.join(","));
    expect(lines[1]).toContain("Ada Lovelace");
    expect(lines[1]).toContain("Grace Hopper");
    // Dates render as plain ISO days, and the logged activity wins over the score date.
    expect(lines[1]).toContain("2026-09-10");
  });

  it("starts with a BOM so Excel reads it as UTF-8", () => {
    expect(rosterToCsv([])).toMatch(/^﻿/);
  });

  it("joins tags into one column", () => {
    const line = rosterToCsv([person]).split("\r\n")[1];
    // Semicolon-separated so the field needs no quoting and stays one column.
    expect(line).toContain("lp; priority");
    expect(line.split(",")).toHaveLength(ROSTER_EXPORT_HEADERS.length);
  });

  it("handles an empty roster", () => {
    const csv = rosterToCsv([]);
    expect(csv.replace(/^﻿/, "").trim()).toBe(ROSTER_EXPORT_HEADERS.join(","));
  });
});
