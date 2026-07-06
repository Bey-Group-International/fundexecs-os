import { promises as fs } from "fs";
import path from "path";
import { REFERENCE_DOCS, referenceDocsForBrain } from "@/lib/brains/reference";
import { BRAINS, BRAIN_BY_KEY } from "@/lib/brains/catalog";
import type { BrainKey } from "@/lib/brains/types";

const REFERENCE_DIR = path.join(process.cwd(), "lib", "brains", "knowledge", "reference");

describe("brain reference corpus", () => {
  it("maps every reference doc to at least one valid, known brain", () => {
    for (const doc of REFERENCE_DOCS) {
      expect(doc.brains.length).toBeGreaterThan(0);
      for (const key of doc.brains) {
        expect(BRAIN_BY_KEY[key]).toBeDefined();
      }
      // No duplicate brains within a single mapping.
      expect(new Set(doc.brains).size).toBe(doc.brains.length);
    }
  });

  it("points every mapping at a reference file that exists and is non-empty", async () => {
    for (const doc of REFERENCE_DOCS) {
      const content = await fs.readFile(path.join(REFERENCE_DIR, doc.file), "utf8");
      expect(content.trim().length).toBeGreaterThan(0);
    }
  });

  it("uses unique reference filenames", () => {
    const files = REFERENCE_DOCS.map((d) => d.file);
    expect(new Set(files).size).toBe(files.length);
  });

  it("referenceDocsForBrain returns only docs mapped to that brain", () => {
    for (const brain of BRAINS) {
      const key = brain.key as BrainKey;
      const docs = referenceDocsForBrain(key);
      for (const doc of docs) {
        expect(doc.brains).toContain(key);
      }
      // A brain with no mapping gets an empty list, never undefined.
      expect(Array.isArray(docs)).toBe(true);
    }
  });

  it("folds the private-equity playbook and B2B agent catalog into their brains", () => {
    expect(referenceDocsForBrain("deal_sourcer").map((d) => d.file)).toContain(
      "private_equity_playbook.md",
    );
    expect(referenceDocsForBrain("funnel_lead_gen").map((d) => d.file)).toContain(
      "b2b_ai_agents_catalog.md",
    );
  });
});
