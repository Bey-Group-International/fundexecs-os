import { digestEmail, firstOpenEmail, formatDuration, summarizeViews, viewerKeyFor, type ViewRow } from "./data-room-alerts";

const row = (r: Partial<ViewRow>): ViewRow => ({
  viewer_email: null,
  session_id: null,
  document_id: null,
  kind: "room",
  duration_seconds: null,
  created_at: "2026-10-02T10:00:00Z",
  ...r,
});

describe("viewerKeyFor", () => {
  it("keys on the email, case-insensitively, before the browser id", () => {
    expect(viewerKeyFor(" LP@Fund.com ", "abcdef12-3456")).toBe("email:lp@fund.com");
  });
  it("falls back to a well-formed browser id", () => {
    expect(viewerKeyFor(null, "abcdef12-3456")).toBe("visitor:abcdef12-3456");
  });
  it("refuses a malformed or missing id rather than alerting per load", () => {
    expect(viewerKeyFor(null, "x")).toBeNull();
    expect(viewerKeyFor(null, "<script>alert(1)</script>")).toBeNull();
    expect(viewerKeyFor("", "")).toBeNull();
  });
});

describe("summarizeViews", () => {
  it("returns null for a quiet day", () => {
    expect(summarizeViews([])).toBeNull();
  });

  it("counts readers, opens, reading time and the most-read documents", () => {
    const d = summarizeViews([
      row({ kind: "room" }),
      row({ kind: "room", viewer_email: "a@x.com", session_id: "s1" }),
      row({ kind: "document", document_id: "ppm", viewer_email: "a@x.com", duration_seconds: 300 }),
      row({ kind: "document", document_id: "deck", viewer_email: "B@x.com", duration_seconds: 60 }),
      row({ kind: "document", document_id: "deck", viewer_email: "b@x.com" }),
      row({ kind: "document", document_id: "terms", session_id: "s2" }),
    ])!;
    expect(d.readers).toBe(3); // a@, b@ (case-folded), session s2
    expect(d.opens).toBe(2);
    expect(d.seconds).toBe(360);
    expect(d.namedReaders).toEqual(["a@x.com", "b@x.com"]);
    expect(d.topDocuments.map((t) => t.documentId)).toEqual(["ppm", "deck", "terms"]);
    expect(d.topDocuments[1]).toEqual({ documentId: "deck", seconds: 60, opens: 1 });
  });

  it("counts an anonymous open as one reader", () => {
    expect(summarizeViews([row({ kind: "room" })])!.readers).toBe(1);
  });
});

describe("formatDuration", () => {
  it("reads naturally", () => {
    expect(formatDuration(42)).toBe("42s");
    expect(formatDuration(600)).toBe("10 min");
    expect(formatDuration(3900)).toBe("1 h 5 min");
  });
});

describe("emails", () => {
  it("names the reader and escapes everything the reader or operator typed", () => {
    const { subject, html } = firstOpenEmail({
      linkLabel: "<b>Fund II</b>",
      roomName: "Room & Co",
      viewerEmail: "lp@x.com",
      activityUrl: "https://app.example.com/build/data_room",
    });
    expect(subject).toBe("lp@x.com opened <b>Fund II</b>");
    expect(html).toContain("&lt;b&gt;Fund II&lt;/b&gt;");
    expect(html).toContain("Room &amp; Co");
    expect(html).not.toContain("<b>Fund II</b>");
  });

  it("refuses a non-http button link", () => {
    const { html } = firstOpenEmail({ linkLabel: null, roomName: null, viewerEmail: null, activityUrl: "javascript:alert(1)" });
    expect(html).toContain('href="#"');
  });

  it("summarises each link and names documents", () => {
    const digest = summarizeViews([
      row({ kind: "document", document_id: "ppm", viewer_email: "a@x.com", duration_seconds: 120 }),
    ])!;
    const { subject, html } = digestEmail({
      links: [{ label: "Fund II LPs", roomName: null, digest, documentNames: new Map([["ppm", "PPM v3"]]) }],
      activityUrl: "https://app.example.com/build/data_room",
    });
    expect(subject).toBe("Data room activity: 1 reader in the last day");
    expect(html).toContain("Fund II LPs");
    expect(html).toContain("PPM v3 · 2 min");
    expect(html).toContain("a@x.com");
  });
});
