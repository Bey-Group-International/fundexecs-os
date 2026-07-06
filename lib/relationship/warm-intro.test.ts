// Coverage for the pure warm-intro pickers. Contracts:
//   - bestBridge picks the strongest relationship, tie-breaking to an owned one
//   - mapBridgesByFirm groups case-insensitively → the best bridge per firm

import { bestBridge, mapBridgesByFirm } from "./warm-intro";

describe("bestBridge", () => {
  it("picks the highest-strength contact", () => {
    const b = bestBridge([
      { full_name: "Weak Tie", company: "Acme", strength_score: 20 },
      { full_name: "Strong Tie", company: "Acme", strength_score: 80 },
    ]);
    expect(b?.name).toBe("Strong Tie");
    expect(b?.strength).toBe(80);
  });

  it("tie-breaks toward a contact with a relationship owner", () => {
    const b = bestBridge([
      { full_name: "No Owner", company: "Acme", strength_score: 50 },
      { full_name: "Owned", company: "Acme", strength_score: 50, relationship_owner: "user-1" },
    ]);
    expect(b?.name).toBe("Owned");
    expect(b?.hasOwner).toBe(true);
  });

  it("ignores contacts with no name or company", () => {
    expect(bestBridge([{ full_name: "", company: "Acme", strength_score: 90 }])).toBeNull();
    expect(bestBridge([])).toBeNull();
  });
});

describe("mapBridgesByFirm", () => {
  it("groups case-insensitively and keeps the best per firm", () => {
    const map = mapBridgesByFirm([
      { full_name: "A", company: "Acme", strength_score: 30 },
      { full_name: "B", company: "acme", strength_score: 70 },
      { full_name: "C", company: "Beta", strength_score: 40 },
    ]);
    expect(map.get("acme")?.name).toBe("B");
    expect(map.get("beta")?.name).toBe("C");
    expect(map.size).toBe(2);
  });
});
