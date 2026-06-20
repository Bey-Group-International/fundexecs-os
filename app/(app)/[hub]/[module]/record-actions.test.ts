// Unit test for the record-management allow-list guard. The mutations
// themselves hit Supabase (covered by integration/manual testing); here we lock
// down the pure gate that decides which tables may ever be mutated.
import { isManagedTable } from "@/lib/managed-tables";

describe("isManagedTable", () => {
  it("accepts every table-backed module record", () => {
    for (const t of [
      "investors",
      "deals",
      "partners",
      "service_providers",
      "debt_facilities",
      "underwritings",
      "diligence_items",
      "capital_events",
      "assets",
    ]) {
      expect(isManagedTable(t)).toBe(true);
    }
  });

  it("rejects tables outside the allow-list", () => {
    for (const t of ["organizations", "tasks", "mandates", "principals", "", "investors; drop"]) {
      expect(isManagedTable(t)).toBe(false);
    }
  });
});
