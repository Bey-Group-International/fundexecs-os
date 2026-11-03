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

export function canSupportPrice(g: EvidenceGrade): boolean {
  return g === "A" || g === "B";
}

/** True when a claim must be written as "untested" wherever it appears. */
export function mustLabelUntested(g: EvidenceGrade): boolean {
  return g === "U";
}
