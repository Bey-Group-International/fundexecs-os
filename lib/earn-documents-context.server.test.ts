jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/document-text.server", () => ({ getDocumentText: jest.fn() }));
import { nameMatchScore } from "./earn-documents-context.server";

describe("nameMatchScore", () => {
  it("scores a verbatim mention as a full match", () => {
    expect(nameMatchScore("what's the hurdle in the Fund IV LPA?", "Fund IV LPA")).toBe(1);
  });

  it("scores partial overlap by the name's words", () => {
    expect(nameMatchScore("summarize the audited financials for 2025", "2025 Audited Financials")).toBe(1);
    expect(nameMatchScore("summarize the deck", "Q3 Investor Deck")).toBeLessThan(0.6);
  });
});
