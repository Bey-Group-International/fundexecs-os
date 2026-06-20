import { buildSourceSelectionPayload } from "@/lib/source-selection";

describe("buildSourceSelectionPayload", () => {
  const candidates = [
    {
      name: "Northstar Family Office",
      category: "family_office",
      rationale: "Matches the industrial thesis.",
      fitScore: 91,
      sourceUrl: "https://example.com/northstar",
    },
    {
      name: "Generic FoF",
      category: "fund_of_funds",
      rationale: "Less direct fit.",
      fitScore: 52,
    },
  ];

  it("splits reviewed candidates into accepted picks and rejected learning signals", () => {
    const payload = buildSourceSelectionPayload(candidates, (_, index) => index === 0);

    expect(payload.picks).toEqual([
      {
        name: "Northstar Family Office",
        category: "family_office",
        rationale: "Matches the industrial thesis.",
        fitScore: 91,
        sourceUrl: "https://example.com/northstar",
      },
    ]);
    expect(payload.rejected).toEqual([
      {
        name: "Generic FoF",
        category: "fund_of_funds",
        rationale: "Less direct fit.",
        fitScore: 52,
      },
    ]);
  });
});
