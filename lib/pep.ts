// lib/pep.ts
// A FIRST-PASS politically-exposed-person (PEP) screen. Pure: the request a
// provider is sent, how its answer is read, and the wording of the result. No
// network and no database, so each rule is tested on its own.
//
// It follows the OFAC screen's rules (lib/ofac.ts):
//   * It FLAGS a possible match and never clears anyone. "No possible match" is a
//     note for the reviewer, not a result: the PEP check stays open until the fund
//     manager records their own.
//   * It is generous in what it flags (a false alarm costs a minute; a miss costs
//     more), and it still misses what a name search can't see: a person missing
//     from the provider's data, heavy transliteration, a relative who is not
//     linked to the PEP in the data.
//   * A provider that fails or answers with something unreadable is an ERROR,
//     never "no match".
//
// Unlike OFAC, which is matched here against a public file so nothing leaves the
// system, this SENDS NAMES to a screening provider. Only names are sent: no
// email, address, date of birth, amount or fund. See docs/compliance.
import type { ScreenSubject } from "@/lib/ofac";

export const PEP_SCREEN_PREFIX = "PEP first-pass screen";

/** Topics that mean "politically exposed": the person, or a relative or close associate. */
export const PEP_TOPICS = ["role.pep", "role.rca"] as const;
const TOPIC_LABEL: Record<string, string> = { "role.pep": "politically exposed", "role.rca": "relative or close associate" };

/** Score at or above which a candidate is flagged even if the provider did not call it a match. */
export const PEP_FLAG_THRESHOLD = 0.7;
export const MAX_SUBJECTS = 50;
const MAX_MATCHES_PER_SUBJECT = 3;
const SUMMARY_MAX = 480;

export interface PepConfig {
  apiUrl: string;
  dataset: string;
  apiKey: string;
}

/** The provider settings, or null when screening isn't set up (no key). */
export function pepConfig(env: Record<string, string | undefined> = process.env): PepConfig | null {
  const apiKey = env.PEP_SCREEN_API_KEY?.trim();
  if (!apiKey) return null;
  const apiUrl = (env.PEP_SCREEN_API_URL?.trim() || "https://api.opensanctions.org").replace(/\/+$/, "");
  const dataset = env.PEP_SCREEN_DATASET?.trim() || "peps";
  // The dataset becomes part of a URL path.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(dataset)) return null;
  try {
    const u = new URL(apiUrl);
    if (u.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return { apiUrl, dataset, apiKey };
}

// ---- the request -----------------------------------------------------------

export interface PepQuery {
  key: string;
  subject: ScreenSubject;
  schema: "Person" | "LegalEntity";
}

/** Distinct, non-empty names to send, each with a key to read its answer by. At most MAX_SUBJECTS. */
export function pepQueries(subjects: ScreenSubject[]): PepQuery[] {
  const seen = new Set<string>();
  const out: PepQuery[] = [];
  for (const s of subjects) {
    const name = s.name.trim().replace(/\s+/g, " ");
    const norm = name.toLowerCase();
    if (name.length < 2 || seen.has(norm)) continue;
    seen.add(norm);
    out.push({ key: `q${out.length}`, subject: { role: s.role, name }, schema: s.role === "the LP" ? "LegalEntity" : "Person" });
    if (out.length >= MAX_SUBJECTS) break;
  }
  return out;
}

/** The body for the provider's match endpoint. Names only. */
export function pepRequestBody(queries: PepQuery[]) {
  const q: Record<string, { schema: string; properties: { name: string[] } }> = {};
  for (const x of queries) q[x.key] = { schema: x.schema, properties: { name: [x.subject.name] } };
  return { queries: q };
}

// ---- reading the answer ----------------------------------------------------

export interface PepMatch {
  caption: string;
  score: number;
  topics: string[];
}

export interface PepSubjectResult {
  subject: ScreenSubject;
  matches: PepMatch[];
}

export interface PepResult {
  provider: string;
  dataset: string;
  screenedOn: string;
  results: PepSubjectResult[];
  /** Subjects with at least one possible match. */
  flagged: number;
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asObject = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/**
 * Reads the provider's answer. Returns null when it isn't the shape we expect, or
 * when a name we asked about has no answer at all, so a silent gap in the answer
 * can't be mistaken for "no match".
 */
export function parsePepResponse(json: unknown, queries: PepQuery[], meta: { dataset: string; now: number; provider?: string }): PepResult | null {
  const responses = asObject(asObject(json)?.responses);
  if (!responses) return null;
  const results: PepSubjectResult[] = [];
  for (const q of queries) {
    const r = asObject(responses[q.key]);
    if (!r || !Array.isArray(r.results)) return null;
    const matches: PepMatch[] = [];
    for (const raw of asArray(r.results)) {
      const c = asObject(raw);
      if (!c) continue;
      const props = asObject(c.properties);
      const topics = [...asArray(props?.topics), ...asArray(c.topics)].filter((t): t is string => typeof t === "string");
      const pepTopics = topics.filter((t) => (PEP_TOPICS as readonly string[]).includes(t));
      if (pepTopics.length === 0) continue;
      const score = typeof c.score === "number" && Number.isFinite(c.score) ? c.score : 0;
      if (!(c.match === true || score >= PEP_FLAG_THRESHOLD)) continue;
      matches.push({
        caption: typeof c.caption === "string" && c.caption.trim() ? c.caption.trim().slice(0, 120) : "an unnamed entry",
        score: Math.round(score * 100) / 100,
        topics: [...new Set(pepTopics)],
      });
    }
    matches.sort((a, b) => b.score - a.score);
    results.push({ subject: q.subject, matches: matches.slice(0, MAX_MATCHES_PER_SUBJECT) });
  }
  return {
    provider: meta.provider ?? "opensanctions",
    dataset: meta.dataset,
    screenedOn: new Date(meta.now).toISOString().slice(0, 10),
    results,
    flagged: results.filter((x) => x.matches.length > 0).length,
  };
}

// ---- what to record --------------------------------------------------------

export interface PepOutcome {
  /** "flagged" when anything may match; otherwise the check stays "pending". It is never "clear". */
  status: "flagged" | "pending";
  summary: string;
}

const clip = (s: string) => (s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX - 1)}…` : s);

export function pepOutcome(r: PepResult): PepOutcome {
  const n = r.results.length;
  if (r.flagged === 0) {
    return {
      status: "pending",
      summary: clip(
        `${PEP_SCREEN_PREFIX} ${r.screenedOn}: no possible match for ${n} name${n === 1 ? "" : "s"} (${r.provider} ${r.dataset}). Not a clearance: names only, one provider's data. Record your own result.`,
      ),
    };
  }
  const hits = r.results
    .filter((x) => x.matches.length > 0)
    .map((x) => {
      const m = x.matches[0];
      const more = x.matches.length > 1 ? ` +${x.matches.length - 1} more` : "";
      const why = m.topics.map((t) => TOPIC_LABEL[t] ?? t).join(", ");
      return `${x.subject.name} (${x.subject.role}) resembles ${m.caption} [${why}]${more}`;
    })
    .join("; ");
  return {
    status: "flagged",
    summary: clip(`${PEP_SCREEN_PREFIX} ${r.screenedOn}: possible match. ${hits}. Confirm whether it is the same person, then record your result.`),
  };
}
