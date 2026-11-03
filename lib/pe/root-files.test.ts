import { resolveRootFiles } from "./root-files";
import { FIXTURE } from "./test-fixture";

describe("resolveRootFiles", () => {
  it("reports what was found and what was not, and falls back to an empty draft mandate", () => {
    const r = resolveRootFiles([]);
    expect(r.found).toEqual([]);
    expect(r.mandate.status).toBe("draft");
    expect(r.statusLine).toMatch(/Root files found: none\. Not found: firm, mandate.*run on default settings\./);
  });

  it("parses a stored mandate and keeps its approved status", () => {
    const r = resolveRootFiles([{ file_key: "mandate", content: FIXTURE }, { file_key: "returns", content: { irrHurdle: 0.2 } }, { file_key: "bogus", content: { a: 1 } }]);
    expect(r.found).toEqual(["mandate", "returns"]);
    expect(r.mandate.status).toBe("approved");
    expect(r.mandate.hardLimits).toHaveLength(4);
    expect(r.missing).not.toContain("mandate");
  });

  it("treats an unparseable or empty mandate as missing", () => {
    expect(resolveRootFiles([{ file_key: "mandate", content: "garbage" }]).found).toEqual([]);
    expect(resolveRootFiles([{ file_key: "mandate", content: { hardLimits: [] } }]).found).toEqual([]);
  });
});
