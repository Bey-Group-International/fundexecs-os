// lib/engine-critic.ts
// The automated critic — a pre-screen the engine runs on every AI deliverable
// before it reaches the human approval gate. This is the "critic / verifier"
// pattern from the agent-orchestration literature (awesome-agent-orchestrators)
// made native: alongside the grounding score (lib/grounding.ts, "does the output
// use its evidence?") the critic asks the complementary question — "is this
// deliverable actually a usable answer, or a refusal / stub / off-topic drift?"
//
// The core is PURE and deterministic (no DB, no key) so it runs inline at
// execution time with zero added latency or spend and is fully unit-testable. A
// Claude-backed deep critique is available behind `critique()` for callers that
// want a richer pass, but the engine hot path uses the deterministic scorer.
import { tokenize } from "@/lib/grounding";

export type CriticVerdict = "pass" | "revise" | "fail";

export interface CritiqueSource {
  snippet: string;
}

export interface CritiqueInput {
  content: string;
  title: string;
  description?: string | null;
  sources?: CritiqueSource[];
}

export interface CritiqueResult {
  verdict: CriticVerdict;
  /** 0–100 quality score; verdict is derived from it. */
  score: number;
  /** Human-readable problems found, worst-first. Empty when clean. */
  issues: string[];
}

// Phrases that signal the model punted instead of answering.
const REFUSAL_MARKERS = [
  "i cannot", "i can't", "i am unable", "i'm unable", "as an ai", "as a language model",
  "i do not have access", "i don't have access", "cannot provide", "unable to provide",
  "i'm sorry, but", "i am sorry, but",
];

// Leftover scaffolding that means the deliverable isn't finished.
const PLACEHOLDER_MARKERS = ["lorem ipsum", "[insert", "todo", "tbd", "xxxx", "placeholder", "<name>", "<company>"];

// Softer hedges — not disqualifying, but worth flagging.
const HEDGE_MARKERS = ["insufficient information", "not enough information", "cannot determine", "i'm not sure"];

const includesAny = (haystack: string, needles: string[]): boolean => needles.some((n) => haystack.includes(n));

// The coverage threshold: below this fraction of the task's salient words
// appearing in the output, the deliverable reads as off-topic. Deliberately
// modest — a good memo paraphrases rather than echoing the prompt.
const COVERAGE_FLOOR = 0.25;

// Verdict cutoffs over the 0–100 score.
const PASS_AT = 70;
const FAIL_BELOW = 40;

function verdictFor(score: number): CriticVerdict {
  if (score >= PASS_AT) return "pass";
  if (score < FAIL_BELOW) return "fail";
  return "revise";
}

/**
 * Deterministically critique a deliverable. Starts from a clean 100 and deducts
 * for the failure modes an operator would reject on sight: emptiness, refusals,
 * placeholder stubs, hedging, going off the task, and (mildly) citing nothing.
 * Pure — no I/O.
 */
export function critiqueArtifact(input: CritiqueInput): CritiqueResult {
  const content = (input.content ?? "").trim();
  const lower = content.toLowerCase();
  const issues: string[] = [];
  let score = 100;

  if (content.length < 40) {
    issues.push("Deliverable is too short to be a usable answer");
    score -= 60;
  }
  if (includesAny(lower, REFUSAL_MARKERS)) {
    issues.push("Reads as a refusal or non-answer");
    score -= 50;
  }
  if (includesAny(lower, PLACEHOLDER_MARKERS)) {
    issues.push("Contains placeholder / unfinished scaffolding");
    score -= 40;
  }
  if (includesAny(lower, HEDGE_MARKERS)) {
    issues.push("Hedges on insufficient information");
    score -= 20;
  }

  // Topical coverage: how much of the task's salient vocabulary the output
  // actually engages with. Skipped for very short tasks with no salient tokens.
  const taskTokens = new Set(tokenize(`${input.title} ${input.description ?? ""}`));
  if (taskTokens.size > 0 && content.length >= 40) {
    const contentTokens = new Set(tokenize(content));
    let covered = 0;
    for (const t of taskTokens) if (contentTokens.has(t)) covered += 1;
    const coverage = covered / taskTokens.size;
    if (coverage < COVERAGE_FLOOR) {
      issues.push(`Does not visibly address the task: "${input.title}"`);
      score -= 20;
    }
  }

  if (!input.sources || input.sources.length === 0) {
    issues.push("No cited sources");
    score -= 10;
  }

  score = Math.max(0, Math.min(100, score));
  return { verdict: verdictFor(score), score, issues };
}

export const __test = { verdictFor, REFUSAL_MARKERS, PLACEHOLDER_MARKERS, COVERAGE_FLOOR };
