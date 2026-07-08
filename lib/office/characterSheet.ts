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

// ─── Skill inference (free-text → skills) ─────────────────────────────────────

/**
 * Lowercase substring cues that signal each skill in a raw task description.
 * Deliberately conservative — a cue only fires when its stem is unambiguous —
 * so classification stays deterministic and explainable. This is the seam that
 * lets "Draft the LP update" or "Reconcile settlement" route themselves without
 * the user naming an executive.
 */
const SKILL_KEYWORDS: Record<Skill, string[]> = {
  sourcing: ["sourc", "pipeline", "partner", "origination", "outreach", "prospect"],
  screening: ["screen", "shortlist", "target profile"],
  underwriting: ["underwrit", "credit"],
  modeling: ["model", "assumption", "sensitivit", "scenario", "valuation", "lbo", "forecast", "comparable"],
  diligence: ["diligence", "review", "data room", "red flag", "validat", "verify", "verifying", "check"],
  legal: ["legal", "nda", "document", "disclosure", "closing", "subscription", "contract", "papers"],
  compliance: ["complian", "control", "risk", "approval", "regulat"],
  ir: ["investor", "lp ", "lp update", "capital raise", "fundrais"],
  treasury: ["treasury", "settlement", "capital call", "wire", "reconcil"],
  portfolio_ops: ["portfolio", "kpi", "dashboard", "operating plan", "post-close"],
  negotiation: ["negotiat", "term sheet", "deal terms"],
  structuring: ["structur", "index", "waterfall"],
  reporting: ["report", "quarterly", "summary", "letter", "pack"],
  fund_admin: ["fund admin", "fund record", "administ", "calendar"],
};

/**
 * Infer the private-markets skills a free-text task calls for. Pure and
 * deterministic: scans for keyword cues and returns matched skills in taxonomy
 * order (so the first element is a stable "primary" skill). Empty when nothing
 * matches — callers treat that as "no confident skill signal".
 */
export function inferSkillsFromText(text: string): Skill[] {
  const t = text.toLowerCase();
  const hits: Skill[] = [];
  for (const skill of SKILLS) {
    if (SKILL_KEYWORDS[skill].some((kw) => t.includes(kw))) hits.push(skill);
  }
  return hits;
}

// ─── Work pantomime (skill → on-floor action) ─────────────────────────────────

/**
 * The visible work action an executive performs while heads-down. A strict
 * subset of the avatar's animation vocabulary — the four *doing-work* poses —
 * so the office program can pick a pantomime without reaching into the renderer.
 */
export type WorkPantomime = "typing" | "reviewing_docs" | "presenting" | "analyzing_model";

/**
 * The pantomime each skill reads as on the floor: modeling/desk work types,
 * document- and control-heavy skills review docs, communication-facing skills
 * present, and KPI/dashboard work analyzes. This is the data that makes a
 * generic "working" agent actually mime its current craft.
 */
export const SKILL_PANTOMIME: Record<Skill, WorkPantomime> = {
  sourcing: "presenting",
  screening: "reviewing_docs",
  underwriting: "typing",
  modeling: "typing",
  diligence: "reviewing_docs",
  legal: "reviewing_docs",
  compliance: "reviewing_docs",
  ir: "presenting",
  treasury: "typing",
  portfolio_ops: "analyzing_model",
  negotiation: "presenting",
  structuring: "typing",
  reporting: "typing",
  fund_admin: "typing",
};

/** The pantomime for a single skill. */
export function pantomimeForSkill(skill: Skill): WorkPantomime {
  return SKILL_PANTOMIME[skill];
}

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

/**
 * The pantomime an executive should mime for its current task. Driven by the
 * work itself: the task text is classified into a skill, and that skill's
 * pantomime is used. When the text carries no confident skill signal, the
 * executive falls back to its own primary skill so its idle-into-work motion
 * still reflects its craft. Total and deterministic.
 */
export function pantomimeForAgent(agentId: AgentId, taskText?: string): WorkPantomime {
  const inferred = taskText ? inferSkillsFromText(taskText) : [];
  const skill = inferred[0] ?? EXEC_PROFILES[agentId].skills[0];
  return pantomimeForSkill(skill);
}

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

/** The outcome of auto-routing a free-text task to its best-matched executive. */
export type AutoRoute = { agentId: AgentId; skills: Skill[]; score: number };

/**
 * Route a raw task to the best-matching executive by inferring its required
 * skills from the text, then matching them against the exec profiles. Returns
 * `null` when the text yields no confident skill — the caller then falls back
 * to an explicit target. Pure: composes {@link inferSkillsFromText} and
 * {@link matchExecForSkills}, so it inherits their determinism.
 */
export function autoRouteTask(text: string): AutoRoute | null {
  const skills = inferSkillsFromText(text);
  const match = matchExecForSkills(skills);
  if (!match) return null;
  return { agentId: match.agentId, skills, score: match.score };
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

// ─── Per-exec memory & precedent recall ──────────────────────────────────────
//
// An executive's institutional memory: a compact, data-driven projection of the
// work it has already shipped. It is intentionally NOT a parallel source of
// truth — the store derives precedents from the existing append-only audit log
// (one per completed deliverable) and feeds them here, so memory can never drift
// from what actually happened on the floor. Everything below is pure: the store
// supplies already-extracted precedents and this module indexes, matches, and
// recalls them deterministically.

/** How a past deliverable resolved. */
export type PrecedentOutcome = "complete" | "rejected";

/**
 * One past deliverable an executive handled — the atom of institutional memory.
 * Derived from a single audit entry; {@link auditEventId} references it so a
 * recalled precedent can always be traced back to the record it came from.
 */
export type Precedent = {
  /** The executive who owned the deliverable. */
  execId: AgentId;
  /** Normalized topic key for matching — see {@link topicKey}. */
  topic: string;
  /** Human-readable deliverable, e.g. "KPI Board". */
  label: string;
  outcome: PrecedentOutcome;
  /** The audit entry this precedent was derived from. */
  auditEventId: string;
  /** When the deliverable completed (audit event timestamp). */
  ts: number;
};

/** Per-exec memory index: precedents grouped by exec, each list newest-first. */
export type ExecMemoryIndex = Partial<Record<AgentId, Precedent[]>>;

// Short, generic deliverable words carry no topic signal on their own.
const TOPIC_STOPWORDS: ReadonlySet<string> = new Set([
  "the", "and", "for", "review", "draft", "output", "pack", "board",
]);

/** Normalize a deliverable/topic string into a stable match key. */
export function topicKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Significant tokens of a topic — lowercase, ≥3 chars, stopwords removed. */
function topicTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !TOPIC_STOPWORDS.has(t)),
  );
}

/**
 * Whether two topics are "about" the same thing. True on an exact normalized
 * match or any shared significant token — so "KPI Board" recalls a prior
 * "KPI Board" and "LP Update Draft" recalls a prior "LP Update".
 */
export function topicsOverlap(a: string, b: string): boolean {
  if (topicKey(a) === topicKey(b) && topicKey(a).length > 0) return true;
  const ta = topicTokens(a);
  for (const t of topicTokens(b)) if (ta.has(t)) return true;
  return false;
}

/** Group a flat precedent list into a per-exec index, each list newest-first. */
export function buildExecMemoryIndex(precedents: Precedent[]): ExecMemoryIndex {
  const index: ExecMemoryIndex = {};
  for (const p of precedents) {
    (index[p.execId] ??= []).push(p);
  }
  for (const id of Object.keys(index) as AgentId[]) {
    index[id]!.sort((a, b) => b.ts - a.ts);
  }
  return index;
}

/** Precedents for one exec from an index — never null. */
export function precedentsFor(index: ExecMemoryIndex, execId: AgentId): Precedent[] {
  return index[execId] ?? [];
}

/**
 * Recall the most relevant prior precedent for a new topic: the most recent
 * completed deliverable whose topic overlaps. Completed precedents win over
 * rejected ones; ties break toward the newer. Returns null when nothing matches.
 */
export function recallPrecedent(precedents: Precedent[], topic: string): Precedent | null {
  let best: Precedent | null = null;
  for (const p of precedents) {
    if (!topicsOverlap(p.topic, topic)) continue;
    if (!best) { best = p; continue; }
    const better =
      (p.outcome === "complete") !== (best.outcome === "complete")
        ? p.outcome === "complete"
        : p.ts > best.ts;
    if (better) best = p;
  }
  return best;
}

// ─── Autonomous triggers (declarative) ───────────────────────────────────────
//
// A declarative way for an executive to initiate an action on its own when a
// condition holds. Conditions are data, not code, and are evaluated purely
// against audit-derived memory (below); the store owns the wiring that turns a
// firing trigger into a real, governed office command.

/**
 * A declarative trigger condition. Discriminated so new conditions can be added
 * without touching the ones already wired.
 *  - recurring_review: the exec last shipped {@link topic} more than
 *    {@link everyMs} ago (or the topic has genuine prior history that is now
 *    stale) — a periodic review has come due.
 */
export type TriggerCondition = {
  kind: "recurring_review";
  /** Topic whose recurrence is tracked, e.g. "KPI Board". */
  topic: string;
  /** How long after the last shipment the review is considered due. */
  everyMs: number;
};

/** An executive's standing intent to self-initiate a command when a condition holds. */
export type AutonomousTrigger = {
  id: string;
  /** The executive that initiates the action. */
  execId: AgentId;
  /** The office command issued when the trigger fires. */
  command: string;
  /** What the executive says when it self-initiates. */
  announce: string;
  condition: TriggerCondition;
};

/** Everything a pure trigger evaluation needs — supplied by the runtime. */
export type TriggerContext = {
  /** Evaluation clock. */
  now: number;
  /** Whether the office is free to accept a proactive task. */
  officeIdle: boolean;
  /** Audit-derived precedents for an exec. */
  precedentsFor: (execId: AgentId) => Precedent[];
};

/**
 * Whether a single trigger fires now. Pure and total. A trigger never fires
 * while the office is busy. A recurring review requires genuine prior history
 * for the exec/topic (so a brand-new office never auto-starts work) and fires
 * only once that history has gone stale past {@link TriggerCondition.everyMs}.
 */
export function triggerFires(t: AutonomousTrigger, ctx: TriggerContext): boolean {
  if (!ctx.officeIdle) return false;
  switch (t.condition.kind) {
    case "recurring_review": {
      const { topic, everyMs } = t.condition;
      const matches = ctx
        .precedentsFor(t.execId)
        .filter((p) => p.outcome === "complete" && topicsOverlap(p.topic, topic));
      if (matches.length === 0) return false; // recurring ⇒ needs prior history
      const latest = matches.reduce((m, p) => (p.ts > m ? p.ts : m), 0);
      return ctx.now - latest >= everyMs;
    }
    default:
      return false;
  }
}

/** The triggers that fire under the given context, in declaration order. */
export function evaluateTriggers(
  triggers: AutonomousTrigger[],
  ctx: TriggerContext,
): AutonomousTrigger[] {
  return triggers.filter((t) => triggerFires(t, ctx));
}
