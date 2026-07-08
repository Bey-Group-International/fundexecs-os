import {
  deriveTraits,
  traitDescriptor,
  executiveSheet,
  matchExecForSkills,
  reputationFromShipped,
  EXEC_PROFILES,
  SKILLS,
  TRAIT_KEYS,
  type CharacterAttributes,
  type Skill,
} from "./characterSheet";
import { PROGRAM_AGENTS, AGENT_BY_ID, type AgentId } from "@/components/virtual-office/program/officeProgram";

const FLAT: CharacterAttributes = {
  rigor: 50, creativity: 50, riskAppetite: 50, speed: 50, diligence: 50, communication: 50,
};

describe("deriveTraits", () => {
  it("keeps every derived trait within 0–100", () => {
    const extremes: CharacterAttributes[] = [
      { rigor: 0, creativity: 0, riskAppetite: 0, speed: 0, diligence: 0, communication: 0 },
      { rigor: 100, creativity: 100, riskAppetite: 100, speed: 100, diligence: 100, communication: 100 },
      FLAT,
    ];
    for (const a of extremes) {
      const t = deriveTraits(a);
      for (const k of TRAIT_KEYS) {
        expect(t[k]).toBeGreaterThanOrEqual(0);
        expect(t[k]).toBeLessThanOrEqual(100);
        expect(Number.isInteger(t[k])).toBe(true);
      }
    }
  });

  it("raises decisiveness with more speed and risk appetite", () => {
    const low = deriveTraits({ ...FLAT, speed: 20, riskAppetite: 20 });
    const high = deriveTraits({ ...FLAT, speed: 90, riskAppetite: 90 });
    expect(high.decisiveness).toBeGreaterThan(low.decisiveness);
  });

  it("raises thoroughness with more rigor and diligence", () => {
    const low = deriveTraits({ ...FLAT, rigor: 20, diligence: 20 });
    const high = deriveTraits({ ...FLAT, rigor: 95, diligence: 95 });
    expect(high.thoroughness).toBeGreaterThan(low.thoroughness);
  });

  it("is deterministic", () => {
    expect(deriveTraits(FLAT)).toEqual(deriveTraits(FLAT));
  });
});

describe("traitDescriptor", () => {
  it("returns a non-empty descriptor for every executive", () => {
    for (const id of Object.keys(EXEC_PROFILES) as AgentId[]) {
      const d = traitDescriptor(EXEC_PROFILES[id].attributes);
      expect(typeof d).toBe("string");
      expect(d.length).toBeGreaterThan(0);
    }
  });
});

describe("EXEC_PROFILES", () => {
  it("covers all program agents exactly", () => {
    const profileIds = Object.keys(EXEC_PROFILES).sort();
    const agentIds = PROGRAM_AGENTS.map((a) => a.id).sort();
    expect(profileIds).toEqual(agentIds);
  });

  it("only references skills from the taxonomy, with valid attributes", () => {
    const skillSet = new Set<Skill>(SKILLS);
    for (const id of Object.keys(EXEC_PROFILES) as AgentId[]) {
      const p = EXEC_PROFILES[id];
      expect(p.skills.length).toBeGreaterThan(0);
      for (const s of p.skills) expect(skillSet.has(s)).toBe(true);
      // No duplicate skills within a profile.
      expect(new Set(p.skills).size).toBe(p.skills.length);
      for (const v of Object.values(p.attributes)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("executiveSheet", () => {
  it("merges program wiring with the competency profile", () => {
    const agent = AGENT_BY_ID.analyst;
    const sheet = executiveSheet(agent);
    expect(sheet).toMatchObject({
      id: "analyst",
      kind: "executive",
      name: agent.name,
      role: agent.role,
      accent: agent.accent,
      homeRoom: agent.homeRoom,
      skills: EXEC_PROFILES.analyst.skills,
      attributes: EXEC_PROFILES.analyst.attributes,
    });
  });
});

describe("matchExecForSkills", () => {
  it("returns null for an empty request", () => {
    expect(matchExecForSkills([])).toBeNull();
  });

  it("routes a unique skill to the owning executive", () => {
    // fund_admin is owned only by ops_admin.
    const m = matchExecForSkills(["fund_admin"]);
    expect(m?.agentId).toBe("ops_admin");
    expect(m?.score).toBeGreaterThan(0);
    expect(m?.score).toBeLessThanOrEqual(1);
  });

  it("scores a full-coverage request at 1", () => {
    const m = matchExecForSkills(EXEC_PROFILES.legal.skills);
    expect(m?.score).toBe(1);
  });

  it("prefers the executive covering more of the request", () => {
    const m = matchExecForSkills(["modeling", "underwriting"]);
    // analyst owns both; associate owns only modeling.
    expect(m?.agentId).toBe("analyst");
  });
});

describe("reputationFromShipped", () => {
  it("starts at level 1 with nothing shipped", () => {
    expect(reputationFromShipped(0)).toEqual({ level: 1, inLevel: 0, toNext: 1 });
  });

  it("never decreases level as shipped grows", () => {
    let prev = 0;
    for (let n = 0; n <= 80; n++) {
      const level = reputationFromShipped(n).level;
      expect(level).toBeGreaterThanOrEqual(prev);
      prev = level;
    }
  });

  it("advances a level exactly at each threshold", () => {
    expect(reputationFromShipped(1).level).toBe(2);
    expect(reputationFromShipped(3).level).toBe(3);
    expect(reputationFromShipped(2).level).toBe(2);
  });

  it("caps toNext at 0 past the last threshold", () => {
    const capped = reputationFromShipped(9999);
    expect(capped.toNext).toBe(0);
    expect(capped.level).toBeGreaterThan(1);
  });

  it("clamps negatives to the base standing", () => {
    expect(reputationFromShipped(-5)).toEqual({ level: 1, inLevel: 0, toNext: 1 });
  });
});
