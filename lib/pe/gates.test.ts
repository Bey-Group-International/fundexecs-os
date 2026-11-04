import { GATE_KEYS, gateOwnerFor, parseFirmFile, SKILL_GATES } from "./gates";
import { getSkill } from "@/lib/skills/registry";
import { ROOT_FILE_META } from "./root-file-templates";

describe("parseFirmFile", () => {
  it("keeps real names for known gates and reports unknown keys and over-long names", () => {
    const p = parseFirmFile({ firmName: "Acme", gateOwners: { first_look: " Jane ", bid_price: "", nope: "x", exit_route: "z".repeat(300) } });
    expect(p.firm).toEqual({ firmName: "Acme", gateOwners: { first_look: "Jane" } });
    expect(p.unknownKeys).toEqual(["nope"]);
    expect(p.droppedOwners).toEqual(["exit_route"]);
  });

  it("is null with nothing usable, and never throws on junk", () => {
    for (const junk of [null, undefined, "x", 5, [], { gateOwners: [] }, { gateOwners: { first_look: 5 } }]) expect(parseFirmFile(junk).firm).toBeNull();
    expect(parseFirmFile({ firmName: "Only a name" }).firm).toEqual({ firmName: "Only a name", gateOwners: {} });
  });
});

describe("SKILL_GATES", () => {
  it("covers exactly the 22 PE skills, with one distinct gate each, all registered", () => {
    expect(Object.keys(SKILL_GATES)).toHaveLength(22);
    for (const id of Object.keys(SKILL_GATES)) expect(getSkill(id)).not.toBeNull();
    const keys = Object.values(SKILL_GATES).map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(keys)).toEqual(new Set(GATE_KEYS));
  });

  it("gateOwnerFor returns only a name the firm wrote", () => {
    const firm = { gateOwners: { first_look: "Jane" } };
    expect(gateOwnerFor("first-look", firm)).toBe("Jane");
    expect(gateOwnerFor("bid-range", firm)).toBeUndefined();
    expect(gateOwnerFor("lbo", firm)).toBeUndefined(); // not a gated PE skill
    expect(gateOwnerFor("first-look", null)).toBeUndefined();
  });

  it("the firm starter lists every gate, blank", () => {
    const starter = JSON.parse(ROOT_FILE_META.find((m) => m.key === "firm")!.starter) as { gateOwners: Record<string, string> };
    expect(Object.keys(starter.gateOwners).sort()).toEqual([...GATE_KEYS].sort());
    expect(Object.values(starter.gateOwners).every((v) => v === "")).toBe(true);
  });
});
