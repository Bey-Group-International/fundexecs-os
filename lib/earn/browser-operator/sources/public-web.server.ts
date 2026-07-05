// lib/earn/browser-operator/sources/public-web.server.ts
//
// REAL, browser-FREE extraction from a user-provided PUBLIC URL. This is a plain
// HTTP GET — NOT a headless browser — with a timeout and a hard body-size cap.
// It reads only surface metadata (title, meta description) and light, public
// leadership/contact hints, and it NEVER fetches behind a login or paywall.
//
// Guardrails baked in:
//   • Only http/https, no localhost / private-network hosts.
//   • Best-effort robots.txt check before fetching the target path.
//   • Every extracted point is `requires_user_confirmation: true` — public-web
//     data is corroboration-grade, never authoritative.

import type { BrowserDataSource, ExtractedDataPoint } from "../types";
import { policyForSource } from "../source-policy";
import { defaultHttpFetch, fetchTextCapped, type HttpFetch } from "./http";

const PUBLIC_WEB_USER_AGENT = "FundExecs OS research (contact: support@fundexecs.com)";

/** Hosts we refuse to fetch — SSRF / private-network guard. */
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (h === "0.0.0.0" || h === "127.0.0.1" || h === "::1") return true;
  if (/^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

export interface SafeUrl {
  href: string;
  origin: string;
  path: string;
  host: string;
}

/** Validate a public http(s) URL, rejecting private/loopback hosts. */
export function parsePublicUrl(raw: string): SafeUrl | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (isPrivateHost(u.hostname)) return null;
  return { href: u.href, origin: u.origin, path: u.pathname || "/", host: u.hostname };
}

/**
 * Best-effort robots.txt evaluation for the wildcard user-agent. Conservative:
 * a matching `Disallow` prefix blocks; an empty `Disallow:` allows all. Unknown
 * or unfetchable robots.txt is treated as allowed (best-effort, not a crawler).
 */
export function isAllowedByRobots(robotsTxt: string, path: string): boolean {
  const lines = robotsTxt.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim());
  let appliesToAll = false;
  let sawGroup = false;
  const disallows: string[] = [];

  for (const line of lines) {
    const [rawKey, ...rest] = line.split(":");
    if (!rawKey || rest.length === 0) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      // A new group starts; only the wildcard group governs us.
      appliesToAll = value === "*";
      sawGroup = true;
    } else if (key === "disallow" && appliesToAll) {
      if (value) disallows.push(value);
    }
  }

  if (!sawGroup) return true;
  return !disallows.some((rule) => path.startsWith(rule));
}

const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const META_DESC_RE =
  /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i;
const META_DESC_RE_ALT =
  /<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i;
const MAILTO_RE = /mailto:([^"'?\s>]+)/gi;

const ROLE_KEYWORDS = [
  "chief executive", "ceo", "founder", "co-founder", "managing partner",
  "managing director", "general partner", "president", "chairman", "chairwoman",
  "partner", "principal", "head of", "chief investment",
];

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Decode the ampersand LAST so a sequence like "&amp;lt;" resolves to the
    // literal "&lt;" rather than being double-unescaped into "<" (CWE-116).
    .replace(/&amp;/g, "&")
    .trim();
}

/**
 * Convert HTML into text lines, preserving block boundaries so a "Name — Title"
 * pattern in its own <p>/<li>/<h*> is not merged with its neighbours.
 */
function htmlToLines(html: string): string[] {
  return html
    // Strip script/style blocks. The closing tag allows whitespace before ">"
    // (e.g. "</script >") and any leftover unclosed tag is removed by the
    // catch-all below, so no executable content survives (CWE-116/mXSS-safe).
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<\/?(?:script|style)\b[^>]*>/gi, " ")
    // Block-level and break boundaries become line breaks.
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/?\s*(?:p|div|li|ul|ol|section|article|tr|td|th|h[1-6]|header|footer)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
}

/**
 * Extract surface metadata + light leadership/contact hints from a raw HTML
 * string. Pure so it is testable from a sample string with no network. Returns
 * moderate-confidence points that ALWAYS require user confirmation.
 */
export function extractDataPointsFromHtml(
  html: string,
  opts: { url: string; source?: BrowserDataSource; maxPeople?: number } = { url: "" },
): ExtractedDataPoint[] {
  const source: BrowserDataSource = opts.source ?? "company_website";
  const confidence = policyForSource(source).base_confidence;
  const capturedAt = new Date().toISOString();
  const maxPeople = opts.maxPeople ?? 6;
  const points: ExtractedDataPoint[] = [];

  const push = (field_name: string, value: string, evidence?: string) => {
    const v = value.trim();
    if (!v) return;
    points.push({
      field_name,
      extracted_value: v,
      source_type: source,
      source_url: opts.url || undefined,
      captured_at: capturedAt,
      confidence_score: confidence,
      evidence_snippet: evidence,
      requires_user_confirmation: true,
    });
  };

  const titleMatch = html.match(TITLE_RE);
  if (titleMatch) push("company_name", decodeEntities(titleMatch[1]), "Page <title>");

  const descMatch = html.match(META_DESC_RE) ?? html.match(META_DESC_RE_ALT);
  if (descMatch) push("company_description", decodeEntities(descMatch[1]), "Meta description");

  const seenEmails = new Set<string>();
  let mail: RegExpExecArray | null;
  MAILTO_RE.lastIndex = 0;
  while ((mail = MAILTO_RE.exec(html)) !== null) {
    const email = decodeEntities(mail[1]).toLowerCase();
    if (email.includes("@") && !seenEmails.has(email)) {
      seenEmails.add(email);
      push(`contact_email_${seenEmails.size}`, email, "mailto: link on page");
    }
    if (seenEmails.size >= 3) break;
  }

  // Leadership hints: scan visible text lines for a senior-role mention. Split
  // long lines on sentence terminators / bullets, but keep "Name — Title" whole.
  const lines = htmlToLines(html);
  const candidates: string[] = [];
  for (const line of lines) {
    for (const part of line.split(/(?<=[.!?])\s+|·|•/)) {
      const t = part.trim();
      if (t) candidates.push(t);
    }
  }
  const seenPeople = new Set<string>();
  for (const raw of candidates) {
    if (seenPeople.size >= maxPeople) break;
    const s = decodeEntities(raw).trim();
    if (s.length < 4 || s.length > 120) continue;
    const lower = s.toLowerCase();
    if (!ROLE_KEYWORDS.some((k) => lower.includes(k))) continue;
    // Require an initial-capitalized token pair that reads like a name.
    const nameMatch = s.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z.'-]+){1,2})\b/);
    if (!nameMatch) continue;
    const key = s.toLowerCase();
    if (seenPeople.has(key)) continue;
    seenPeople.add(key);
    push(`person_${seenPeople.size}`, s, "Leadership/contact mention");
  }

  return points;
}

export interface ExtractPublicWebInput {
  url: string;
  source?: BrowserDataSource;
  http?: HttpFetch;
  timeoutMs?: number;
  maxBytes?: number;
  /** Skip the robots.txt round-trip (used in tests / trusted callers). */
  skipRobots?: boolean;
}

export type ExtractPublicWebResult =
  | { ok: true; url: string; points: ExtractedDataPoint[] }
  | { ok: false; reason: "invalid_url" | "blocked_by_robots" | "fetch_failed"; message: string };

/**
 * Fetch a public page and extract points from it. Validates the URL, does a
 * best-effort robots.txt check, then a size-capped, timed GET. NEVER follows
 * into authenticated areas — it is a single plain GET of a public URL.
 */
export async function extractFromPublicWeb(input: ExtractPublicWebInput): Promise<ExtractPublicWebResult> {
  const http = input.http ?? defaultHttpFetch;
  const parsed = parsePublicUrl(input.url);
  if (!parsed) {
    return { ok: false, reason: "invalid_url", message: "A valid public http(s) URL is required." };
  }

  const headers = { "User-Agent": PUBLIC_WEB_USER_AGENT, Accept: "text/html,application/xhtml+xml" };

  if (!input.skipRobots) {
    try {
      const robots = await fetchTextCapped(http, `${parsed.origin}/robots.txt`, {
        headers,
        timeoutMs: input.timeoutMs ?? 5000,
        maxBytes: 100_000,
      });
      if (robots.ok && robots.body && !isAllowedByRobots(robots.body, parsed.path)) {
        return {
          ok: false,
          reason: "blocked_by_robots",
          message: `robots.txt disallows fetching ${parsed.path}.`,
        };
      }
    } catch {
      // Best-effort: an unreachable robots.txt does not block the fetch.
    }
  }

  let page: { ok: boolean; status: number; body: string };
  try {
    page = await fetchTextCapped(http, parsed.href, {
      headers,
      timeoutMs: input.timeoutMs,
      maxBytes: input.maxBytes,
    });
  } catch (err) {
    return { ok: false, reason: "fetch_failed", message: (err as Error)?.message ?? "Fetch failed." };
  }
  if (!page.ok) {
    return { ok: false, reason: "fetch_failed", message: `Fetch returned HTTP ${page.status}.` };
  }

  const points = extractDataPointsFromHtml(page.body, { url: parsed.href, source: input.source });
  return { ok: true, url: parsed.href, points };
}
