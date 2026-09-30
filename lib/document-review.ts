// lib/document-review.ts
//
// Earn's first read of an uploaded document, the part that needs no model:
// which data-room section it belongs in, the mechanical problems an LP would
// notice first, and sensible defaults for sharing it.
//
// Pure and deterministic, so it runs in tests, when no API key is configured,
// and as a floor under the model's review — the placeholder an associate left
// in the LPA is a blocker whether or not Claude happens to mention it.
import { DATA_ROOM_SECTIONS } from "@/lib/data-room";
import type { DocumentReviewRecommendation } from "@/lib/supabase/database.types";

const SECTION_KEYS = new Set(DATA_ROOM_SECTIONS.map((s) => s.key));

// Phrases that identify a document's kind, strongest first. Matched against the
// filename (weighted) and the opening of the text.
const SECTION_SIGNALS: Record<string, string[]> = {
  fund_terms: ["limited partnership agreement", "lpa", "private placement memorandum", "ppm", "subscription agreement", "side letter", "term sheet", "fee schedule", "management fee", "carried interest"],
  financials: ["audited financial", "financial statements", "balance sheet", "income statement", "statement of operations", "cash flow", "nav statement", "capital account", "k-1", "schedule of investments"],
  track_record: ["track record", "irr", "moic", "dpi", "tvpi", "realized", "attribution", "performance"],
  marketing: ["pitch deck", "pitchbook", "investor presentation", "teaser", "one pager", "one-pager", "fundraising deck", "tearsheet"],
  diligence: ["ddq", "due diligence questionnaire", "ilpa", "questionnaire"],
  compliance: ["form adv", "adv part", "compliance manual", "code of ethics", "aml", "kyc", "policies and procedures"],
  legal: ["certificate of formation", "operating agreement", "articles of", "bylaws", "organizational chart", "structure chart", "legal opinion"],
  team: ["biography", "biographies", "bios", "team overview", "org chart", "management team"],
  portfolio: ["portfolio company", "case study", "portfolio review", "holdings", "asset summary"],
  thesis: ["investment thesis", "investment strategy", "strategy overview"],
  esg: ["esg", "responsible investment", "sustainability", "impact report"],
  risk: ["risk management", "valuation policy", "risk register"],
  operations: ["service provider", "fund administrator", "operational due diligence", "business continuity", "cybersecurity"],
  references: ["reference list", "references"],
  overview: ["firm overview", "company overview", "introduction to"],
};

export interface SectionSuggestion {
  section: string;
  /** 0–1. Below ~0.35 the caller should not recommend a move. */
  confidence: number;
}

function countOccurrences(haystack: string, needle: string): number {
  const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  return haystack.match(re)?.length ?? 0;
}

export function suggestSection(name: string, text: string): SectionSuggestion {
  const title = name.toLowerCase().replace(/[_\-.]+/g, " ");
  const body = text.slice(0, 8000).toLowerCase();
  let best = { section: "other", score: 0 };
  let total = 0;
  for (const [section, phrases] of Object.entries(SECTION_SIGNALS)) {
    let score = 0;
    for (const p of phrases) {
      score += countOccurrences(title, p) * 5 + Math.min(countOccurrences(body, p), 4);
    }
    total += score;
    if (score > best.score) best = { section, score };
  }
  if (best.score === 0) return { section: "other", confidence: 0 };
  return { section: best.section, confidence: Math.min(1, (best.score / Math.max(total, 1)) * Math.min(1, best.score / 5)) };
}

// Sections where an institutional reader expects a confidentiality legend.
const CONFIDENTIAL_SECTIONS = new Set(["fund_terms", "financials", "legal", "track_record", "diligence", "portfolio"]);
// Sections that present performance, which the SEC Marketing Rule and every
// LP's counsel expect to carry a past-performance disclaimer.
const PERFORMANCE_SECTIONS = new Set(["track_record", "marketing"]);

const PLACEHOLDER = /\[(?:tbd|tbc|●|•|x+|insert[^\]]*|placeholder[^\]]*)\]|\btbd\b|\bxx+\b|lorem ipsum|\?\?\?/i;

export function ruleFindings(input: {
  name: string;
  section: string;
  text: string;
  textStatus: "ok" | "empty" | "unsupported" | "failed" | null;
  now?: Date;
}): DocumentReviewRecommendation[] {
  const out: DocumentReviewRecommendation[] = [];
  const { text, section } = input;
  const now = input.now ?? new Date();

  if (input.textStatus === "empty") {
    out.push({
      severity: "suggestion",
      title: "No searchable text",
      detail:
        "This looks like a scanned PDF. Run it through OCR (Acrobat → Scan & OCR) and re-upload so readers can search and copy from it, and so Earn can review its contents.",
    });
    return out;
  }
  if (input.textStatus !== "ok" || !text.trim()) return out;

  const placeholder = PLACEHOLDER.exec(text);
  if (placeholder) {
    const i = placeholder.index;
    out.push({
      severity: "blocker",
      title: "Unfilled placeholder",
      detail: `The text still contains "${placeholder[0]}". Fill it in before this goes to an investor.`,
      location: text.slice(Math.max(0, i - 60), i + 60).replace(/\s+/g, " ").trim(),
    });
  }

  if (/\bdraft\b/i.test(text.slice(0, 3000)) || /\bdraft\b/i.test(input.name)) {
    out.push({
      severity: "suggestion",
      title: "Marked as a draft",
      detail: "The title or opening page says DRAFT. Remove the marking if this is the final version, or keep it private until it is.",
    });
  }

  const years = [...text.matchAll(/\b(20[0-4]\d)\b/g)].map((m) => Number(m[1])).filter((y) => y <= now.getFullYear() + 1);
  if (years.length >= 3) {
    const latest = Math.max(...years);
    if (latest < now.getFullYear() - 1) {
      out.push({
        severity: "suggestion",
        title: "May be out of date",
        detail: `The most recent year referenced is ${latest}. Confirm the figures are current, or add an "as of" date so readers know what period it covers.`,
      });
    }
  }

  if (CONFIDENTIAL_SECTIONS.has(section) && !/confidential|proprietary|not for distribution/i.test(text)) {
    out.push({
      severity: "suggestion",
      title: "No confidentiality legend",
      detail: 'Add a "Confidential — not for distribution" legend to the cover or footer. Most LPs expect it on terms, financials and performance material.',
    });
  }

  if (
    PERFORMANCE_SECTIONS.has(section) &&
    /\b(irr|moic|tvpi|dpi|net return|gross return)\b/i.test(text) &&
    !/past performance/i.test(text)
  ) {
    out.push({
      severity: "blocker",
      title: "Performance shown without a disclaimer",
      detail:
        'This presents returns but has no past-performance disclaimer (e.g. "Past performance is not indicative of future results"). Add one, with gross/net basis stated, before sharing.',
    });
  }

  return out;
}

export interface ShareSuggestion {
  label: string;
  expiresInDays: number;
  requireEmail: boolean;
  requireNda: boolean;
  allowDownload: boolean;
  watermark: boolean;
  rationale: string;
}

/**
 * Earn's default settings for sharing one document, from what kind of document
 * it is. The operator sees these pre-filled and confirms — sharing reaches a
 * counterparty, so it is never done on their behalf.
 */
export function suggestShareSettings(input: { name: string; section: string }): ShareSuggestion {
  const s = SECTION_KEYS.has(input.section) ? input.section : "other";
  if (s === "marketing" || s === "overview" || s === "thesis" || s === "team") {
    return {
      label: input.name,
      expiresInDays: 30,
      requireEmail: true,
      requireNda: false,
      allowDownload: true,
      watermark: false,
      rationale: "Marketing material is meant to travel: email capture tells you who opened it, and downloads stay on.",
    };
  }
  if (s === "fund_terms" || s === "legal" || s === "financials" || s === "track_record") {
    return {
      label: input.name,
      expiresInDays: 14,
      requireEmail: true,
      requireNda: true,
      allowDownload: false,
      watermark: true,
      rationale:
        "Terms, financials and performance are the most sensitive paper in the room: NDA first, view-only, and watermarked with the reader's email so any copy is traceable.",
    };
  }
  return {
    label: input.name,
    expiresInDays: 21,
    requireEmail: true,
    requireNda: false,
    allowDownload: true,
    watermark: true,
    rationale: "Diligence material: email capture and a watermark, with downloads on so the reader's team can work from it.",
  };
}

/** Merge model and rule findings, dropping rule findings the model already made. */
export function mergeFindings(
  model: DocumentReviewRecommendation[],
  rules: DocumentReviewRecommendation[],
): DocumentReviewRecommendation[] {
  const seen = new Set(model.map((m) => m.title.toLowerCase()));
  const extra = rules.filter((r) => {
    const key = r.title.toLowerCase();
    // Loose match: the model often phrases the same finding differently.
    const covered = [...seen].some((t) => t.includes(key.split(" ")[0]) && t.includes(key.split(" ").pop() ?? ""));
    return !seen.has(key) && !covered;
  });
  const order = { blocker: 0, suggestion: 1, nit: 2 } as const;
  return [...model, ...extra].sort((a, b) => order[a.severity] - order[b.severity]);
}

/**
 * Settings for a link into a whole room: the most sensitive material in it sets
 * the bar, since one link opens all of it.
 */
export function suggestRoomShareSettings(input: { roomName: string; sections: string[] }): ShareSuggestion {
  const sensitive = ["fund_terms", "legal", "financials", "track_record"];
  const worst = input.sections.find((s) => sensitive.includes(s)) ?? input.sections[0] ?? "other";
  const base = suggestShareSettings({ name: input.roomName, section: worst });
  return {
    ...base,
    rationale: input.sections.some((s) => sensitive.includes(s))
      ? `This room includes terms, financials or performance. ${base.rationale}`
      : base.rationale,
  };
}
