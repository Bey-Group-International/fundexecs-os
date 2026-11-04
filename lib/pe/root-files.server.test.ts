const rows: Array<{ file_key: string; content: unknown }> = [];
jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => true,
  createServiceClient: () => ({ from: () => ({ select: () => ({ eq: async () => ({ data: rows }) }) }) }),
}));

import { ROOT_BINDINGS, withOrgMandate } from "./root-files.server";
import { SKILL_GATES } from "./gates";
import { getSkill } from "@/lib/skills/registry";
import { FIXTURE } from "./test-fixture";

beforeEach(() => {
  rows.length = 0;
});

describe("ROOT_BINDINGS", () => {
  it("only binds registered skills", () => {
    for (const id of Object.keys(ROOT_BINDINGS)) expect(getSkill(id)).not.toBeNull();
  });
});

describe("withOrgMandate", () => {
  it("fills a missing mandate from the org's stored one, but an explicit input always wins", async () => {
    rows.push({ file_key: "mandate", content: FIXTURE });
    const filled = (await withOrgMandate("org", "target-screen", { targets: [] })) as Record<string, unknown>;
    expect((filled.mandate as { hardLimits: unknown[] }).hardLimits).toHaveLength(4);
    const explicit = { mandate: { status: "draft" }, targets: [] };
    expect(await withOrgMandate("org", "target-screen", explicit)).toBe(explicit);
  });

  it("never injects a standing default as if it were the firm's own", async () => {
    const input = { ebitda: 10 };
    expect(await withOrgMandate("org", "bid-range", input)).toEqual({ ebitda: 10 }); // no returns row stored
    rows.push({ file_key: "returns", content: { base: { irr: 0.3 }, holdYears: 4 } });
    const withOwn = (await withOrgMandate("org", "bid-range", input)) as { hurdles?: { base: { irr: number } } };
    expect(withOwn.hurdles?.base.irr).toBe(0.3);
  });

  it("binds financing and KPI policy to their skills, and leaves unbound skills alone", async () => {
    rows.push({ file_key: "financing", content: { liquidityMinimum: 5 } }, { file_key: "kpi", content: { materialityPct: 3 } });
    expect(((await withOrgMandate("org", "cash-13-week", { company: "x" })) as { financing?: unknown }).financing).toMatchObject({ liquidityMinimum: 5 });
    expect(((await withOrgMandate("org", "kpi-variance", { company: "x" })) as { kpiPolicy?: unknown }).kpiPolicy).toMatchObject({ materialityPct: 3 });
    const other = { a: 1 };
    expect(await withOrgMandate("org", "lbo", other)).toBe(other);
  });
});

describe("gate owners from the firm file", () => {
  const firm = { firmName: "Acme", gateOwners: { first_look: "Jane Doe (deal lead)", bid_price: "Investment Committee" } };

  it("names the firm's owner for a skill's gate, and leaves the generic role when none is named", async () => {
    rows.push({ file_key: "firm", content: firm });
    expect(((await withOrgMandate("org", "first-look", { deal: {} })) as { gateOwner?: string }).gateOwner).toBe("Jane Doe (deal lead)");
    expect(((await withOrgMandate("org", "bid-range", { ebitda: 1 })) as { gateOwner?: string }).gateOwner).toBe("Investment Committee");
    // The firm named no owner for this skill's gate -> nothing injected -> the skill's own default stays.
    expect(((await withOrgMandate("org", "qoe-bridge", { reportedEbitda: 1 })) as { gateOwner?: string }).gateOwner).toBeUndefined();
  });

  it("an explicit gateOwner always wins, and no firm file injects nothing", async () => {
    const explicit = { deal: {}, gateOwner: "Someone else" };
    rows.push({ file_key: "firm", content: firm });
    expect(await withOrgMandate("org", "first-look", explicit)).toBe(explicit);
    rows.length = 0;
    const input = { deal: {} };
    expect(await withOrgMandate("org", "first-look", input)).toEqual({ deal: {} });
  });

  it("every gated skill is bound, registered, and accepts a gateOwner input", () => {
    for (const skillId of Object.keys(SKILL_GATES)) {
      expect(ROOT_BINDINGS[skillId]?.some((b) => b.input === "gateOwner")).toBe(true);
      const skill = getSkill(skillId);
      expect(skill).not.toBeNull();
      expect(skill!.manifest.inputSchema.properties?.gateOwner).toBeDefined();
    }
  });
});
