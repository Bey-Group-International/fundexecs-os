import {
  deriveTraits,
  traitDescriptor,
  executiveSheet,
  matchExecForSkills,
  reputationFromShipped,
  inferSkillsFromText,
  autoRouteTask,
  pantomimeForSkill,
  pantomimeForAgent,
  SKILL_PANTOMIME,
  topicKey,
  topicsOverlap,
  buildExecMemoryIndex,
  precedentsFor,
  recallPrecedent,
  triggerFires,
  evaluateTriggers,
  EXEC_PROFILES,
  SKILLS,
  TRAIT_KEYS,
  type CharacterAttributes,
  type Skill,
  type Precedent,
  type AutonomousTrigger,
  type TriggerContext,
} from "./characterSheet";
import { PROGRAM_AGENTS, AGENT_BY_ID, type AgentId } from "@/components/virtual-office/program/officeProgram";

/** Build a precedent with sensible defaults for the memory/trigger tests. */
function precedent(p: Partial<Precedent> & Pick<Precedent, "execId" | "label">): Precedent {
  return {
    topic: topicKey(p.label),
    outcome: "complete",
    auditEventId: `aud-${p.label}`,
    ts: 1_000,
    ...p,
  };
}

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

describe("inferSkillsFromText", () => {
  it("returns no skills for text without cues", () => {
    expect(inferSkillsFromText("")).toEqual([]);
    expect(inferSkillsFromText("hello there")).toEqual([]);
  });

  it("only returns skills from the taxonomy", () => {
    const skillSet = new Set<Skill>(SKILLS);
    for (const s of inferSkillsFromText("draft the LP update and review the closing documents")) {
      expect(skillSet.has(s)).toBe(true);
    }
  });

  it("infers ir from an LP update task", () => {
    expect(inferSkillsFromText("Draft the LP update")).toContain("ir");
  });

  it("infers legal from a closing-documents task", () => {
    expect(inferSkillsFromText("Review the closing documents")).toContain("legal");
  });

  it("returns matches in taxonomy order (stable primary)", () => {
    const skills = inferSkillsFromText("build a base-case model and screen the target");
    // screening precedes modeling in SKILLS order.
    expect(skills.indexOf("screening")).toBeLessThan(skills.indexOf("modeling"));
  });

  it("is deterministic", () => {
    const txt = "Prepare a capital call and reconcile settlement";
    expect(inferSkillsFromText(txt)).toEqual(inferSkillsFromText(txt));
  });
});

describe("autoRouteTask", () => {
  it("returns null when no skill can be inferred", () => {
    expect(autoRouteTask("xyzzy")).toBeNull();
  });

  it("routes an LP-update task to investor relations", () => {
    const r = autoRouteTask("Draft the quarterly LP update");
    expect(r?.agentId).toBe("investor_relations");
    expect(r?.score).toBeGreaterThan(0);
    expect(r?.skills).toContain("ir");
  });

  it("routes an underwriting-model task to the analyst", () => {
    // analyst owns both underwriting + modeling; associate owns only modeling.
    const r = autoRouteTask("Run the underwriting model and sensitivities");
    expect(r?.agentId).toBe("analyst");
  });

  it("routes a fund-admin task to ops/admin", () => {
    // fund_admin is owned only by ops_admin.
    const r = autoRouteTask("Generate the fund admin report");
    expect(r?.agentId).toBe("ops_admin");
  });
});

describe("pantomime", () => {
  const POSES = new Set(["typing", "reviewing_docs", "presenting", "analyzing_model"]);

  it("maps every skill to a valid work pose", () => {
    for (const s of SKILLS) {
      expect(POSES.has(SKILL_PANTOMIME[s])).toBe(true);
      expect(pantomimeForSkill(s)).toBe(SKILL_PANTOMIME[s]);
    }
  });

  it("derives a document skill's pantomime as reviewing_docs", () => {
    expect(pantomimeForSkill("legal")).toBe("reviewing_docs");
  });

  it("uses the task text when it carries a skill signal", () => {
    // Legal reviewing docs even though the agent addressed is the analyst.
    expect(pantomimeForAgent("analyst", "Review the closing documents")).toBe("reviewing_docs");
  });

  it("falls back to the agent's primary skill without task text", () => {
    expect(pantomimeForAgent("analyst")).toBe(pantomimeForSkill(EXEC_PROFILES.analyst.skills[0]));
    expect(pantomimeForAgent("investor_relations")).toBe("presenting");
  });

  it("returns a defined pose for every executive with no task text", () => {
    for (const id of Object.keys(EXEC_PROFILES) as (keyof typeof EXEC_PROFILES)[]) {
      expect(POSES.has(pantomimeForAgent(id))).toBe(true);
    }
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

describe("topicKey / topicsOverlap", () => {
  it("normalizes whitespace and case", () => {
    expect(topicKey("  KPI   Board ")).toBe("kpi board");
  });

  it("matches an exact normalized topic", () => {
    expect(topicsOverlap("KPI Board", "kpi   board")).toBe(true);
  });

  it("matches on a shared significant token", () => {
    // "Draft"/"Review" are stopwords; "Update" is the shared signal.
    expect(topicsOverlap("LP Update Draft", "LP Update Review")).toBe(true);
  });

  it("does not match unrelated topics", () => {
    expect(topicsOverlap("Model & Scenarios", "Market Validation")).toBe(false);
  });
});

describe("buildExecMemoryIndex / precedentsFor", () => {
  it("groups precedents by exec, newest first", () => {
    const index = buildExecMemoryIndex([
      precedent({ execId: "portfolio_ops", label: "KPI Board", ts: 100 }),
      precedent({ execId: "portfolio_ops", label: "KPI Board", ts: 300 }),
      precedent({ execId: "analyst", label: "Model & Scenarios", ts: 200 }),
    ]);
    const ops = precedentsFor(index, "portfolio_ops");
    expect(ops.map((p) => p.ts)).toEqual([300, 100]); // newest first
    expect(precedentsFor(index, "analyst")).toHaveLength(1);
    expect(precedentsFor(index, "treasury")).toEqual([]); // exec with no history
  });
});

describe("recallPrecedent", () => {
  const history: Precedent[] = [
    precedent({ execId: "portfolio_ops", label: "KPI Board", ts: 100 }),
    precedent({ execId: "portfolio_ops", label: "KPI Board", ts: 400 }),
    precedent({ execId: "portfolio_ops", label: "KPI Board", ts: 250, outcome: "rejected" }),
  ];

  it("returns null when nothing matches (or history is empty)", () => {
    expect(recallPrecedent(history, "Closing Documents")).toBeNull();
    expect(recallPrecedent([], "KPI Board")).toBeNull();
  });

  it("recalls the most recent completed matching precedent", () => {
    const hit = recallPrecedent(history, "KPI Board");
    expect(hit?.ts).toBe(400);
    expect(hit?.outcome).toBe("complete");
  });

  it("prefers a completed precedent over a newer rejected one", () => {
    const hit = recallPrecedent(
      [
        precedent({ execId: "analyst", label: "Model & Scenarios", ts: 100 }),
        precedent({ execId: "analyst", label: "Model & Scenarios", ts: 500, outcome: "rejected" }),
      ],
      "Model & Scenarios",
    );
    expect(hit?.ts).toBe(100);
    expect(hit?.outcome).toBe("complete");
  });
});

describe("autonomous triggers", () => {
  const trigger: AutonomousTrigger = {
    id: "portfolio-review",
    execId: "portfolio_ops",
    command: "Portfolio operations review",
    announce: "Refreshing KPIs.",
    condition: { kind: "recurring_review", topic: "KPI Board", everyMs: 1_000 },
  };

  const ctx = (over: Partial<TriggerContext>): TriggerContext => ({
    now: 10_000,
    officeIdle: true,
    precedentsFor: () => [precedent({ execId: "portfolio_ops", label: "KPI Board", ts: 5_000 })],
    ...over,
  });

  it("fires when the last matching shipment is stale and the office is idle", () => {
    expect(triggerFires(trigger, ctx({ now: 6_001 }))).toBe(true);
  });

  it("does not fire before the interval elapses", () => {
    expect(triggerFires(trigger, ctx({ now: 5_500 }))).toBe(false);
  });

  it("never fires while the office is busy", () => {
    expect(triggerFires(trigger, ctx({ now: 9_999, officeIdle: false }))).toBe(false);
  });

  it("needs genuine prior history — a fresh office never self-starts", () => {
    expect(triggerFires(trigger, ctx({ precedentsFor: () => [] }))).toBe(false);
  });

  it("ignores an unrelated exec's history", () => {
    const fires = evaluateTriggers([trigger], ctx({
      precedentsFor: (id) =>
        id === "analyst" ? [precedent({ execId: "analyst", label: "KPI Board", ts: 1 })] : [],
    }));
    expect(fires).toHaveLength(0);
  });

  it("evaluateTriggers returns the ready triggers in order", () => {
    expect(evaluateTriggers([trigger], ctx({ now: 6_001 })).map((t) => t.id)).toEqual(["portfolio-review"]);
    expect(evaluateTriggers([trigger], ctx({ now: 5_100 }))).toEqual([]);
  });
});
