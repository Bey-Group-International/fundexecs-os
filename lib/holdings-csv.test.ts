import {
  holdingsToCsv,
  parseCsvLine,
  parseHoldingsCsv,
  csvFilenameStem,
} from "@/lib/holdings-csv";

describe("holdingsToCsv", () => {
  it("emits a header row and one row per holding", () => {
    const csv = holdingsToCsv([
      { name: "Jane", kind: "person", className: "Common", units: 100, ownershipPct: 60, investedAmount: 5000 },
    ]);
    expect(csv.split("\n")).toEqual([
      "Holder,Kind,Class,Units,OwnershipPct,Invested",
      "Jane,person,Common,100,60,5000",
    ]);
  });

  it("quotes fields containing commas or quotes and renders nulls as empty", () => {
    const csv = holdingsToCsv([
      { name: 'Acme, LLC', kind: "entity", className: null, units: null, ownershipPct: 40, investedAmount: null },
    ]);
    expect(csv.split("\n")[1]).toBe('"Acme, LLC",entity,,,40,');
  });
});

describe("parseCsvLine", () => {
  it("handles quoted fields with embedded commas and escaped quotes", () => {
    expect(parseCsvLine('"Acme, LLC","She said ""hi""",42')).toEqual([
      "Acme, LLC",
      'She said "hi"',
      "42",
    ]);
  });
});

describe("parseHoldingsCsv", () => {
  it("parses canonical headers into typed rows", () => {
    const rows = parseHoldingsCsv(
      "holder,class,units,ownership_pct,invested\nJane,Common,100,60,5000\n",
    );
    expect(rows).toEqual([
      { holder: "Jane", className: "Common", units: 100, ownershipPct: 60, invested: 5000 },
    ]);
  });

  it("is tolerant of header casing/spacing and column order", () => {
    const rows = parseHoldingsCsv(" Ownership % , Holder \n 25 , Bob ");
    expect(rows).toEqual([{ holder: "Bob", className: null, units: null, ownershipPct: 25, invested: null }]);
  });

  it("tolerates missing class/units/invested columns", () => {
    const rows = parseHoldingsCsv("holder,ownership_pct\nJane,60\nBob,40");
    expect(rows).toEqual([
      { holder: "Jane", className: null, units: null, ownershipPct: 60, invested: null },
      { holder: "Bob", className: null, units: null, ownershipPct: 40, invested: null },
    ]);
  });

  it("strips currency/percent/thousands noise from numbers", () => {
    const rows = parseHoldingsCsv('holder,invested,ownership_pct\nJane,"$1,250,000",12.5%');
    expect(rows[0].invested).toBe(1250000);
    expect(rows[0].ownershipPct).toBe(12.5);
  });

  it("skips blank lines and rows with no holder", () => {
    const rows = parseHoldingsCsv("holder,units\nJane,100\n\n,50\n");
    expect(rows).toEqual([{ holder: "Jane", className: null, units: 100, ownershipPct: null, invested: null }]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseHoldingsCsv("")).toEqual([]);
    expect(parseHoldingsCsv("   \n  ")).toEqual([]);
  });
});

describe("csvFilenameStem", () => {
  it("slugifies an entity name", () => {
    expect(csvFilenameStem("Acme Fund I, LP")).toBe("acme-fund-i-lp");
  });
  it("falls back to 'entity' when nothing usable remains", () => {
    expect(csvFilenameStem("  ***  ")).toBe("entity");
  });
});
