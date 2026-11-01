import {
  FLAG_THRESHOLD,
  MIN_SDN_ROWS,
  SCREEN_PREFIX,
  buildIndex,
  nameSimilarity,
  nameTokens,
  parseCsv,
  screenNames,
  screenOutcome,
} from "./ofac";

// ---- a small synthetic SDN file, padded past the size a real one must have ----

const row = (id: number, name: string, type = "-0- ", program = "SDGT") => `${id},"${name}","${type}","${program}","-0- ","-0- ","-0- ","-0- ","-0- ","-0- ","-0- ","-0- "`;

function sdnFile(extra: string[] = [], pad = MIN_SDN_ROWS): string {
  const real = [
    row(1, "AEROCARIBBEAN AIRLINES", "-0- ", "CUBA"),
    row(2, "BIN LADEN, Usama bin Muhammad bin Awad", "individual", "SDGT"),
    row(3, "SMITH, John Paul", "individual", "SDNTK"),
    row(4, "Rosneft Oil Company", "-0- ", "RUSSIA-EO14024"),
    row(5, "GOLDEN STAR", "vessel", "IRAN"),
    row(6, 'NOVA "QUOTED" TRADING, LLC', "-0- ", "UKRAINE-EO13662"),
    ...extra,
  ];
  // Padding names are random-looking and share no words with anything the tests screen.
  const padding = Array.from({ length: pad }, (_, i) => row(1000 + i, `ZZQ${i}X VRNT${i}Y`, "-0- ", "OTHER"));
  return [...real, ...padding].join("\r\n") + "\r\n\u001a";
}

const alt = (entId: number, altId: number, name: string) => `${entId},${altId},"aka","${name}","-0- "`;
const ALT = ["", alt(1, 1, "AERO-CARIBBEAN"), alt(2, 2, "OSAMA BIN LADEN"), alt(3, 3, "J. SMITH"), alt(99999, 4, "ORPHAN ALIAS NAME")].join("\r\n");

const index = () => buildIndex(sdnFile(), ALT, "2026-10-30");
const screen = (names: Array<[string, string?]>) => screenNames(index(), names.map(([name, role]) => ({ name, role: role ?? "the LP" })));

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, commas in fields, CRLF and a trailing Ctrl-Z", () => {
    expect(parseCsv('1,"A, B","say ""hi""",x\r\n2,"C",,y\r\n\u001a')).toEqual([
      ["1", "A, B", 'say "hi"', "x"],
      ["2", "C", "", "y"],
    ]);
  });
  it("keeps a newline inside a quoted field, and skips blank lines", () => {
    expect(parseCsv('1,"line one\nline two",z\n\n2,b,c')).toEqual([
      ["1", "line one\nline two", "z"],
      ["2", "b", "c"],
    ]);
  });
  it("copes with a missing final newline and a BOM", () => {
    expect(parseCsv("﻿a,b\nc,d")).toEqual([["a", "b"], ["c", "d"]]);
  });
});

describe("buildIndex", () => {
  it("reads entries with their type and programs, and joins aliases to their entry", () => {
    const idx = index();
    expect(idx.entries.length).toBe(MIN_SDN_ROWS + 6);
    expect(idx.entries[1]).toMatchObject({ name: "BIN LADEN, Usama bin Muhammad bin Awad", kind: "individual", programs: ["SDGT"] });
    expect(idx.entries[0].kind).toBe("entity");
    expect(idx.entries[4].kind).toBe("vessel");
    expect(idx.names.filter((n) => n.alias).length).toBe(3); // the orphan alias has no entry
    expect(idx.listDate).toBe("2026-10-30");
  });

  it("refuses a file that is too small to be the real list (an error page, a truncated download)", () => {
    expect(() => buildIndex(sdnFile([], 10), ALT, "2026-10-30")).toThrow(/looks wrong/);
    expect(() => buildIndex("<html>Access denied</html>", ALT, "2026-10-30")).toThrow(/looks wrong/);
    expect(() => buildIndex("", "", "2026-10-30")).toThrow(/looks wrong/);
  });
});

describe("nameTokens", () => {
  it("ignores case, accents, punctuation, word order markers and legal forms", () => {
    expect(nameTokens("Ñoño, José-María")).toEqual(["NONO", "JOSE", "MARIA"]);
    expect(nameTokens("Acme Holdings, L.L.C.")).toEqual(["ACME", "HOLDINGS"]);
    expect(nameTokens("J. Smith")).toEqual(["J", "SMITH"]);
    expect(nameTokens("The Rosneft Oil Company LLC")).toEqual(["ROSNEFT", "OIL"]);
  });
  it("is empty for nothing worth matching", () => {
    expect(nameTokens("")).toEqual([]);
    expect(nameTokens("  ,, ")).toEqual([]);
    expect(nameTokens("The Co")).toEqual([]);
  });
});

describe("nameSimilarity", () => {
  it("is order-insensitive and exact for the same words", () => {
    expect(nameSimilarity(["JOHN", "SMITH"], ["SMITH", "JOHN"])).toEqual([1, 2]);
  });
  it("tolerates a one-letter slip in a long word but not a short one", () => {
    expect(nameSimilarity(["USAMA", "LADEN"], ["USSAMA", "LADEN"])[1]).toBe(2);
    expect(nameSimilarity(["JON", "SMITH"], ["JOHN", "SMITH"])[1]).toBe(1);
  });
  it("scores a missing middle name below an exact match", () => {
    const [s, m] = nameSimilarity(["JOHN", "SMITH"], ["SMITH", "JOHN", "PAUL"]);
    expect(m).toBe(2);
    expect(s).toBeCloseTo(0.8);
    expect(s).toBeGreaterThanOrEqual(FLAG_THRESHOLD);
  });
  it("uses each word of the other name only once", () => {
    expect(nameSimilarity(["SMITH", "SMITH"], ["SMITH", "JOHN"])[1]).toBe(1);
  });
  it("is zero for empty input", () => {
    expect(nameSimilarity([], ["A"])).toEqual([0, 0]);
  });
});

describe("screenNames", () => {
  it("flags an exact name, in any order and case", () => {
    const r = screen([["aerocaribbean airlines"], ["Rosneft Oil"]]);
    expect(r.flagged).toBe(2);
    expect(r.results[0].matches[0]).toMatchObject({ sdnName: "AEROCARIBBEAN AIRLINES", programs: ["CUBA"], kind: "entity", score: 1 });
  });

  it("flags 'First Last' against the list's 'LAST, First'", () => {
    expect(screen([["Usama Bin Laden"]]).results[0].matches[0].sdnName).toMatch(/BIN LADEN/);
  });

  it("flags a name that matches only an alias, and says so", () => {
    const m = screen([["Osama bin Laden"]]).results[0].matches[0];
    expect(m).toMatchObject({ alias: true });
    expect(m.sdnName).toMatch(/BIN LADEN/);
  });

  it("flags a name differing by a typo", () => {
    expect(screen([["Aerocaribean Airlines"]]).flagged).toBe(1);
  });

  it("does not flag an unrelated name", () => {
    const r = screen([["Jane Doe"], ["Acme Capital Partners LLC"], ["Maria Garcia"]]);
    expect(r.flagged).toBe(0);
    expect(r.results.every((x) => x.screened && x.matches.length === 0)).toBe(true);
  });

  it("does not flag on a single shared word", () => {
    expect(screen([["John Williams"]]).flagged).toBe(0); // shares JOHN with 'Smith, John Paul'
    expect(screen([["Oil Services Limited"]]).flagged).toBe(0); // shares OIL with Rosneft
  });

  it("flags a lone distinctive word only when it is the whole name", () => {
    expect(screen([["Rosneft"]]).flagged).toBe(0); // the listed name has more words
    const idx = buildIndex(sdnFile([row(7, "HIZBALLAH", "-0- ", "SDGT")]), ALT, "2026-10-30");
    expect(screenNames(idx, [{ role: "the LP", name: "Hizballah" }]).flagged).toBe(1);
    expect(screenNames(idx, [{ role: "the LP", name: "Hizb" }]).flagged).toBe(0);
  });

  it("flags a short one-word name only on an exact match", () => {
    const idx = buildIndex(sdnFile([row(8, "HAMAS", "-0- ", "SDGT")]), ALT, "2026-10-30");
    const flagged = (name: string) => screenNames(idx, [{ role: "the LP", name }]).flagged;
    expect(flagged("Hamas")).toBe(1);
    expect(flagged("Hamaz")).toBe(0); // five letters: a near spelling isn't enough
    expect(flagged("Ham")).toBe(0);
  });

  it("returns at most three matches, best first, one per entry", () => {
    const extra = [row(10, "SMITH, John Paul", "individual", "A"), row(11, "SMITH, John Paul Henry", "individual", "B"), row(12, "SMITH, John Paul Henry Albert", "individual", "C")];
    const idx = buildIndex(sdnFile(extra), ALT, "2026-10-30");
    const r = screenNames(idx, [{ role: "the LP", name: "John Paul Smith" }]).results[0];
    expect(r.matches.length).toBe(3);
    expect(r.matches[0].score).toBeGreaterThanOrEqual(r.matches[1].score);
    expect(new Set(r.matches.map((m) => m.programs.join())).size).toBe(3);
  });

  it("screens the same person once even if listed in two roles", () => {
    const r = screen([["John Paul Smith", "the LP"], ["Smith, John Paul", "signatory"]]);
    expect(r.results.length).toBe(1);
  });

  it("reports a name with nothing to match on as not screened", () => {
    const r = screen([["LLC"], ["Jane Doe"]]);
    expect(r.results[0]).toMatchObject({ screened: false, matches: [] });
    expect(r.results[1].screened).toBe(true);
  });

  it("finds exactly what a full scan of every name would", () => {
    const words = ["KHALIL", "MOHAMMAD", "HASSAN", "TRADING", "PETROV", "SMITH", "JOHN", "MARINE", "SHIPPING", "ENERGY", "WANG", "ZHANG", "OSAMA", "IVANOV"];
    const make = (i: number) => Array.from({ length: 2 + (i % 3) }, (_, k) => words[(i * 7 + k * 5 + (i >> 2)) % words.length]).join(" ");
    const extra = Array.from({ length: 400 }, (_, i) => row(20000 + i, make(i), "individual", "T"));
    const idx = buildIndex(sdnFile(extra), "", "2026-10-30");
    const queries = ["Mohammad Hassan", "John Smith Wang", "Khalill Petrov", "Marine Shipping Energy", "Zhang Wang", "Osama Ivanov Smith", "Nobody Atall"];
    for (const name of queries) {
      const viaScreen = screenNames(idx, [{ role: "the LP", name }]).results[0].matches.length > 0;
      const q = nameTokens(name);
      const brute = idx.names.some((n) => {
        const [score, matched] = nameSimilarity(q, n.tokens);
        return score >= FLAG_THRESHOLD && (matched >= 2 || (q.length === 1 && n.tokens.length === 1 && q[0].length >= 6 && matched === 1));
      });
      expect(viaScreen).toBe(brute);
    }
  });

  it("carries the list date and size", () => {
    const r = screen([["Jane Doe"]]);
    expect(r).toMatchObject({ listDate: "2026-10-30", listSize: MIN_SDN_ROWS + 6 });
  });
});

describe("screenOutcome", () => {
  it("never clears: no match leaves the check pending, with a note that says it is not a clearance", () => {
    const o = screenOutcome(screen([["Jane Doe"], ["Acme Capital", "owner"]]));
    expect(o.status).toBe("pending");
    expect(o.summary.startsWith(SCREEN_PREFIX)).toBe(true);
    expect(o.summary).toContain("no possible match for 2 names");
    expect(o.summary).toContain("Not a clearance");
    expect(o.summary).toContain("2026-10-30");
  });

  it("flags a possible match, naming who resembles whom", () => {
    const o = screenOutcome(screen([["Jane Doe"], ["Aerocaribbean Airlines", "owner"]]));
    expect(o.status).toBe("flagged");
    expect(o.summary).toContain("Aerocaribbean Airlines (owner) resembles AEROCARIBBEAN AIRLINES [CUBA]");
    expect(o.summary).not.toContain("Jane Doe");
  });

  it("notes an alias match and extra candidates", () => {
    expect(screenOutcome(screen([["Osama bin Laden"]])).summary).toContain("(via an alias)");
    const extra = [row(10, "SMITH, John Paul", "individual", "A"), row(11, "SMITH, John Paul Henry", "individual", "B")];
    const idx = buildIndex(sdnFile(extra), ALT, "2026-10-30");
    expect(screenOutcome(screenNames(idx, [{ role: "the LP", name: "John Paul Smith" }])).summary).toMatch(/\+\d more/);
  });

  it("mentions names too short to screen", () => {
    expect(screenOutcome(screen([["LLC"], ["Jane Doe"]])).summary).toContain("1 name too short to screen");
  });

  it("fits the 500-character limit on a check's note, however many names match", () => {
    const names: Array<[string, string]> = Array.from({ length: 25 }, () => ["Aerocaribbean Airlines", "owner"]);
    const subjects = names.map(([name, role], i) => ({ name: `${name} ${String.fromCharCode(65 + (i % 26))}${i}`, role }));
    const r = screenNames(index(), subjects);
    expect(screenOutcome(r).summary.length).toBeLessThanOrEqual(480);
  });
});
