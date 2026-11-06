import { CHAT_FOR_REPORT_LIMIT, chatForReport } from "./chat-for-report";

describe("chatForReport", () => {
  it("lines the chat up oldest first, with who typed it and when", () => {
    expect(
      chatForReport([
        { author_name: "Priya", body: "Deck: https://x.test/deck", ts: "2026-09-23T14:05:00.000Z" },
        { author_name: null, body: "  can we move the close  to the 14th? ", ts: "2026-09-23T14:06:30.000Z" },
      ]),
    ).toBe("[14:05 UTC] Priya: Deck: https://x.test/deck\n[14:06 UTC] Guest: can we move the close to the 14th?");
  });

  it("is empty when nobody typed", () => {
    expect(chatForReport([])).toBe("");
    expect(chatForReport([{ author_name: "A", body: "   ", ts: null }])).toBe("");
  });

  it("keeps the latest chat within the budget, and says it cut", () => {
    const rows = Array.from({ length: 2000 }, (_, i) => ({ author_name: "A", body: `message ${i} ${"x".repeat(20)}`, ts: null }));
    const out = chatForReport(rows);
    expect(out.length).toBeLessThanOrEqual(CHAT_FOR_REPORT_LIMIT + 30);
    expect(out.startsWith("[Earlier chat omitted]\n")).toBe(true);
    expect(out).toContain("message 1999");
  });
});
