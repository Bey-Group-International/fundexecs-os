import { promises as fs } from "fs";
import path from "path";
import { BRAINS, BRAIN_BY_KEY, getBrain } from "@/lib/brains/catalog";
import type { BrainKey } from "@/lib/brains/types";

const KNOWLEDGE_DIR = path.join(process.cwd(), "lib", "brains", "knowledge");

// The four skills installed natively from external systems (InvestorLift,
// the lenders ecosystem, startupdeals/Dealfinder, and the M&A + Crunchbase-ML
// stack). Kept explicit so a rename or accidental removal fails loudly.
const INSTALLED_SKILLS: BrainKey[] = [
  "disposition_desk",
  "lender_network",
  "deal_scout",
  "ma_integrator",
];

describe("brain catalog", () => {
  it("uses a unique key per brain", () => {
    const keys = BRAINS.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("indexes every brain in BRAIN_BY_KEY and getBrain", () => {
    for (const brain of BRAINS) {
      expect(BRAIN_BY_KEY[brain.key]).toBe(brain);
      expect(getBrain(brain.key)).toBe(brain);
    }
  });

  it("returns undefined from getBrain for an unknown key", () => {
    expect(getBrain("not_a_brain")).toBeUndefined();
  });

  it("gives every brain a non-empty execution profile", () => {
    for (const brain of BRAINS) {
      expect(brain.name.trim().length).toBeGreaterThan(0);
      expect(brain.role.trim().length).toBeGreaterThan(0);
      expect(brain.useWhen.length).toBeGreaterThan(0);
      expect(brain.outputs.length).toBeGreaterThan(0);
      expect(brain.tools.length).toBeGreaterThan(0);
      expect(brain.systemPreamble.trim().length).toBeGreaterThan(0);
      for (const tool of brain.tools) {
        expect(tool.id.trim().length).toBeGreaterThan(0);
        expect(tool.label.trim().length).toBeGreaterThan(0);
      }
    }
  });

  // The ingest route (app/api/brains/ingest) reads lib/brains/knowledge/<key>.md
  // for every brain. A brain without its KB file would silently ship with no
  // corpus to retrieve over, so guard the invariant here.
  it("backs every brain with a non-empty knowledge base file", async () => {
    for (const brain of BRAINS) {
      const file = path.join(KNOWLEDGE_DIR, `${brain.key}.md`);
      const content = await fs.readFile(file, "utf8");
      expect(content.trim().length).toBeGreaterThan(0);
    }
  });

  it("installs the four natively-rebuilt external skills", () => {
    for (const key of INSTALLED_SKILLS) {
      expect(BRAIN_BY_KEY[key]).toBeDefined();
    }
  });
});
