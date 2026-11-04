// lib/pe/dd-issues.ts
// Shared engine for due-diligence ISSUES LISTS (legal, tax, technology). Pure.
//   * every issue cites a document; one that does not is kept but graded U (untested) and listed;
//   * duplicates merge to the worst rating and the weakest evidence;
//   * an exposure range is kept only with a stated basis, and low <= high;
//   * expected-document gaps are the expected list minus what was received — never guessed;
//   * red/amber issues with an impact can be handed to the red flag register.
// Nothing here rates an issue the caller did not rate: ratings, ranges and questions are inputs.

import { gradeOf, type EvidenceGrade } from "@/lib/pe/evidence";
import type { JsonSchema } from "@/lib/skills/types";

export type Rating = "red" | "amber" | "green";
export const RATINGS: Rating[] = ["red", "amber", "green"];
const RATING_ORDER: Record<Rating, number> = { red: 0, amber: 1, green: 2 };
const GRADE_RANK: Record<EvidenceGrade, number> = { A: 0, B: 1, C: 2, U: 3 };

export type RegisterImpact =
  | "walk-away"
  | "price"
  | "structure"
  | "spa-protection"
  | "100-day";
const IMPACTS: RegisterImpact[] = [
  "walk-away",
  "price",
  "structure",
  "spa-protection",
  "100-day",
];

export interface IssueIn {
  title: string;
  rating: Rating;
  category?: string;
  /** Where the issue arises (a country or tax jurisdiction); part of the de-duplication key. */
  jurisdiction?: string;
  /** The period it concerns (a tax year, say); part of the de-duplication key. */
  period?: string;
  documentRef?: string;
  clauseRef?: string;
  evidenceGrade?: EvidenceGrade;
  /** How this bears on the decision; needed to hand the issue to the red flag register. */
  impact?: RegisterImpact;
  /** What the specialist adviser should be asked. */
  question?: string;
  owner?: string;
  rangeLow?: number;
  rangeHigh?: number;
  rangeBasis?: string;
  /** Set by a skill's own rules, not by the caller. */
  derived?: boolean;
}

export interface IssueOut {
  rank: number;
  title: string;
  rating: Rating;
  category: string;
  jurisdiction: string | null;
  period: string | null;
  documentRef: string | null;
  clauseRef: string | null;
  evidenceGrade: EvidenceGrade;
  cited: boolean;
  derived: boolean;
  impact: RegisterImpact | null;
  question: string | null;
  owner: string | null;
  range: { low: number; high: number; basis: string } | null;
  notes: string[];
}

export interface RankResult {
  issues: IssueOut[];
  duplicatesMerged: number;
  /** Titles of issues that cite no document (or no clause where one is required). */
  uncited: string[];
  /** Titles whose exposure range was dropped, with why. */
  rangesDropped: string[];
  counts: Record<Rating, number>;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const clean = (s: string | undefined) =>
  typeof s === "string" && s.trim() ? s.trim() : null;
const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

interface Work {
  title: string;
  rating: Rating;
  category: string;
  jurisdiction: string | null;
  period: string | null;
  docs: Set<string>;
  clauses: Set<string>;
  grade: EvidenceGrade;
  derived: boolean;
  impact: RegisterImpact | null;
  question: string | null;
  owner: string | null;
  range: { low?: number; high?: number; basis: string | null };
  notes: string[];
}

export function rankIssues(
  input: IssueIn[],
  opts: { requireClause?: boolean; defaultCategory?: string } = {},
): RankResult {
  const fallbackCategory = opts.defaultCategory ?? "other";
  const merged = new Map<string, Work>();
  let total = 0;
  for (const raw of input ?? []) {
    const title = clean(raw?.title);
    if (!title) continue;
    total++;
    const notes: string[] = [];
    let rating = raw.rating;
    if (!RATINGS.includes(rating)) {
      rating = "amber";
      notes.push(
        "No valid rating was given; shown as amber until the adviser rates it.",
      );
    }
    const category = clean(raw.category) ?? fallbackCategory;
    const jurisdiction = clean(raw.jurisdiction);
    const period = clean(raw.period);
    const key = `${norm(category)}|${norm(jurisdiction ?? "")}|${norm(period ?? "")}|${norm(title)}`;
    const doc = clean(raw.documentRef);
    const clause = clean(raw.clauseRef);
    const grade = gradeOf(raw.evidenceGrade);
    const impact = IMPACTS.includes(raw.impact as RegisterImpact)
      ? (raw.impact as RegisterImpact)
      : null;
    const cur = merged.get(key);
    if (!cur) {
      merged.set(key, {
        title,
        rating,
        category,
        jurisdiction,
        period,
        docs: new Set(doc ? [doc] : []),
        clauses: new Set(clause ? [clause] : []),
        grade,
        derived: !!raw.derived,
        impact,
        question: clean(raw.question),
        owner: clean(raw.owner),
        range: {
          low: isNum(raw.rangeLow) ? raw.rangeLow : undefined,
          high: isNum(raw.rangeHigh) ? raw.rangeHigh : undefined,
          basis: clean(raw.rangeBasis),
        },
        notes,
      });
      continue;
    }
    if (RATING_ORDER[rating] < RATING_ORDER[cur.rating]) cur.rating = rating;
    if (GRADE_RANK[grade] > GRADE_RANK[cur.grade]) cur.grade = grade;
    if (doc) cur.docs.add(doc);
    if (clause) cur.clauses.add(clause);
    cur.derived = cur.derived && !!raw.derived;
    if (
      impact &&
      (!cur.impact || IMPACTS.indexOf(impact) < IMPACTS.indexOf(cur.impact))
    )
      cur.impact = impact;
    cur.question = cur.question ?? clean(raw.question);
    cur.owner = cur.owner ?? clean(raw.owner);
    if (cur.range.basis === null && clean(raw.rangeBasis))
      cur.range = {
        low: isNum(raw.rangeLow) ? raw.rangeLow : undefined,
        high: isNum(raw.rangeHigh) ? raw.rangeHigh : undefined,
        basis: clean(raw.rangeBasis),
      };
    cur.notes.push(...notes);
  }

  const uncited: string[] = [];
  const rangesDropped: string[] = [];
  const out: Omit<IssueOut, "rank">[] = [...merged.values()].map((w) => {
    const documentRef = w.docs.size ? [...w.docs].join("; ") : null;
    const clauseRef = w.clauses.size ? [...w.clauses].join("; ") : null;
    const cited =
      documentRef !== null && (!opts.requireClause || clauseRef !== null);
    let grade = w.grade;
    if (!cited) {
      uncited.push(w.title);
      if (grade !== "U")
        w.notes.push(
          `Evidence grade ${grade} lowered to U: ${documentRef === null ? "no document is cited" : "no clause is cited"}.`,
        );
      grade = "U";
    }
    let range: IssueOut["range"] = null;
    const { low, high, basis } = w.range;
    if (low !== undefined || high !== undefined || basis !== null) {
      if (low === undefined || high === undefined) {
        rangesDropped.push(w.title);
        w.notes.push("Exposure range ignored: it needs both a low and a high.");
      } else if (basis === null) {
        rangesDropped.push(w.title);
        w.notes.push(
          "Exposure range ignored: no basis is stated, and a range without a basis is not given.",
        );
      } else if (low < 0 || high < low) {
        rangesDropped.push(w.title);
        w.notes.push(
          "Exposure range ignored: it must be non-negative with low not above high.",
        );
      } else {
        range = { low, high, basis };
      }
    }
    return {
      title: w.title,
      rating: w.rating,
      category: w.category,
      jurisdiction: w.jurisdiction,
      period: w.period,
      documentRef,
      clauseRef,
      evidenceGrade: grade,
      cited,
      derived: w.derived,
      impact: w.impact,
      question: w.question,
      owner: w.owner,
      range,
      notes: w.notes,
    };
  });

  out.sort(
    (a, b) =>
      RATING_ORDER[a.rating] - RATING_ORDER[b.rating] ||
      GRADE_RANK[a.evidenceGrade] - GRADE_RANK[b.evidenceGrade] ||
      a.category.localeCompare(b.category) ||
      a.title.localeCompare(b.title),
  );
  const issues: IssueOut[] = out.map((o, i) => ({ rank: i + 1, ...o }));
  const counts: Record<Rating, number> = { red: 0, amber: 0, green: 0 };
  for (const i of issues) counts[i.rating]++;
  return {
    issues,
    duplicatesMerged: total - merged.size,
    uncited,
    rangesDropped,
    counts,
  };
}

/** Expected documents the caller has not received. Matching is by containment on normalised names. */
export function documentGaps(
  expected: string[],
  received: string[] | undefined,
): string[] {
  const have = (received ?? []).map(norm).filter(Boolean);
  return expected.filter((e) => {
    const n = norm(e);
    return !have.some((h) => h.includes(n) || n.includes(h));
  });
}

export interface RedFlagHandoff {
  title: string;
  workstream: string;
  severity: "red" | "amber";
  impact: RegisterImpact;
  evidenceGrade: EvidenceGrade;
  sourceRef?: string;
}

/** Red and amber issues that carry an impact, in the shape the red flag register takes. Others are counted, not guessed. */
export function toRedFlagHandoff(
  issues: IssueOut[],
  workstream: string,
): { findings: RedFlagHandoff[]; needingImpact: string[] } {
  const findings: RedFlagHandoff[] = [];
  const needingImpact: string[] = [];
  for (const i of issues) {
    if (i.rating === "green") continue;
    if (!i.impact) {
      needingImpact.push(i.title);
      continue;
    }
    const sourceRef = [i.documentRef, i.clauseRef].filter(Boolean).join(", ");
    findings.push({
      title: i.title,
      workstream,
      severity: i.rating,
      impact: i.impact,
      evidenceGrade: i.evidenceGrade,
      ...(sourceRef ? { sourceRef } : {}),
    });
  }
  return { findings, needingImpact };
}

export const issueInSchema: JsonSchema = {
  type: "object",
  required: ["title", "rating"],
  properties: {
    title: { type: "string" },
    rating: { type: "string", enum: ["red", "amber", "green"] },
    category: { type: "string" },
    jurisdiction: { type: "string" },
    period: { type: "string" },
    documentRef: { type: "string" },
    clauseRef: { type: "string" },
    evidenceGrade: { type: "string", enum: ["A", "B", "C", "U"] },
    impact: {
      type: "string",
      enum: ["walk-away", "price", "structure", "spa-protection", "100-day"],
    },
    question: { type: "string" },
    owner: { type: "string" },
    rangeLow: { type: "number", minimum: 0 },
    rangeHigh: { type: "number", minimum: 0 },
    rangeBasis: { type: "string" },
  },
};

export type RetentionRisk = "low" | "medium" | "high" | "unknown";

export interface KeyPersonIn {
  role: string;
  retentionRisk?: RetentionRisk;
  knowledgeDocumented?: boolean;
  documentRef?: string;
}

/**
 * The issue a key person raises, by a stated rule: high retention risk with undocumented knowledge is red,
 * high risk otherwise is amber, an unconfirmed retention risk is amber and graded U, low or medium raises nothing.
 */
export function keyPersonIssue(
  p: KeyPersonIn,
  category: string,
): IssueIn | null {
  const role = clean(p?.role);
  if (!role) return null;
  const risk = p.retentionRisk ?? "unknown";
  const doc = clean(p.documentRef) ?? undefined;
  if (risk === "high") {
    const undocumented = p.knowledgeDocumented === false;
    const knowledge = undocumented
      ? "knowledge not documented"
      : p.knowledgeDocumented === true
        ? "knowledge documented"
        : "documentation not confirmed";
    return {
      title: `Key person dependency: ${role} (retention risk high; ${knowledge})`,
      rating: undocumented ? "red" : "amber",
      category,
      documentRef: doc,
      evidenceGrade: doc ? "B" : "U",
      question:
        "What retention terms are in place, and who else can run this if they leave?",
      derived: true,
    };
  }
  if (risk === "unknown") {
    return {
      title: `Retention risk unconfirmed: ${role}`,
      rating: "amber",
      category,
      documentRef: doc,
      evidenceGrade: "U",
      question:
        "Is this person staying post-deal? Agree retention terms before signing.",
      derived: true,
    };
  }
  return null;
}
