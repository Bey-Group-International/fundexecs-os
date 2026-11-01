// The SOC 2 control map names files as its evidence. A map whose evidence has
// moved is worse than none, so this fails when a path it names stops existing,
// when it forgets the "not a certification" framing, or when it names a gap
// that nothing in the table defines.
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..", "..");
const DOC = readFileSync(join(ROOT, "docs/compliance/soc2-lp-onboarding.md"), "utf8");

/** Every `backticked` span that looks like a path into this repository. */
function namedPaths(text: string): string[] {
  const spans = Array.from(text.matchAll(/`([^`\n]+)`/g)).map((m) => m[1].trim());
  const roots = ["app/", "lib/", "components/", "supabase/", "docs/", ".github/", "scripts/", "vercel.json", "next.config.", "proxy.ts"];
  return Array.from(new Set(spans.filter((s) => !/\s/.test(s) && roots.some((r) => s.startsWith(r)))));
}

describe("docs/compliance/soc2-lp-onboarding.md", () => {
  it("names the files it relies on", () => {
    const paths = namedPaths(DOC);
    expect(paths.length).toBeGreaterThan(20);
    expect(paths.filter((p) => !existsSync(join(ROOT, p)))).toEqual([]);
  });

  it("says plainly that it is a map and not a certification", () => {
    expect(DOC).toMatch(/\*\*map\*\*, not a certification/i);
    expect(DOC).toMatch(/not a claim of compliance/i);
    expect(DOC).toMatch(/independent CPA/i);
  });

  it("defines every gap it refers to, and refers to each gap it defines", () => {
    const defined = Array.from(DOC.matchAll(/^\| (G-\d+) \|/gm)).map((m) => m[1]);
    expect(defined.length).toBeGreaterThanOrEqual(8);
    expect(new Set(defined).size).toBe(defined.length);
    const referenced = Array.from(DOC.matchAll(/\b(G-\d+)\b/g)).map((m) => m[1]);
    for (const id of referenced) expect(defined).toContain(id);
    // Every gap is also cited from the control table, so none is orphaned.
    const body = DOC.split("## Gaps, in the order worth fixing")[0];
    for (const id of defined) expect(body).toContain(id);
  });

  it("uses only the status words it defines", () => {
    const rows = DOC.split("\n").filter((l) => /^\| CC|^\| C1|^\| A1|^\| PI1|^\| P\d/.test(l));
    expect(rows.length).toBeGreaterThan(20);
    for (const row of rows) {
      const status = row.split("|").map((c) => c.trim()).filter(Boolean).pop() ?? "";
      expect(status).toMatch(/^(In place|Partial|Gap|Outside)/);
    }
  });
});
