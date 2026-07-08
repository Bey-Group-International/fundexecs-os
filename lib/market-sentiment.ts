// lib/market-sentiment.ts
// A deterministic, finance-tuned sentiment scorer + a bridge that turns news
// headlines into Source-hub "news" signals. This is the FundExecs-native
// distillation of the SentiVest / ai-investor idea — score the tone of what's
// being written about an entity — but built as PURE, keyless lexicon scoring so
// it runs in CI and feeds the existing signals engine (lib/sourcing-signals.ts)
// rather than standing up a separate ML service.
//
// The output plugs straight into the signals catalog: a bundle of headlines
// becomes one `news` EntitySignalInput whose strength reflects how strongly (and
// in which direction) the coverage leans. A real NLP model can replace the
// scorer behind the same `scoreSentiment` seam later.
import type { EntitySignalInput } from "@/lib/sourcing-signals";
import type { EntityKind } from "@/lib/sourcing-intel";

// Finance-leaning polarity lexicon. Weights are small integers; the score is
// normalized by token count so long text isn't automatically "more" positive.
const POSITIVE: Record<string, number> = {
  growth: 2, surge: 2, surged: 2, soar: 2, soared: 2, record: 2, profit: 2,
  profitable: 2, beat: 2, beats: 2, upgrade: 2, upgraded: 2, expansion: 2,
  expanding: 1, strong: 2, robust: 2, gain: 1, gains: 1, rally: 2, outperform: 2,
  raises: 1, raised: 1, funding: 1, acquires: 1, acquisition: 1, partnership: 1,
  launch: 1, launches: 1, milestone: 1, wins: 2, awarded: 1, momentum: 1,
  bullish: 2, rebound: 2, recovery: 1, dividend: 1, upside: 2, breakthrough: 2,
};

const NEGATIVE: Record<string, number> = {
  loss: 2, losses: 2, decline: 2, declined: 2, drop: 2, dropped: 2, plunge: 2,
  plunged: 2, slump: 2, downgrade: 2, downgraded: 2, weak: 2, miss: 2, misses: 2,
  lawsuit: 2, probe: 2, investigation: 2, layoff: 2, layoffs: 2, cuts: 1,
  bankruptcy: 3, insolvency: 3, default: 3, fraud: 3, scandal: 3, warning: 1,
  bearish: 2, selloff: 2, shortfall: 2, headwind: 1, headwinds: 1, delay: 1,
  delays: 1, recall: 2, breach: 2, resign: 1, resigned: 1, downturn: 2, slowdown: 2,
};

// Words that flip the polarity of the next scored term within a short window.
const NEGATORS = new Set(["not", "no", "never", "without", "avoids", "avoided", "fails", "failed"]);

export interface SentimentResult {
  /** Net polarity in [-1, 1] — negative bearish, positive bullish. */
  score: number;
  /** Total polarity mass (|weights|), a confidence proxy. */
  magnitude: number;
  positiveHits: string[];
  negativeHits: string[];
}

export type SentimentLabel = "positive" | "neutral" | "negative";

// Lowercase word tokens, keeping order (negation needs adjacency). Pure.
function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Score the sentiment of a block of text (one or many headlines joined). A
 * negator immediately before a polarity word flips that word's sign. Score is
 * the net signed weight squashed into [-1, 1]; magnitude is the total mass.
 * Deterministic and dependency-free. Pure.
 */
export function scoreSentiment(text: string): SentimentResult {
  const toks = words(text);
  let net = 0;
  let mass = 0;
  const positiveHits: string[] = [];
  const negativeHits: string[] = [];

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const base = POSITIVE[t] ?? -(NEGATIVE[t] ?? 0);
    if (base === 0) continue;
    const negated = i > 0 && NEGATORS.has(toks[i - 1]);
    const signed = negated ? -base : base;
    net += signed;
    mass += Math.abs(base);
    if (signed > 0) positiveHits.push(t);
    else negativeHits.push(t);
  }

  // Squash net weight into [-1,1]; ~3 net points reaches near-saturation.
  const score = mass === 0 ? 0 : Math.max(-1, Math.min(1, net / (Math.abs(net) + 3)));
  return { score, magnitude: mass, positiveHits, negativeHits };
}

// Bucket a score into a label. The neutral band is deliberately wide so weak,
// mixed coverage doesn't read as a directional signal. Pure.
export function sentimentLabel(score: number): SentimentLabel {
  if (score >= 0.2) return "positive";
  if (score <= -0.2) return "negative";
  return "neutral";
}

// Map a signed sentiment score to a 0–100 signal strength (magnitude of tone,
// direction-agnostic — the news signal carries "how loud", the summary carries
// "which way"). Pure.
export function sentimentToStrength(score: number): number {
  return Math.round(Math.max(0, Math.min(1, Math.abs(score))) * 100);
}

/**
 * Turn a set of headlines about an entity into a single `news` signal ready for
 * lib/sourcing-signals.recordSignals. Returns null when the coverage is empty
 * or entirely neutral (nothing worth recording). Pure — no DB, no key.
 */
export function buildNewsSignal(
  entity: { entityId?: string | null; subjectName: string; kind?: EntityKind | null },
  headlines: string[],
  opts: { sourceUrl?: string | null; occurredAt?: string | null } = {},
): EntitySignalInput | null {
  const clean = headlines.map((h) => h.trim()).filter(Boolean);
  if (clean.length === 0) return null;

  const sentiment = scoreSentiment(clean.join(". "));
  const label = sentimentLabel(sentiment.score);
  if (label === "neutral" && sentiment.magnitude === 0) return null;

  const strength = sentimentToStrength(sentiment.score);
  const lean = label === "positive" ? "positive" : label === "negative" ? "negative" : "mixed";
  const summary = `${clean.length} recent ${clean.length === 1 ? "headline" : "headlines"} — ${lean} tone`;

  return {
    entityId: entity.entityId ?? null,
    subjectName: entity.subjectName,
    kind: entity.kind ?? null,
    signalType: "news",
    strength,
    summary,
    sourceUrl: opts.sourceUrl ?? null,
    occurredAt: opts.occurredAt ?? null,
    metadata: {
      sentiment: Number(sentiment.score.toFixed(3)),
      label,
      positiveHits: sentiment.positiveHits.slice(0, 8),
      negativeHits: sentiment.negativeHits.slice(0, 8),
    },
  };
}
