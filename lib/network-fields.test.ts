import {
  applyCustomPatch,
  coerceFieldValue,
  isValidFieldKey,
  slugifyFieldKey,
  type FieldDef,
} from "@/lib/network-fields";

function def(over: Partial<FieldDef> = {}): FieldDef {
  return {
    id: "f1",
    entity: "contact",
    key: "aum",
    label: "AUM",
    type: "text",
    options: [],
    helpText: null,
    required: false,
    position: 0,
    ...over,
  };
}

describe("slugifyFieldKey", () => {
  it("turns a label into a usable key", () => {
    expect(slugifyFieldKey("Investment Committee Date")).toBe("investment_committee_date");
    expect(slugifyFieldKey("AUM ($m)")).toBe("aum_m");
  });

  it("prefixes a key that would start with a digit", () => {
    // Bare "2024_target" violates the field_key constraint, so it must not be
    // handed to the database as-is.
    const key = slugifyFieldKey("2024 Target");
    expect(key).toBe("f_2024_target");
    expect(isValidFieldKey(key)).toBe(true);
  });

  it("returns empty for a label with nothing usable in it", () => {
    expect(slugifyFieldKey("!!!")).toBe("");
    expect(slugifyFieldKey("   ")).toBe("");
  });

  it("produces a key the database constraint accepts", () => {
    for (const label of ["Consultant", "Ticket size", "Re-up?", "ESG / impact"]) {
      expect(isValidFieldKey(slugifyFieldKey(label))).toBe(true);
    }
  });
});

describe("coerceFieldValue", () => {
  it("clears an empty value, or refuses it when required", () => {
    expect(coerceFieldValue(def(), "")).toEqual({ ok: true, value: null });
    expect(coerceFieldValue(def(), null)).toEqual({ ok: true, value: null });
    expect(coerceFieldValue(def({ required: true }), "")).toEqual({
      ok: false,
      error: "AUM is required.",
    });
  });

  it("parses numbers the way people type them", () => {
    expect(coerceFieldValue(def({ type: "currency" }), "2,000,000")).toEqual({
      ok: true,
      value: 2000000,
    });
    expect(coerceFieldValue(def({ type: "currency" }), "$2000000")).toEqual({
      ok: true,
      value: 2000000,
    });
    expect(coerceFieldValue(def({ type: "number" }), 1.5)).toEqual({ ok: true, value: 1.5 });
  });

  it("refuses a number column that was handed text", () => {
    // This is the whole point of validating here: the jsonb column would have
    // accepted "about two million" and made the field unsortable.
    expect(coerceFieldValue(def({ type: "number" }), "about two million")).toEqual({
      ok: false,
      error: "AUM must be a number.",
    });
  });

  it("bounds a percent", () => {
    expect(coerceFieldValue(def({ type: "percent" }), "45%")).toEqual({ ok: true, value: 45 });
    expect(coerceFieldValue(def({ type: "percent" }), 140).ok).toBe(false);
    expect(coerceFieldValue(def({ type: "percent" }), -1).ok).toBe(false);
  });

  it("refuses an impossible calendar date instead of rolling it over", () => {
    // Date.parse("2026-02-30") succeeds and yields 2026-03-02, which would
    // silently store a different day than the one someone typed.
    expect(coerceFieldValue(def({ type: "date" }), "2026-02-30")).toEqual({
      ok: false,
      error: "AUM is not a real date.",
    });
    expect(coerceFieldValue(def({ type: "date" }), "2025-02-29").ok).toBe(false);
    expect(coerceFieldValue(def({ type: "date" }), "2026-04-31").ok).toBe(false);
  });

  it("still accepts a real leap day", () => {
    expect(coerceFieldValue(def({ type: "date" }), "2028-02-29")).toEqual({
      ok: true,
      value: "2028-02-29",
    });
  });

  it("stores a date as a plain day", () => {
    // A committee date is a day, not an instant — keeping a timezone on it
    // makes it drift across a date line.
    expect(coerceFieldValue(def({ type: "date" }), "2026-03-14T23:30:00Z")).toEqual({
      ok: true,
      value: "2026-03-14",
    });
    expect(coerceFieldValue(def({ type: "date" }), "not a date").ok).toBe(false);
  });

  it("reads the ways people write a boolean", () => {
    for (const yes of [true, "true", "Yes", "1", "y"]) {
      expect(coerceFieldValue(def({ type: "boolean" }), yes)).toEqual({ ok: true, value: true });
    }
    for (const no of [false, "false", "No", "0", "n"]) {
      expect(coerceFieldValue(def({ type: "boolean" }), no)).toEqual({ ok: true, value: false });
    }
    expect(coerceFieldValue(def({ type: "boolean" }), "maybe").ok).toBe(false);
  });

  it("validates an email", () => {
    expect(coerceFieldValue(def({ type: "email" }), " Ada@Example.COM ")).toEqual({
      ok: true,
      value: "ada@example.com",
    });
    expect(coerceFieldValue(def({ type: "email" }), "ada@").ok).toBe(false);
  });

  it("completes a bare domain into a URL", () => {
    const result = coerceFieldValue(def({ type: "url" }), "example.com/fund");
    expect(result).toEqual({ ok: true, value: "https://example.com/fund" });
  });

  it("refuses a javascript: URL", () => {
    // The record page renders these as links.
    expect(coerceFieldValue(def({ type: "url" }), "javascript:alert(1)").ok).toBe(false);
    expect(coerceFieldValue(def({ type: "url" }), "data:text/html,<script>").ok).toBe(false);
  });

  it("holds a select to its options", () => {
    const d = def({ type: "select", options: ["Core", "Opportunistic"] });
    expect(coerceFieldValue(d, "Core")).toEqual({ ok: true, value: "Core" });
    expect(coerceFieldValue(d, "Something else").ok).toBe(false);
  });

  it("splits and de-duplicates a multi_select", () => {
    const d = def({ type: "multi_select", options: ["PE", "VC", "RE"] });
    expect(coerceFieldValue(d, "PE, VC, PE")).toEqual({ ok: true, value: ["PE", "VC"] });
    expect(coerceFieldValue(d, ["PE", "Crypto"]).ok).toBe(false);
  });

  it("accepts any value for a select with no options configured", () => {
    expect(coerceFieldValue(def({ type: "select" }), "Anything")).toEqual({
      ok: true,
      value: "Anything",
    });
  });
});

describe("applyCustomPatch", () => {
  const defs = [
    def({ key: "aum", label: "AUM", type: "currency" }),
    def({ id: "f2", key: "consultant", label: "Consultant", type: "text" }),
  ];

  it("merges onto what the row already holds", () => {
    const result = applyCustomPatch(defs, { consultant: "Mercer" }, { aum: "5,000,000" });
    expect(result.ok).toBe(true);
    expect(result.custom).toEqual({ consultant: "Mercer", aum: 5000000 });
  });

  it("ignores keys the org has not defined", () => {
    // A stale client or a hand-rolled request must not accumulate junk in the
    // jsonb that no column definition explains.
    const result = applyCustomPatch(defs, {}, { aum: 100, rogue_key: "whatever" });
    expect(result.custom).toEqual({ aum: 100 });
    expect(result.custom).not.toHaveProperty("rogue_key");
  });

  it("removes a key set to null rather than storing a null", () => {
    const result = applyCustomPatch(defs, { aum: 100, consultant: "Mercer" }, { aum: null });
    expect(result.custom).toEqual({ consultant: "Mercer" });
    expect("aum" in result.custom).toBe(false);
  });

  it("collects every error and writes none of the bad values", () => {
    const result = applyCustomPatch(defs, {}, { aum: "not a number" });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["AUM must be a number."]);
    expect(result.custom).toEqual({});
  });

  it("keeps good values from a patch that also had a bad one", () => {
    const result = applyCustomPatch(defs, {}, { aum: "nope", consultant: "Mercer" });
    expect(result.ok).toBe(false);
    expect(result.custom.consultant).toBe("Mercer");
    expect(result.custom).not.toHaveProperty("aum");
  });

  it("reports which keys were cleared, for the database-side merge", () => {
    const result = applyCustomPatch(defs, { aum: 100, consultant: "Mercer" }, { aum: null });
    expect(result.removed).toEqual(["aum"]);
  });

  it("enforces required columns when creating, but not on a partial update", () => {
    const withRequired = [
      def({ key: "aum", label: "AUM", type: "currency", required: true }),
      def({ id: "f2", key: "consultant", label: "Consultant", type: "text" }),
    ];

    // Creating with the required key omitted must fail rather than producing an
    // incomplete record.
    const creating = applyCustomPatch(withRequired, {}, { consultant: "Mercer" }, { creating: true });
    expect(creating.ok).toBe(false);
    expect(creating.errors).toContain("AUM is required.");

    // Supplying it is fine.
    expect(
      applyCustomPatch(withRequired, {}, { aum: 100, consultant: "Mercer" }, { creating: true }).ok,
    ).toBe(true);

    // An unrelated later edit must NOT demand the value again — it is already
    // on the row.
    expect(applyCustomPatch(withRequired, { aum: 100 }, { consultant: "Aon" }).ok).toBe(true);
  });

  it("leaves the existing object untouched", () => {
    const existing = { aum: 1 };
    applyCustomPatch(defs, existing, { aum: 2 });
    expect(existing).toEqual({ aum: 1 });
  });
});

describe("what reaches the database-side merge", () => {
  // The routes hand the RPC `merged.custom` filtered to the keys the client
  // actually sent. These pin what that filter can and cannot let through,
  // because the RPC writes straight into the jsonb column.
  const defs = [def({ key: "aum", label: "AUM", type: "currency" })];

  function rpcPatch(existing: Record<string, unknown>, sent: Record<string, unknown>) {
    const merged = applyCustomPatch(defs, existing, sent);
    return {
      ok: merged.ok,
      patch: Object.fromEntries(Object.entries(merged.custom).filter(([k]) => k in sent)),
      remove: merged.removed,
    };
  }

  it("never forwards a key the org has not defined", () => {
    const r = rpcPatch({}, { aum: "5,000,000", rogue: "anything" });
    expect(r.patch).toEqual({ aum: 5000000 });
  });

  it("forwards only what the client sent, not the row's other values", () => {
    const r = rpcPatch({ aum: 1, other_existing: "x" }, { aum: 2 });
    expect(r.patch).toEqual({ aum: 2 });
  });

  it("writes a stale key back unchanged rather than taking the client's value", () => {
    // `legacy` has no definition — its column was archived. It survives the
    // filter because it is already on the row, so the question is whether the
    // CLIENT's value can ride through on its back. It cannot.
    const r = rpcPatch({ legacy: "original" }, { legacy: "attacker-supplied" });
    expect(r.patch.legacy).toBe("original");
  });

  it("forwards nothing when a value failed validation", () => {
    const r = rpcPatch({}, { aum: "not a number" });
    expect(r.ok).toBe(false);
    expect(r.patch).toEqual({});
  });
});
