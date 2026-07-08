import { readFileSync } from "fs";
import path from "path";

describe("OfficeTabs source contract", () => {
  const source = readFileSync(path.join(process.cwd(), "components/executive-hq/OfficeTabs.tsx"), "utf8");

  it("shows only the Virtual Office — the secondary Overview/HQ tab was removed", () => {
    expect(source).toContain('useState<Tab>("virtual")');
    // The Overview tab (and its ExecutiveHQ panel) is gone; the floor is the only view.
    expect(source).not.toMatch(/>\s*Overview\s*</);
    expect(source).not.toContain("ExecutiveHQ");
    expect(source).not.toContain("HQ Overview");
  });

  it("does not expose milestone/internal labels in the product tab", () => {
    expect(source).not.toContain(">M4<");
  });
});
