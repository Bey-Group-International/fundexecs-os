// lib/pe-frameworks.ts
// Institutional deliverable frameworks — the structure and standards a partner
// expects behind each kind of AI-generated deliverable. This is the native home
// for the "PE analysis + IR" playbook content: rather than leaving the task
// engine's per-step generation prompt name-only, we inject a typed section
// skeleton and a short list of first-principles for the heavy institutional
// deliverables (IC memo, LP update, diligence/risk memo, financial model).
//
// Clean-room: the frameworks are written from how these documents are actually
// structured and reviewed in private markets — not copied from any source.
//
// Pure module: no React, no DB, no I/O. It also owns `classifyArtifact` (the
// deterministic step → artifact-type mapping) so both the engine (for
// persistence/badging) and the generation layer (for framework selection) read
// from one source of truth.
import type { AgentKey, ArtifactType } from "@/lib/supabase/database.types";

/**
 * Classify a step's deliverable into a first-class artifact type from the
 * authoring agent and the step title. Deterministic so it holds in fallback
 * mode (no API key) too. Coarse on purpose — enough to route, badge, and pick a
 * deliverable framework.
 */
export function classifyArtifact(agent: AgentKey, stepTitle: string): ArtifactType {
  const t = stepTitle.toLowerCase();
  const has = (...w: string[]) => w.some((x) => t.includes(x));
  if (has("ic memo", "ic ", "recommend", "committee")) return "ic_memo";
  if (has("model", "lbo", "dcf", "underwrit", "pro forma", "valuation", "sensitivit"))
    return "model";
  if (has("risk", "flag", "diligence", "red flag")) return "risk_report";
  if (has("summar", "recap", "synthes")) return "summary";
  switch (agent) {
    case "analyst":
      return "analysis";
    case "diligence":
      return "risk_report";
    case "investor_relations":
      return "lp_update";
    case "fund_admin":
    case "portfolio_ops":
    case "associate":
    default:
      return "memo";
  }
}

/** One section of a deliverable's institutional structure. */
export interface FrameworkSection {
  heading: string;
  guidance: string;
}

/** A named, structured framework for a kind of institutional deliverable. */
export interface DeliverableFramework {
  artifactType: ArtifactType;
  label: string;
  /** The ordered section skeleton the deliverable should follow. */
  sections: FrameworkSection[];
  /** Cross-cutting standards that separate a partner-grade draft from a rough one. */
  principles: string[];
}

// ── The frameworks ───────────────────────────────────────────────────────────
// Only the heavy institutional deliverables carry a framework. Lightweight
// artifact types (memo / summary / analysis / other) intentionally have none,
// so short outputs are never over-structured.

const IC_MEMO: DeliverableFramework = {
  artifactType: "ic_memo",
  label: "Investment Committee memo",
  sections: [
    { heading: "Recommendation", guidance: "The ask, the amount, and your call (invest / pass / conditional) — up front." },
    { heading: "Opportunity overview", guidance: "The company or asset, what it does, and why it is buyable now." },
    { heading: "Market & thesis", guidance: "Market size and dynamics, and the specific thesis for outperformance." },
    { heading: "Deal structure & terms", guidance: "Entry price / multiple, sources & uses, ownership, and leverage." },
    { heading: "Returns", guidance: "Base, downside, and upside cases with IRR and MOIC, and the value drivers behind them." },
    { heading: "Diligence findings", guidance: "What is confirmed, what is open, and the status of each workstream." },
    { heading: "Key risks & mitigants", guidance: "The top three to five risks, ranked, each with a mitigant and the residual exposure." },
    { heading: "Value-creation plan", guidance: "The 100-day plan and the levers that drive the returns above." },
    { heading: "Exit", guidance: "Routes, timing, and comparable exits." },
    { heading: "Recommendation & conditions", guidance: "Restate the call, with any closing conditions." },
  ],
  principles: [
    "Lead with the recommendation and the number — an IC reads the first paragraph and the returns table first.",
    "Put a number in every section; unquantified claims read as hope.",
    "State the bear case honestly — the strongest memo pre-empts the committee's toughest question.",
    "Rank the risks, and give each a mitigant and a residual exposure.",
  ],
};

const LP_UPDATE: DeliverableFramework = {
  artifactType: "lp_update",
  label: "quarterly LP update",
  sections: [
    { heading: "Headline", guidance: "One paragraph on the state of the fund this quarter." },
    { heading: "Performance", guidance: "TVPI, DPI, RVPI and net IRR versus last quarter, and what drove the change." },
    { heading: "Portfolio", guidance: "Top movers up and down, each with the reason." },
    { heading: "Capital activity", guidance: "Calls and distributions this quarter, and remaining dry powder." },
    { heading: "New investments & realizations", guidance: "What was added or exited, with entry / exit context." },
    { heading: "Team & operations", guidance: "Hires, changes, and operational notes." },
    { heading: "Outlook & asks", guidance: "What is ahead, and anything you need from LPs." },
  ],
  principles: [
    "Write it to be read in five minutes — the discipline is in the editing, not the length.",
    "Lead each section with the number, then the narrative.",
    "Surface concerns before an LP has to ask — transparency compounds into trust.",
    "Keep the format identical quarter over quarter so LPs can diff it at a glance.",
  ],
};

const RISK_REPORT: DeliverableFramework = {
  artifactType: "risk_report",
  label: "diligence / risk memo",
  sections: [
    { heading: "Summary judgment", guidance: "Go / conditional / no-go, and the single biggest risk." },
    { heading: "Risk register", guidance: "Each risk categorized (market, commercial, financial, operational, legal / regulatory, ESG) and rated by likelihood × impact." },
    { heading: "Mitigants & residual", guidance: "For each material risk, the mitigant and the exposure that remains." },
    { heading: "Open items", guidance: "Unresolved diligence workstreams and what would close them." },
    { heading: "Deal-breakers", guidance: "Anything that, left unresolved, kills the deal." },
  ],
  principles: [
    "Lead with the judgment and the one risk that matters most.",
    "Rate every risk on likelihood and impact — an unrated register is just a list.",
    "Separate residual risk from raw risk; the mitigated picture is what the committee decides on.",
    "Name deal-breakers explicitly — ambiguity here costs the most.",
  ],
};

const MODEL: DeliverableFramework = {
  artifactType: "model",
  label: "financial model",
  sections: [
    { heading: "Assumptions", guidance: "Every key input stated explicitly — entry multiple, growth, margins, leverage, exit." },
    { heading: "Outputs", guidance: "The headline returns (IRR, MOIC) and the value bridge." },
    { heading: "Sensitivity", guidance: "How returns move with the two or three variables that matter most." },
    { heading: "Sources", guidance: "Where each material assumption comes from — diligence, comps, or management." },
  ],
  principles: [
    "State every assumption; a model whose inputs are hidden cannot be trusted or challenged.",
    "Show the sensitivity — a single point estimate hides the risk.",
    "Tie each assumption to a source so it is defensible.",
  ],
};

const FRAMEWORKS: Partial<Record<ArtifactType, DeliverableFramework>> = {
  ic_memo: IC_MEMO,
  lp_update: LP_UPDATE,
  risk_report: RISK_REPORT,
  model: MODEL,
};

/** The framework for an artifact type, or null when the type carries none. */
export function frameworkFor(artifactType: ArtifactType): DeliverableFramework | null {
  return FRAMEWORKS[artifactType] ?? null;
}

/**
 * Render the framework for an artifact type into a system-prompt fragment the
 * generation layer can append. Returns null when the type has no framework, so
 * callers leave the base prompt untouched for lightweight deliverables.
 */
export function frameworkPromptFor(artifactType: ArtifactType): string | null {
  const fw = frameworkFor(artifactType);
  if (!fw) return null;

  const sections = fw.sections
    .map((s, i) => `${i + 1}. ${s.heading} — ${s.guidance}`)
    .join("\n");
  const principles = fw.principles.map((p) => `- ${p}`).join("\n");

  return (
    `\n\nThis deliverable is a ${fw.label}. Follow this institutional structure, ` +
    `adapting to the facts available and omitting a section only when there is genuinely nothing to say:\n` +
    `${sections}\n\nHold to these standards:\n${principles}`
  );
}

/** Artifact types that carry a framework — exported for tests and callers. */
export function frameworkArtifactTypes(): ArtifactType[] {
  return Object.keys(FRAMEWORKS) as ArtifactType[];
}
