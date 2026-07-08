/**
 * FundExecs OS — declarative character sheet.
 *
 * A single typed source of truth for who a floor character *is* — beyond how
 * they look. Where {@link ../office/userAvatar} owns a human's appearance and
 * {@link ../../components/virtual-office/program/officeProgram} owns an
 * executive's institutional wiring (room, accent, idle line), this module owns
 * the *competency* layer shared by both: a small set of base attributes, the
 * traits derived from them, and a private-markets skill taxonomy.
 *
 * Adopting the Roll20 pattern — a declarative schema whose derived values drive
 * behavior and UI — this becomes the spine for skill-based task routing, the
 * on-floor competency read, and (later) reputation/progression. It is
 * intentionally dependency-light: it imports only the `AgentId` / `RoomKey`
 * *types* (erased at build time), so it stays free of the program store's
 * runtime graph and safe to import anywhere.
 *
 * Everything here is pure and deterministic — no React, no renderer, no clock.
 */

import type { AgentId, RoomKey } from "@/components/virtual-office/program/officeProgram";

// ─── Attributes & traits ─────────────────────────────────────────────────────

/** The six base dials, each 0–100. The raw, hand-authored character of a role. */
export type CharacterAttributes = {
  /** Analytical discipline / precision. */
  rigor: number;
  /** Lateral thinking, novel angles. */
  creativity: number;
  /** Willingness to take on / accept risk. */
  riskAppetite: number;
  /** Execution tempo. */
  speed: number;
  /** Thoroughness and follow-through. */
  diligence: number;
  /** Clarity and stakeholder communication. */
  communication: number;
};

/** Traits computed from {@link CharacterAttributes} — never hand-set. */
export type DerivedTraits = {
  /** How readily the character commits. High speed + risk appetite. */
  decisiveness: number;
  /** How exhaustively they work. High rigor + diligence. */
  thoroughness: number;
  /** How fast/less-deliberate they move. Speed, tempered by diligence. */
  tempo: number;
  /** How persuasively they carry a room. Communication + creativity. */
  influence: number;
};

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/**
 * Derive traits from base attributes. Pure and total — the single place the
 * dependency graph between attributes and behavior-facing traits is declared,
 * so the two never drift out of sync across the UI and (future) routing.
 */
export function deriveTraits(a: CharacterAttributes): DerivedTraits {
  return {
    decisiveness: clamp(0.55 * a.speed + 0.45 * a.riskAppetite),
    thoroughness: clamp(0.55 * a.rigor + 0.45 * a.diligence),
    tempo: clamp(0.7 * a.speed + 0.3 * (100 - a.diligence)),
    influence: clamp(0.6 * a.communication + 0.4 * a.creativity),
  };
}

/** The trait keys in display order. */
export const TRAIT_KEYS = ["decisiveness", "thoroughness", "tempo", "influence"] as const;
export type TraitKey = (typeof TRAIT_KEYS)[number];

export const TRAIT_LABELS: Record<TraitKey, string> = {
  decisiveness: "Decisiveness",
  thoroughness: "Thoroughness",
  tempo: "Tempo",
  influence: "Influence",
};

/** A one-line descriptor keyed off the strongest derived trait. */
export function traitDescriptor(a: CharacterAttributes): string {
  const t = deriveTraits(a);
  const top = TRAIT_KEYS.reduce((best, k) => (t[k] > t[best] ? k : best), TRAIT_KEYS[0]);
  switch (top) {
    case "decisiveness": return "Decisive operator";
    case "thoroughness": return "Exacting & thorough";
    case "tempo":        return "High-tempo executor";
    case "influence":    return "Persuasive in the room";
  }
}

// ─── Skills ──────────────────────────────────────────────────────────────────

/** The private-markets skill taxonomy tasks are matched against. */
export const SKILLS = [
  "sourcing",
  "screening",
  "underwriting",
  "modeling",
  "diligence",
  "legal",
  "compliance",
  "ir",
  "treasury",
  "portfolio_ops",
  "negotiation",
  "structuring",
  "reporting",
  "fund_admin",
] as const;

export type Skill = (typeof SKILLS)[number];

export const SKILL_LABELS: Record<Skill, string> = {
  sourcing: "Sourcing",
  screening: "Screening",
  underwriting: "Underwriting",
  modeling: "Modeling",
  diligence: "Diligence",
  legal: "Legal",
  compliance: "Compliance",
  ir: "Investor Relations",
  treasury: "Treasury",
  portfolio_ops: "Portfolio Ops",
  negotiation: "Negotiation",
  structuring: "Structuring",
  reporting: "Reporting",
  fund_admin: "Fund Admin",
};

// ─── Executive profiles ──────────────────────────────────────────────────────

/** The competency slice layered onto each executive's {@link ProgramAgent}. */
export type ExecProfile = {
  /** One-line specialty shown on the inspector. */
  specialty: string;
  /** Skills this executive owns — drives (future) skill-based routing. */
  skills: Skill[];
  /** Hand-authored base attributes. */
  attributes: CharacterAttributes;
};

/**
 * Competency profiles for the eleven executives, keyed by {@link AgentId}. Kept
 * separate from `PROGRAM_AGENTS` (name / role / accent / room) so this module
 * stays runtime-free; a full sheet is assembled by {@link executiveSheet}.
 */
export const EXEC_PROFILES: Record<AgentId, ExecProfile> = {
  earn: {
    specialty: "Routes intent into a gated plan and keeps the floor moving.",
    skills: ["screening", "structuring", "reporting", "negotiation"],
    attributes: { rigor: 72, creativity: 80, riskAppetite: 45, speed: 90, diligence: 76, communication: 88 },
  },
  associate: {
    specialty: "Deal screening and data-room execution.",
    skills: ["sourcing", "screening", "diligence", "modeling"],
    attributes: { rigor: 78, creativity: 60, riskAppetite: 55, speed: 82, diligence: 80, communication: 62 },
  },
  principal: {
    specialty: "Deal review, IC decisions, boardroom judgment.",
    skills: ["screening", "underwriting", "negotiation", "structuring"],
    attributes: { rigor: 82, creativity: 68, riskAppetite: 58, speed: 60, diligence: 78, communication: 80 },
  },
  analyst: {
    specialty: "Valuation, LBO logic, scenarios, IC assumptions.",
    skills: ["modeling", "underwriting", "diligence", "reporting"],
    attributes: { rigor: 92, creativity: 55, riskAppetite: 35, speed: 65, diligence: 90, communication: 55 },
  },
  risk: {
    specialty: "Controls, approvals, and risk gates.",
    skills: ["compliance", "diligence", "legal"],
    attributes: { rigor: 90, creativity: 40, riskAppetite: 15, speed: 55, diligence: 92, communication: 65 },
  },
  legal: {
    specialty: "NDAs, subscription docs, closing papers.",
    skills: ["legal", "compliance", "structuring"],
    attributes: { rigor: 88, creativity: 45, riskAppetite: 25, speed: 58, diligence: 90, communication: 60 },
  },
  investor_relations: {
    specialty: "LP updates and capital-raise communications.",
    skills: ["ir", "reporting", "negotiation"],
    attributes: { rigor: 62, creativity: 72, riskAppetite: 45, speed: 70, diligence: 72, communication: 92 },
  },
  treasury: {
    specialty: "Capital calls, closing mechanics, settlement.",
    skills: ["treasury", "structuring", "reporting"],
    attributes: { rigor: 85, creativity: 42, riskAppetite: 30, speed: 62, diligence: 88, communication: 58 },
  },
  portfolio_ops: {
    specialty: "KPI tracking and post-close operating plans.",
    skills: ["portfolio_ops", "reporting", "diligence"],
    attributes: { rigor: 75, creativity: 65, riskAppetite: 48, speed: 72, diligence: 82, communication: 68 },
  },
  ops_admin: {
    specialty: "Fund administration, reporting, compliance calendar.",
    skills: ["fund_admin", "reporting", "compliance"],
    attributes: { rigor: 80, creativity: 40, riskAppetite: 22, speed: 66, diligence: 90, communication: 60 },
  },
  business_dev: {
    specialty: "Sourcing pipeline and partner map.",
    skills: ["sourcing", "negotiation", "ir"],
    attributes: { rigor: 58, creativity: 82, riskAppetite: 62, speed: 80, diligence: 62, communication: 85 },
  },
};

// ─── Assembled sheet ─────────────────────────────────────────────────────────

export type CharacterKind = "executive" | "user";

/** The full character sheet — appearance-agnostic identity + competency. */
export type CharacterSheet = {
  id: string;
  kind: CharacterKind;
  name: string;
  role: string;
  accent: string;
  homeRoom?: RoomKey;
  specialty: string;
  skills: Skill[];
  attributes: CharacterAttributes;
};

/** The subset of a `ProgramAgent` a sheet needs — passed in to avoid a runtime dep. */
type AgentLike = { id: AgentId; name: string; role: string; accent: string; homeRoom: RoomKey };

/** Assemble a full executive sheet by merging program wiring with its profile. */
export function executiveSheet(agent: AgentLike): CharacterSheet {
  const profile = EXEC_PROFILES[agent.id];
  return {
    id: agent.id,
    kind: "executive",
    name: agent.name,
    role: agent.role,
    accent: agent.accent,
    homeRoom: agent.homeRoom,
    specialty: profile.specialty,
    skills: profile.skills,
    attributes: profile.attributes,
  };
}

// ─── Skill-based routing (foundation for auto-assignment) ─────────────────────

/**
 * The executive whose skills best cover the requested set, with a 0–1 score.
 * Ties break toward the earlier profile. Returns `null` for an empty request.
 * Not yet wired into delegation — this is the matcher a later routing PR uses.
 */
export function matchExecForSkills(
  requested: Skill[],
): { agentId: AgentId; score: number } | null {
  if (requested.length === 0) return null;
  const want = new Set(requested);
  let best: { agentId: AgentId; score: number } | null = null;
  for (const id of Object.keys(EXEC_PROFILES) as AgentId[]) {
    const skills = EXEC_PROFILES[id].skills;
    const hits = skills.reduce((n, s) => (want.has(s) ? n + 1 : n), 0);
    const score = hits / want.size;
    if (score > 0 && (!best || score > best.score)) best = { agentId: id, score };
  }
  return best;
}

// ─── Reputation / level ──────────────────────────────────────────────────────

// Cumulative "shipped" thresholds at which an executive reaches each level.
// A gentle curve so early wins feel rewarding and later levels take real work.
const LEVEL_THRESHOLDS = [0, 1, 3, 6, 10, 15, 22, 30, 40, 55];

/** Reputation standing derived from how many actions an executive has shipped. */
export type Reputation = {
  /** 1-based level. */
  level: number;
  /** Actions shipped within the current level. */
  inLevel: number;
  /** Actions needed to reach the next level (0 at the cap). */
  toNext: number;
};

/**
 * Map a cumulative shipped count to a reputation standing. Pure — callers pass
 * the count (e.g. approved/complete audit events for that actor), so no state
 * lives here. Never throws; clamps at the top of {@link LEVEL_THRESHOLDS}.
 */
export function reputationFromShipped(shipped: number): Reputation {
  const n = Math.max(0, Math.floor(shipped));
  let level = 1;
  for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
    if (n >= LEVEL_THRESHOLDS[i]) level = i + 1;
  }
  const base = LEVEL_THRESHOLDS[level - 1];
  const next = LEVEL_THRESHOLDS[level]; // undefined at the cap
  return {
    level,
    inLevel: n - base,
    toNext: next === undefined ? 0 : next - n,
  };
}
