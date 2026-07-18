// Cross-catalog invariants for every REGISTERED skill. This guards the whole
// registry (not just one skill): the TS manifest and the on-disk /skills/<id>/
// package never drift, every applicable executive is actually permitted to run
// the skill, and the approval tier is valid. New skills are covered automatically.
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { listSkills } from "./registry";
import { canRunSkill } from "@/lib/executives/registry";

function loadJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), rel), "utf8"));
}

describe.each(listSkills().map((s) => [s.manifest.id, s] as const))("skill package: %s", (id, skill) => {
  const dir = `skills/${id}`;

  it("has an authoring package on disk", () => {
    expect(existsSync(join(process.cwd(), dir, "skill.yaml"))).toBe(true);
    expect(existsSync(join(process.cwd(), dir, "SKILL.md"))).toBe(true);
  });

  it("input schema on disk matches the manifest", () => {
    expect(loadJson(`${dir}/input.schema.json`)).toEqual(skill.manifest.inputSchema);
  });

  it("output schema on disk matches the manifest", () => {
    expect(loadJson(`${dir}/output.schema.json`)).toEqual(skill.manifest.outputSchema);
  });

  it("every applicable executive is permitted to run it", () => {
    for (const exec of skill.manifest.applicableExecutives) {
      expect(canRunSkill(exec, id)).toBe(true);
    }
  });

  it("declares a valid approval tier", () => {
    expect([1, 2, 3]).toContain(skill.manifest.approvalTier);
  });
});
