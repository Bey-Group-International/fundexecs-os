// lib/ofac.ts
// A FIRST-PASS screen of names against OFAC's SDN list. Pure: parsing, name
// matching and the wording of the result, with no network and no database, so
// every rule here is tested on its own.
//
// What this is, and is not:
//   * It FLAGS a possible match. It never clears anyone. "No possible match" is a
//     note for the reviewer, not a result: the sanctions check stays open until
//     the fund manager records their own.
//   * It is deliberately generous in what it flags, because a false alarm costs a
//     minute of review and a miss costs far more. It still misses what a name
//     match can't see: heavy transliteration, initials, nicknames, an owner who
//     was never listed, and a person's address or country.
//   * It screens the SDN list only, not the other OFAC or non-US lists.
//
// SDN file layout (sdn.csv, no header row): ent_num, SDN_Name, SDN_Type, Program,
// Title, Call_Sign, Vess_type, Tonnage, GRT, Vess_flag, Vess_owner, Remarks.
// alt.csv: ent_num, alt_num, alt_type, alt_name, alt_remarks. "-0-" means empty.

// ---- parsing ---------------------------------------------------------------

/** A CSV parser that copes with quoted fields, doubled quotes and embedded newlines. */
export function parseCsv(text: string): string[][] {
  // The legacy files end with a stray Ctrl-Z; a BOM is possible too.
  const src = text.replace(/\u001a/g, "").replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

const empty = (v: string | undefined): string | null => {
  const t = (v ?? "").trim();
  return t === "" || t === "-0-" ? null : t;
};

export type SdnKind = "individual" | "entity" | "vessel" | "aircraft";

export interface SdnEntry {
  id: string;
  name: string;
  kind: SdnKind;
  programs: string[];
}

export interface SdnName {
  entryIndex: number;
  /** True for an alias (a.k.a. / f.k.a.), false for the listed name. */
  alias: boolean;
  tokens: string[];
}

export interface SdnIndex {
  entries: SdnEntry[];
  names: SdnName[];
  /** Token -> positions in `names` containing it, for the cheap exact-word pre-filter. */
  byToken: Map<string, number[]>;
  /** When the list was published or fetched, as an ISO date (YYYY-MM-DD). */
  listDate: string;
}

const KINDS: Record<string, SdnKind> = { individual: "individual", vessel: "vessel", aircraft: "aircraft" };

/** The minimum rows a real SDN file has (it holds well over ten thousand). Less means a bad download. */
export const MIN_SDN_ROWS = 5000;

export function buildIndex(sdnCsv: string, altCsv: string, listDate: string): SdnIndex {
  const entries: SdnEntry[] = [];
  const byId = new Map<string, number>();
  for (const r of parseCsv(sdnCsv)) {
    // A real row starts with a numeric entity number and carries a name.
    if (r.length < 4 || !/^\d+$/.test(r[0].trim())) continue;
    const name = empty(r[1]);
    if (!name) continue;
    const kind = KINDS[(empty(r[2]) ?? "").toLowerCase()] ?? "entity";
    const programs = (empty(r[3]) ?? "").split(/[;,]/).map((p) => p.trim()).filter(Boolean);
    byId.set(r[0].trim(), entries.length);
    entries.push({ id: r[0].trim(), name, kind, programs });
  }
  if (entries.length < MIN_SDN_ROWS) {
    throw new Error(`SDN list looks wrong: ${entries.length} entries`);
  }

  const names: SdnName[] = entries.map((e, entryIndex) => ({ entryIndex, alias: false, tokens: nameTokens(e.name) }));
  for (const r of parseCsv(altCsv)) {
    if (r.length < 4) continue;
    const idx = byId.get(r[0].trim());
    const alt = empty(r[3]);
    if (idx === undefined || !alt) continue;
    names.push({ entryIndex: idx, alias: true, tokens: nameTokens(alt) });
  }
  const kept = names.filter((n) => n.tokens.length > 0);
  const byToken = new Map<string, number[]>();
  kept.forEach((n, i) => {
    for (const t of n.tokens) {
      const list = byToken.get(t);
      if (list) list.push(i);
      else byToken.set(t, [i]);
    }
  });
  return { entries, names: kept, byToken, listDate };
}

// ---- names -----------------------------------------------------------------

// Legal-form words say nothing about who someone is, and would make every
// "... LLC" resemble every other.
const FILLER = new Set(["LLC", "LTD", "LIMITED", "INC", "INCORPORATED", "CORP", "CORPORATION", "CO", "COMPANY", "LP", "LLP", "PLC", "SA", "AG", "GMBH", "NV", "BV", "THE", "OF", "AND", "DE", "DA", "DI", "DEL", "VAN", "VON", "BIN", "BEN", "AL", "EL"]);

/** Upper-case, accents and punctuation removed, split into unique tokens, filler dropped. */
export function nameTokens(name: string): string[] {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    // "L.L.C." and "U.S.A." are one word, not three letters.
    .replace(/(?<![A-Z])(?:[A-Z]\.){2,}/g, (m) => m.replace(/\./g, ""))
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
  if (!cleaned) return [];
  return Array.from(new Set(cleaned.split(" ").filter((t) => t && !FILLER.has(t))));
}

function editDistanceAtMost(a: string, b: string, max: number): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

/** Two tokens are the same, or a near miss for a long enough word (a typo or a spelling variant). */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const len = Math.min(a.length, b.length);
  if (len < 5) return false;
  return editDistanceAtMost(a, b, len >= 9 ? 2 : 1);
}

/** Dice similarity over tokens, order-insensitive ("SMITH, JOHN" is "JOHN SMITH"). Returns [score, tokens matched]. */
export function nameSimilarity(q: string[], c: string[]): [number, number] {
  if (q.length === 0 || c.length === 0) return [0, 0];
  const used = new Set<number>();
  let matched = 0;
  for (const qt of q) {
    // Prefer an exact token, then a near one.
    let hit = c.findIndex((ct, i) => !used.has(i) && ct === qt);
    if (hit < 0) hit = c.findIndex((ct, i) => !used.has(i) && tokensMatch(qt, ct));
    if (hit >= 0) {
      used.add(hit);
      matched++;
    }
  }
  return [(2 * matched) / (q.length + c.length), matched];
}

/** Score at or above which a name is flagged for review. */
export const FLAG_THRESHOLD = 0.8;

export interface ScreenSubject {
  /** What the name is: "the LP", "signatory", "owner" and so on. */
  role: string;
  name: string;
}

export interface SdnMatch {
  sdnName: string;
  kind: SdnKind;
  programs: string[];
  alias: boolean;
  /** Rounded to two places. */
  score: number;
}

export interface SubjectResult {
  subject: ScreenSubject;
  /** False when the name had nothing to match on (empty, or only filler words). */
  screened: boolean;
  matches: SdnMatch[];
}

export interface ScreenResult {
  listDate: string;
  listSize: number;
  results: SubjectResult[];
  /** Subjects with at least one possible match. */
  flagged: number;
}

const MAX_MATCHES_PER_SUBJECT = 3;

/** Positions of the names that share a word with the query, exactly or within a typo of a long one. */
function candidateNames(index: SdnIndex, q: string[]): Set<number> {
  const out = new Set<number>();
  let fuzzyTokens: string[] | null = null;
  for (const t of q) {
    for (const pos of index.byToken.get(t) ?? []) out.add(pos);
    if (t.length >= 5) {
      fuzzyTokens ??= Array.from(index.byToken.keys());
      for (const other of fuzzyTokens) {
        if (other !== t && tokensMatch(t, other)) for (const pos of index.byToken.get(other)!) out.add(pos);
      }
    }
  }
  return out;
}

export function screenNames(index: SdnIndex, subjects: ScreenSubject[]): ScreenResult {
  const seen = new Set<string>();
  const results: SubjectResult[] = [];
  for (const subject of subjects) {
    const q = nameTokens(subject.name);
    // The same person listed twice (as the LP and the signatory) is screened once.
    const key = [...q].sort().join(" ");
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    if (q.length === 0) {
      results.push({ subject, screened: false, matches: [] });
      continue;
    }

    // A match needs at least one word of the query to match a word of the name,
    // exactly or within a typo of a long one, so only names sharing such a word
    // are worth scoring. This gives the same answer as scoring every name.
    const candidates = candidateNames(index, q);
    const best = new Map<number, SdnMatch>();
    for (const pos of candidates) {
      const n = index.names[pos];
      const [score, matched] = nameSimilarity(q, n.tokens);
      // One matching word is not a match, unless the whole name is that one word.
      // A short exact word ("HAMAS") counts; a near spelling needs a longer one.
      const whole =
        q.length === 1 && n.tokens.length === 1 && matched === 1 && (q[0] === n.tokens[0] ? q[0].length >= 4 : q[0].length >= 6);
      if (!(score >= FLAG_THRESHOLD && (matched >= 2 || whole))) continue;
      const entry = index.entries[n.entryIndex];
      const prior = best.get(n.entryIndex);
      if (prior && prior.score >= score) continue;
      best.set(n.entryIndex, {
        sdnName: entry.name,
        kind: entry.kind,
        programs: entry.programs,
        alias: n.alias,
        score: Math.round(score * 100) / 100,
      });
    }
    const matches = Array.from(best.values()).sort((a, b) => b.score - a.score).slice(0, MAX_MATCHES_PER_SUBJECT);
    results.push({ subject, screened: true, matches });
  }
  return { listDate: index.listDate, listSize: index.entries.length, results, flagged: results.filter((r) => r.matches.length > 0).length };
}

// ---- what to record --------------------------------------------------------

export const SCREEN_PREFIX = "OFAC first-pass screen";
const SUMMARY_MAX = 480;

export interface ScreenOutcome {
  /** "flagged" when anything may match; otherwise the check stays "pending". It is never "clear". */
  status: "flagged" | "pending";
  summary: string;
}

const clip = (s: string) => (s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX - 1)}…` : s);

export function screenOutcome(r: ScreenResult): ScreenOutcome {
  const screened = r.results.filter((x) => x.screened).length;
  const skipped = r.results.length - screened;
  const tail = skipped ? ` ${skipped} name${skipped === 1 ? "" : "s"} too short to screen.` : "";

  if (r.flagged === 0) {
    return {
      status: "pending",
      summary: clip(
        `${SCREEN_PREFIX} ${r.listDate}: no possible match for ${screened} name${screened === 1 ? "" : "s"} in ${r.listSize.toLocaleString("en-US")} SDN entries.${tail} Not a clearance: names only, SDN list only. Record your own result.`,
      ),
    };
  }
  const hits = r.results
    .filter((x) => x.matches.length > 0)
    .map((x) => {
      const m = x.matches[0];
      const more = x.matches.length > 1 ? ` +${x.matches.length - 1} more` : "";
      return `${x.subject.name} (${x.subject.role}) resembles ${m.sdnName}${m.alias ? " (via an alias)" : ""}${m.programs.length ? ` [${m.programs.join(", ")}]` : ""}${more}`;
    })
    .join("; ");
  return {
    status: "flagged",
    summary: clip(`${SCREEN_PREFIX} ${r.listDate}: possible match. ${hits}. Check each against OFAC's list, then record your result.`),
  };
}
