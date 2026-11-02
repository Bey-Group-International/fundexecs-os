// lib/csp-report.ts
// What the investor pages' report-only Content-Security-Policy sends back, reduced to
// what is safe to log. Pure, so the reduction is tested without a request.
//
// A violation report carries the page's URL (for /lp/ that is the bearer link), the
// blocked URL, the source file and the first characters of an inline script (which can
// be serialized page data). None of that is kept: only which directive was hit, the ORIGIN
// of what was blocked (or a keyword such as "inline"), whether it was only reported, and
// where in the file it was.

export interface CspViolation {
  directive: string;
  /** An origin ("https://x.example"), or a keyword: inline, eval, data, blob, wasm-eval, self, other. */
  blocked: string;
  disposition: "report" | "enforce";
  line: number | null;
  column: number | null;
}

/** The most violations kept from one report; a page that trips thousands does not fill a log. */
export const MAX_VIOLATIONS_PER_REPORT = 5;
/** Larger bodies are ignored without being parsed. */
export const MAX_REPORT_BYTES = 8 * 1024;

const KEYWORDS = new Set(["inline", "eval", "data", "blob", "wasm-eval", "self"]);
const DIRECTIVE = /^[a-z][a-z-]{0,39}$/;

function blockedOf(v: unknown): string {
  if (typeof v !== "string" || !v) return "other";
  const keyword = v.toLowerCase();
  if (KEYWORDS.has(keyword)) return keyword;
  // data:image/png;base64,... and blob:https://... are schemes, not origins.
  if (/^data:/i.test(v)) return "data";
  if (/^blob:/i.test(v)) return "blob";
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : "other";
  } catch {
    return "other";
  }
}

const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1e7 ? v : null);

function one(body: unknown): CspViolation | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  // The legacy report uses kebab-case keys, the Reporting API camelCase.
  const directive = String(b["effective-directive"] ?? b["effectiveDirective"] ?? b["violated-directive"] ?? b["violatedDirective"] ?? "")
    .split(/\s+/)[0]
    .toLowerCase();
  if (!DIRECTIVE.test(directive)) return null;
  const disposition = b["disposition"] === "enforce" ? "enforce" : "report";
  return {
    directive,
    blocked: blockedOf(b["blocked-uri"] ?? b["blockedURL"] ?? b["blockedUri"]),
    disposition,
    line: int(b["line-number"] ?? b["lineNumber"]),
    column: int(b["column-number"] ?? b["columnNumber"]),
  };
}

/** The violations in a parsed report body, in either report format, capped. Anything unrecognised yields none. */
export function summarizeCspReport(json: unknown): CspViolation[] {
  const items: unknown[] = [];
  if (Array.isArray(json)) {
    // Reporting API: [{ type: "csp-violation", body: {...} }, ...]
    for (const r of json) if (r && typeof r === "object" && (r as Record<string, unknown>).type === "csp-violation") items.push((r as Record<string, unknown>).body);
  } else if (json && typeof json === "object") {
    const legacy = (json as Record<string, unknown>)["csp-report"];
    if (legacy) items.push(legacy);
  }
  const out: CspViolation[] = [];
  for (const it of items) {
    const v = one(it);
    if (v) out.push(v);
    if (out.length >= MAX_VIOLATIONS_PER_REPORT) break;
  }
  return out;
}
