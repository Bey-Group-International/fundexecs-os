// Asserts the TypeScript skill manifest stays consistent with its /skills/<id>/
// authoring package (the JSON schemas on disk). If the two drift, this fails —
// so the human-facing spec and the runtime contract can never diverge silently.
import { readFileSync } from "fs";
import { join } from "path";
import { screenDealManifest } from "./catalog/screen-deal";

function loadJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), rel), "utf8"));
}

describe("screen-deal package consistency", () => {
  it("input schema on disk matches the manifest", () => {
    expect(loadJson("skills/screen-deal/input.schema.json")).toEqual(screenDealManifest.inputSchema);
  });

  it("output schema on disk matches the manifest", () => {
    expect(loadJson("skills/screen-deal/output.schema.json")).toEqual(screenDealManifest.outputSchema);
  });

  it("the example input validates against the schema", async () => {
    const { validate } = await import("./validate");
    const example = loadJson("skills/screen-deal/examples/example-1.json") as { input: unknown };
    const r = validate(example.input, screenDealManifest.inputSchema);
    expect(r.valid).toBe(true);
  });
});
