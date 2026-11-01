import { PREFILL_INVESTOR_COLUMNS, prefillFromInvestor } from "./lp-prefill";

const inv = {
  name: "Harbor Family Office LLC",
  investor_type: "family_office",
  contact_name: "Dana Harbor",
  contact_phone: "+1 555 0100",
  role: "Managing Director",
};

describe("prefillFromInvestor", () => {
  it("suggests the entity, its kind, the phone, and the contact as signatory", () => {
    expect(prefillFromInvestor("entity", inv)).toEqual({
      legalName: "Harbor Family Office LLC",
      entityType: "family_office",
      contactPhone: "+1 555 0100",
      signatoryName: "Dana Harbor",
      signatoryTitle: "Managing Director",
    });
  });

  it("suggests only a phone for an individual: the allocator's name and contact aren't theirs to sign for", () => {
    expect(prefillFromInvestor("individual", inv)).toEqual({ contactPhone: "+1 555 0100" });
  });

  it("never suggests a country", () => {
    const res = prefillFromInvestor("entity", { ...inv, jurisdiction: "Delaware" } as never);
    expect(res).not.toHaveProperty("country");
  });

  it("only suggests an entity type the LP's kind allows", () => {
    // family_office isn't offered to an institution
    expect(prefillFromInvestor("institutional", inv).entityType).toBeUndefined();
    expect(prefillFromInvestor("institutional", { ...inv, investor_type: "fund_of_funds" }).entityType).toBe("fund");
    expect(prefillFromInvestor("entity", { ...inv, investor_type: "fund_of_funds" }).entityType).toBe("fund");
  });

  it("leaves an ambiguous allocator type for the LP to choose", () => {
    for (const t of ["lp", "institution", "bank", "lender", "co_gp", "other", "", null, undefined]) {
      expect(prefillFromInvestor("entity", { ...inv, investor_type: t as never }).entityType).toBeUndefined();
    }
  });

  it("collapses whitespace and drops blanks", () => {
    const res = prefillFromInvestor("entity", { name: "  Harbor \n  LLC ", contact_name: "   ", contact_phone: "", role: null, investor_type: "x" });
    expect(res).toEqual({ legalName: "Harbor LLC" });
  });

  it("drops a value too long for the form rather than truncating it", () => {
    const res = prefillFromInvestor("entity", { ...inv, name: "x".repeat(201), contact_phone: "9".repeat(41), role: "t".repeat(101), contact_name: "n".repeat(201) });
    expect(res).toEqual({ entityType: "family_office" });
    expect(prefillFromInvestor("entity", { ...inv, name: "x".repeat(200) }).legalName).toHaveLength(200);
  });

  it("suggests nothing for a missing record", () => {
    expect(prefillFromInvestor("entity", null)).toEqual({});
    expect(prefillFromInvestor("entity", undefined)).toEqual({});
  });

  it("reads only contact columns, never notes, size or pipeline stage", () => {
    expect(PREFILL_INVESTOR_COLUMNS.split(",").map((c) => c.trim()).sort()).toEqual(["contact_name", "contact_phone", "investor_type", "name", "role"]);
  });
});
