// lib/pe/evidence.ts
// Evidence grades — how far a claim can be leaned on. Pure.
//   A  audited, contractual or primary document
//   B  management data with support
//   C  management assertion without support
//   U  untested
// Standing policy: A and B may support a price (B flagged); C and U may appear
// only as a risk or a question, never as a fact. A firm's own scale (root-evidence)
// can tighten this later; these are the labelled defaults.

export const EVIDENCE_GRADES = ["A", "B", "C", "U"] as const;
export type EvidenceGrade = (typeof EVIDENCE_GRADES)[number];

export function isEvidenceGrade(v: unknown): v is EvidenceGrade {
  return typeof v === "string" && (EVIDENCE_GRADES as readonly string[]).includes(v);
}

/** Missing or unknown grade is U — untested — never assumed better. */
export function gradeOf(v: unknown): EvidenceGrade {
  return isEvidenceGrade(v) ? v : "U";
}

/** Which grades may support a price. "U" (untested) is not configurable: it can never support a price. */
export interface EvidencePolicy {
  supportsPrice: { A: boolean; B: boolean; C: boolean };
}

/** Standing default: audited / contractual (A) and supported management data (B) can support a price; C and U cannot. */
export const DEFAULT_EVIDENCE_POLICY: EvidencePolicy = { supportsPrice: { A: true, B: true, C: false } };

export function canSupportPrice(g: EvidenceGrade, policy: EvidencePolicy = DEFAULT_EVIDENCE_POLICY): boolean {
  if (g === "U") return false;
  return policy.supportsPrice[g];
}

export interface EvidencePolicyParse {
  /** The full policy (unset grades take the standing default), or null when no grade was set. */
  policy: EvidencePolicy | null;
  /** True when the input tried to set "U"; it is locked off and the value was ignored. */
  uIgnored: boolean;
}

/** Defensive parse of the stored evidence file or a caller-supplied policy: only booleans for A, B, C are kept. Never throws. */
export function parseEvidencePolicyDetailed(raw: unknown): EvidencePolicyParse {
  const none: EvidencePolicyParse = { policy: null, uIgnored: false };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return none;
  const sp = (raw as Record<string, unknown>).supportsPrice;
  if (!sp || typeof sp !== "object" || Array.isArray(sp)) return none;
  const o = sp as Record<string, unknown>;
  const out = { ...DEFAULT_EVIDENCE_POLICY.supportsPrice };
  let set = 0;
  for (const g of ["A", "B", "C"] as const) {
    if (typeof o[g] === "boolean") {
      out[g] = o[g] as boolean;
      set++;
    }
  }
  const uIgnored = "U" in o;
  return set === 0 ? { policy: null, uIgnored } : { policy: { supportsPrice: out }, uIgnored };
}

export function parseEvidencePolicy(raw: unknown): EvidencePolicy | null {
  return parseEvidencePolicyDetailed(raw).policy;
}

/** True when a claim must be written as "untested" wherever it appears. */
export function mustLabelUntested(g: EvidenceGrade): boolean {
  return g === "U";
}
