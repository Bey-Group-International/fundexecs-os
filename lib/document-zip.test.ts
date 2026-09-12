import {
  MAX_ZIP_ENTRIES,
  describePlan,
  isZipFile,
  normalizeFolder,
  planZipImport,
  sectionFromPath,
} from "./document-zip";

function entry(name: string, uncompressedSize = 1024) {
  return { name, uncompressedSize, isDirectory: name.endsWith("/") };
}

describe("isZipFile", () => {
  it("recognises a zip by extension, whatever the browser reports", () => {
    expect(isZipFile({ name: "pack.zip", type: "application/octet-stream" })).toBe(true);
    expect(isZipFile({ name: "PACK.ZIP" })).toBe(true);
  });

  it("recognises a zip by MIME type when the name has no extension", () => {
    expect(isZipFile({ name: "archive", type: "application/zip" })).toBe(true);
    expect(isZipFile({ name: "archive", type: "application/x-zip-compressed" })).toBe(true);
  });

  it("does not claim ordinary documents", () => {
    expect(isZipFile({ name: "LPA.pdf", type: "application/pdf" })).toBe(false);
    // .xlsx is a zip underneath, but it is a document, not a container.
    expect(isZipFile({ name: "model.xlsx", type: "application/zip" })).toBe(false);
  });
});

describe("normalizeFolder", () => {
  it("strips the ordering prefixes assembled packs carry", () => {
    expect(normalizeFolder("01 - Fund Terms")).toBe("fund terms");
    expect(normalizeFolder("3. Financials")).toBe("financials");
    expect(normalizeFolder("04_Legal")).toBe("legal");
  });

  it("expands ampersands rather than dropping them", () => {
    expect(normalizeFolder("Legal & Structure")).toBe("legal and structure");
  });

  it("collapses case and punctuation", () => {
    expect(normalizeFolder("TRACK-RECORD")).toBe("track record");
  });

  it("does not eat a name that merely starts with a digit word", () => {
    expect(normalizeFolder("2026 Audits")).toBe("audits");
  });
});

describe("sectionFromPath", () => {
  it("matches a section by its own label", () => {
    expect(sectionFromPath("Fund Terms/LPA.pdf")).toBe("fund_terms");
    expect(sectionFromPath("Legal & Structure/Formation.pdf")).toBe("legal");
  });

  it("matches a section by its key", () => {
    expect(sectionFromPath("track_record/2026.xlsx")).toBe("track_record");
  });

  it("matches the folder names diligence packs actually use", () => {
    expect(sectionFromPath("PPM/offering.pdf")).toBe("fund_terms");
    expect(sectionFromPath("DDQ/ilpa.docx")).toBe("diligence");
    expect(sectionFromPath("Audits/2025.pdf")).toBe("financials");
    expect(sectionFromPath("Ops/service-providers.pdf")).toBe("operations");
  });

  it("prefers the deepest matching folder", () => {
    // The nearer folder is the more specific claim about what the file is.
    expect(sectionFromPath("Legal/DDQ/answers.pdf")).toBe("diligence");
  });

  it("ignores the filename itself when matching", () => {
    // "team" here is the document, not the filing.
    expect(sectionFromPath("team.pdf")).toBeNull();
  });

  it("returns null when no folder matches", () => {
    expect(sectionFromPath("Assorted/Q3/notes.pdf")).toBeNull();
  });
});

describe("planZipImport", () => {
  const DEFAULT = { defaultSection: "other" };

  it("files each entry under the section its folder names", () => {
    const plan = planZipImport(
      [entry("Fund Terms/LPA.pdf"), entry("Financials/Audit 2025.pdf")],
      DEFAULT,
    );
    expect(plan.items).toHaveLength(2);
    expect(plan.items.find((i) => i.name === "LPA")?.section).toBe("fund_terms");
    expect(plan.items.find((i) => i.name === "Audit 2025")?.section).toBe("financials");
    expect(plan.items.every((i) => i.matchedFolder)).toBe(true);
  });

  it("falls back to the given section and says it was not matched", () => {
    const plan = planZipImport([entry("Assorted/notes.pdf")], { defaultSection: "marketing" });
    expect(plan.items[0].section).toBe("marketing");
    expect(plan.items[0].matchedFolder).toBe(false);
  });

  it("drops directory entries without reporting them as skipped", () => {
    const plan = planZipImport([entry("Fund Terms/"), entry("Fund Terms/LPA.pdf")], DEFAULT);
    expect(plan.items).toHaveLength(1);
    expect(plan.skipped).toHaveLength(0);
  });

  it("drops archive noise silently", () => {
    const plan = planZipImport(
      [
        entry("__MACOSX/._LPA.pdf"),
        entry(".DS_Store"),
        entry("Fund Terms/.hidden.pdf"),
        entry("Thumbs.db"),
        entry("Fund Terms/LPA.pdf"),
      ],
      DEFAULT,
    );
    expect(plan.items).toHaveLength(1);
    expect(plan.skipped).toHaveLength(0);
  });

  it("reports an unsupported file as skipped WITH a reason", () => {
    // Silently dropping entries is indistinguishable from a working import.
    const plan = planZipImport([entry("bin/tool.exe"), entry("Legal/deed.pdf")], DEFAULT);
    expect(plan.items).toHaveLength(1);
    expect(plan.skipped).toEqual([
      { path: "bin/tool.exe", reason: expect.stringContaining("can't be stored") },
    ]);
  });

  it("skips an entry larger than the per-file upload limit", () => {
    const plan = planZipImport([entry("Legal/huge.pdf", 101 * 1024 * 1024)], DEFAULT);
    expect(plan.items).toHaveLength(0);
    expect(plan.skipped[0].reason).toContain("100 MB");
  });

  it("orders the plan by section, then by name", () => {
    const plan = planZipImport(
      [
        entry("Financials/B.pdf"),
        entry("Firm Overview/Z.pdf"),
        entry("Financials/A.pdf"),
      ],
      DEFAULT,
    );
    // overview precedes financials in DATA_ROOM_SECTIONS.
    expect(plan.items.map((i) => i.name)).toEqual(["Z", "A", "B"]);
  });

  it("stops at the entry ceiling and says so", () => {
    const many = Array.from({ length: MAX_ZIP_ENTRIES + 10 }, (_, i) => entry(`Legal/f${i}.pdf`));
    const plan = planZipImport(many, DEFAULT);
    expect(plan.truncated).toBe(true);
    expect(plan.items.length).toBeLessThanOrEqual(MAX_ZIP_ENTRIES);
  });

  it("does not mark a plan truncated when it fits", () => {
    const plan = planZipImport([entry("Legal/a.pdf")], DEFAULT);
    expect(plan.truncated).toBe(false);
  });

  it("keeps the full path as each row's identity", () => {
    // Two files can share a name in different folders; the path disambiguates.
    const plan = planZipImport(
      [entry("Legal/Summary.pdf"), entry("Financials/Summary.pdf")],
      DEFAULT,
    );
    expect(plan.items).toHaveLength(2);
    expect(new Set(plan.items.map((i) => i.path)).size).toBe(2);
    expect(plan.items.every((i) => i.name === "Summary")).toBe(true);
  });
});

describe("describePlan", () => {
  it("counts documents and the sections they span", () => {
    const plan = planZipImport(
      [entry("Legal/a.pdf"), entry("Legal/b.pdf"), entry("Financials/c.pdf")],
      { defaultSection: "other" },
    );
    expect(describePlan(plan)).toBe("3 documents across 2 sections");
  });

  it("singularises a lone document", () => {
    const plan = planZipImport([entry("Legal/a.pdf")], { defaultSection: "other" });
    expect(describePlan(plan)).toBe("1 document across 1 section");
  });

  it("says plainly when there is nothing to file", () => {
    const plan = planZipImport([entry("bin/tool.exe")], { defaultSection: "other" });
    expect(describePlan(plan)).toBe("Nothing in this archive can be filed.");
  });
});
