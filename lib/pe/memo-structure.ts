// lib/pe/memo-structure.ts
// The firm's IC memo structure (root-ic-memo): which sections, in what order, under
// what title, and which are required. Pure.
//
// The ic-memo skill can GENERATE twelve known sections (keys below). A firm may name
// any of them, in any order, under its own title. A firm may also name a section the
// skill cannot generate (e.g. "structure", "asks", "source_ledger"): that section is
// emitted as an OPEN placeholder, never filled in with invented content. Sections the
// firm leaves out are not emitted.

export const MEMO_SECTION_KEYS = [
  "executive_summary",
  "recommendation",
  "transaction_overview",
  "investment_thesis",
  "market",
  "financials_valuation",
  "returns",
  "key_risks",
  "mitigants",
  "open_items",
  "conditions_precedent",
  "decision_history",
] as const;
export type MemoSectionKey = (typeof MEMO_SECTION_KEYS)[number];

export function isMemoSectionKey(k: string): k is MemoSectionKey {
  return (MEMO_SECTION_KEYS as readonly string[]).includes(k);
}

/** The skill's own headings, in its own order. */
export const DEFAULT_MEMO_TITLES: Record<MemoSectionKey, string> = {
  executive_summary: "Executive Summary",
  recommendation: "Recommendation",
  transaction_overview: "Transaction Overview",
  investment_thesis: "Investment Thesis",
  market: "Market",
  financials_valuation: "Financials & Valuation",
  returns: "Returns",
  key_risks: "Key Risks",
  mitigants: "Mitigants",
  open_items: "Open Items",
  conditions_precedent: "Conditions Precedent",
  decision_history: "Decision History",
};

export const MAX_MEMO_SECTIONS = 30;
export const MAX_TITLE_CHARS = 80;
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

export interface MemoSectionSpec {
  key: string;
  title: string;
  required: boolean;
}

export interface MemoStructure {
  sections: MemoSectionSpec[];
}

export interface MemoStructureParse {
  structure: MemoStructure | null;
  /** One line per entry that was dropped, with the reason. */
  dropped: string[];
  /** Keys of sections the skill cannot generate (they become open placeholders). */
  customKeys: string[];
}

/** Defensive parse. structure is null when no valid section survives. Never throws. */
export function parseMemoStructure(raw: unknown): MemoStructureParse {
  const empty: MemoStructureParse = { structure: null, dropped: [], customKeys: [] };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return empty;
  const list = (raw as Record<string, unknown>).sections;
  if (!Array.isArray(list)) return empty;

  const sections: MemoSectionSpec[] = [];
  const dropped: string[] = [];
  const customKeys: string[] = [];
  const seen = new Set<string>();

  list.forEach((entry, i) => {
    const where = `Section ${i + 1}`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      dropped.push(`${where}: not an object.`);
      return;
    }
    const o = entry as Record<string, unknown>;
    const key = typeof o.key === "string" ? o.key.trim() : "";
    if (!KEY_PATTERN.test(key)) {
      dropped.push(`${where}: key must be lowercase letters, digits and underscores, starting with a letter.`);
      return;
    }
    if (seen.has(key)) {
      dropped.push(`${where}: "${key}" is listed more than once; the first one is used.`);
      return;
    }
    if (sections.length >= MAX_MEMO_SECTIONS) {
      dropped.push(`${where}: over the limit of ${MAX_MEMO_SECTIONS} sections.`);
      return;
    }
    const known = isMemoSectionKey(key);
    const rawTitle = typeof o.title === "string" ? o.title.trim() : "";
    if (rawTitle.length > MAX_TITLE_CHARS) {
      dropped.push(`${where} ("${key}"): title is over ${MAX_TITLE_CHARS} characters.`);
      return;
    }
    const title = rawTitle || (known ? DEFAULT_MEMO_TITLES[key] : "");
    if (!title) {
      dropped.push(`${where} ("${key}"): a section the skill does not generate needs a title.`);
      return;
    }
    seen.add(key);
    if (!known) customKeys.push(key);
    sections.push({ key, title, required: o.required === true });
  });

  return { structure: sections.length ? { sections } : null, dropped, customKeys };
}
