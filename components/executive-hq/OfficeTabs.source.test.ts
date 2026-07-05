import { readFileSync } from "fs";
import path from "path";

describe("OfficeTabs source contract", () => {
  const source = readFileSync(path.join(process.cwd(), "components/executive-hq/OfficeTabs.tsx"), "utf8");

  it("defaults to the Virtual Office and keeps HQ as secondary overview", () => {
    expect(source).toContain('useState<Tab>("virtual")');
    expect(source).toMatch(/>\s*Overview\s*</);
    expect(source).not.toContain("HQ Overview");
  });

  it("does not expose milestone/internal labels in the product tab", () => {
    expect(source).not.toContain(">M4<");
  });
});
