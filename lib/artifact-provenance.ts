// lib/artifact-provenance.ts
// The trust layer's read model: turn an artifact's persisted provenance into
// the things the UI needs — its citations and a single verification badge —
// without any I/O. Both are pure so they can be unit-tested and reused.

// A grounding citation persisted on an artifact (see migration 0061). Mirrors
// the shape the engine writes from a Brain's retrieved passages.
export interface ArtifactSource {
  source: string;
  snippet: string;
  score: number;
  kind: "document" | "kb";
}

// The verification state shown as a badge. "grounded" is the honest middle
// ground: the output cites real sources but no human has signed it off yet.
export type VerificationLevel = "verified" | "grounded" | "unverified";

export interface VerificationView {
  level: VerificationLevel;
  label: string;
  // Plain-language line explaining what the badge means.
  detail: string;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// Defensively parse the `sources` jsonb into typed citations. Tolerates legacy
// rows (null, non-array, partial objects) by dropping anything unusable.
export function parseSources(raw: unknown): ArtifactSource[] {
  if (!Array.isArray(raw)) return [];
  const out: ArtifactSource[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const source = asString(o.source).trim();
    if (!source) continue;
    out.push({
      source,
      snippet: asString(o.snippet ?? o.text).trim(),
      score: typeof o.score === "number" && Number.isFinite(o.score) ? o.score : 0,
      kind: o.kind === "kb" ? "kb" : "document",
    });
  }
  return out;
}

// The distinct source names a citation list draws on, in first-seen order.
export function citedSourceNames(sources: ArtifactSource[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const s of sources) {
    if (!seen.has(s.source)) {
      seen.add(s.source);
      names.push(s.source);
    }
  }
  return names;
}

// Derive the verification badge from an artifact's status + its citations.
// Human sign-off (verification_status === 'verified') wins; otherwise the
// presence of citations earns "grounded"; nothing → "unverified". When a
// grounding score is known, it sharpens the "grounded" detail line.
export function verificationView(input: {
  verification_status?: string | null;
  sources?: unknown;
  grounding_score?: number | null;
}): VerificationView {
  const sources = parseSources(input.sources);
  if (input.verification_status === "verified") {
    // Operator sign-off is the verification; grounding is a separate dimension.
    // Only claim "grounded in sources" when the artifact actually cites some —
    // an accepted recommendation is signed off but has no retrieved sources.
    const n = citedSourceNames(sources).length;
    return {
      level: "verified",
      label: "Verified",
      detail: n > 0
        ? `Signed off by an operator, grounded in ${n} source${n === 1 ? "" : "s"}.`
        : "Signed off by an operator — no sources cited.",
    };
  }
  if (sources.length > 0) {
    const n = citedSourceNames(sources).length;
    const pct = typeof input.grounding_score === "number" ? ` (${Math.round(input.grounding_score * 100)}% grounded)` : "";
    return {
      level: "grounded",
      label: "Grounded",
      detail: `Cites ${n} source${n === 1 ? "" : "s"}${pct} — awaiting operator sign-off.`,
    };
  }
  return {
    level: "unverified",
    label: "Unverified",
    detail: "No sources cited — treat as a draft until verified.",
  };
}
