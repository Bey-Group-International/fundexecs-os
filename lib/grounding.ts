// lib/grounding.ts
// The automated half of "verified": a deterministic grounding score for a
// composer output. It measures how much of the cited evidence the output
// actually reflects — high when the deliverable draws on the passages the Brain
// retrieved, low when the text and its sources don't overlap. Pure and
// dependency-free so it runs at execution time and in tests identically.

import type { ArtifactSource } from "@/lib/artifact-provenance";

// Short, ubiquitous words carry no grounding signal — drop them so the score
// reflects substantive overlap, not shared filler.
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "at",
  "by", "from", "as", "is", "are", "was", "were", "be", "been", "it", "its",
  "this", "that", "these", "those", "we", "you", "they", "will", "has", "have",
]);

// Lowercase, split on non-alphanumerics, drop stopwords and 1–2 char tokens.
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

// At or above this, an output is considered grounded enough to be "verifiable"
// without a human sign-off (used by the external gate). Deliberately modest:
// cited snippets are short, so even a well-grounded memo only echoes a fraction.
export const GROUNDING_THRESHOLD = 0.25;

/**
 * Score in [0,1]: of the salient tokens across an output's cited sources, what
 * fraction also appears in the output itself. Rewards deliverables that visibly
 * use their evidence. Returns 0 when there are no usable sources.
 */
export function computeGroundingScore(content: string, sources: ArtifactSource[]): number {
  if (!sources.length) return 0;

  const sourceTokens = new Set<string>();
  for (const s of sources) {
    for (const t of tokenize(s.snippet)) sourceTokens.add(t);
  }
  if (sourceTokens.size === 0) return 0;

  const contentTokens = new Set(tokenize(content));
  let overlap = 0;
  for (const t of sourceTokens) {
    if (contentTokens.has(t)) overlap += 1;
  }

  const score = overlap / sourceTokens.size;
  return Math.max(0, Math.min(1, score));
}

// Whether an artifact may leave the building without a fresh human sign-off:
// either an operator already verified it, or it is automatically well-grounded.
export function isVerifiable(input: {
  verification_status?: string | null;
  grounding_score?: number | null;
}): boolean {
  if (input.verification_status === "verified") return true;
  return (input.grounding_score ?? 0) >= GROUNDING_THRESHOLD;
}
