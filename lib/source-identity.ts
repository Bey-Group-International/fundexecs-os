// lib/source-identity.ts
// Identity + contact hygiene for the Source hub.
//
// Two jobs, both pure and DB-free so the engine stays unit-testable:
//
//   1. IDENTITY — decide whether two firm names refer to the same entity.
//      Exact lowercase matching (what the engine used to do) treats
//      "Acme Capital", "Acme Capital LLC" and "Acme Capital, L.P." as three
//      different firms, so the same target gets sourced and inserted again on
//      every run. Normalizing legal form and punctuation collapses them.
//
//   2. CONTACT HYGIENE — a model asked for a decision maker's direct line will
//      sometimes produce a plausible-looking placeholder. Length-truncating the
//      string (the old behaviour) keeps it; validating the shape drops it, so
//      an operator never sends outreach to jane@example.com or (555) 555-5555.
//
// Everything here fails closed: when a value can't be validated it returns
// undefined rather than a best guess. An empty field is honest; a wrong one
// costs the operator a bounced email and the firm a first impression.

// Legal-form tokens that carry no identity: "Acme Capital LLC" is "Acme Capital".
const LEGAL_SUFFIXES = new Set([
  "llc", "lllp", "llp", "lp", "inc", "incorporated", "corp", "corporation",
  "co", "company", "ltd", "limited", "plc", "gmbh", "mbh", "ag", "sa", "sas",
  "nv", "bv", "ab", "oy", "as", "aps", "pte", "pty", "srl", "spa", "kg", "kk",
  "sarl", "sl", "oyj", "asa", "cv", "vof",
]);

// Descriptor tokens that commonly vary between references to the same firm:
// "Acme Capital" vs "Acme Capital Management". Used only to judge whether the
// EXTRA tokens of a longer name are meaningless — never to strip a name down to
// its first word, which would wrongly merge "Summit Partners" and "Summit
// Capital" (two real, unrelated firms).
const GENERIC_DESCRIPTORS = new Set([
  "management", "managers", "advisors", "advisers", "advisory", "associates",
  "group", "holdings", "holding", "international", "global", "worldwide",
  "services", "solutions", "enterprises", "investments", "investment",
  "asset", "assets", "am", "llc", "the",
]);

/**
 * Reduce a firm name to its identity core: lowercase, de-accented, punctuation
 * and legal form removed. Two names with the same normal form are the same
 * firm for sourcing purposes.
 */
export function normalizeEntityName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let s = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase();
  // Latin letters that NFD leaves whole — without these, "Ørsted" would lose
  // its first letter entirely when the non-ASCII strip runs below.
  s = s
    .replace(/ø/g, "o").replace(/æ/g, "ae").replace(/å/g, "a")
    .replace(/ß/g, "ss").replace(/đ/g, "d").replace(/ł/g, "l")
    .replace(/þ/g, "th").replace(/ð/g, "d");
  s = s.replace(/&/g, " and ");
  s = s.replace(/['’`]/g, ""); // O'Brien -> obrien, not "o brien"
  // Drop periods before the general punctuation strip so an abbreviated legal
  // form stays one token: "L.P." must become "lp", not "l p".
  s = s.replace(/\./g, "");
  s = s.replace(/[^a-z0-9]+/g, " ").trim();
  if (!s) return "";

  let tokens = s.split(" ").filter(Boolean);
  if (tokens[0] === "the") tokens = tokens.slice(1);
  // Legal form can repeat ("Acme Holdings Ltd Co") — peel every trailing one.
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens = tokens.slice(0, -1);
  }
  return tokens.join(" ");
}

/** Tokens of the normalized name. */
function tokensOf(raw: unknown): string[] {
  const n = normalizeEntityName(raw);
  return n ? n.split(" ") : [];
}

/**
 * True when `a` and `b` name the same firm.
 *
 * Beyond an exact normal-form match, a name is a duplicate when it is the other
 * name plus only generic descriptors — "Acme Capital" ≡ "Acme Capital
 * Management". The extra tokens must ALL be generic, which is what keeps
 * "Summit Partners" and "Summit Capital" correctly distinct.
 */
export function isSameEntity(a: unknown, b: unknown): boolean {
  const na = normalizeEntityName(a);
  const nb = normalizeEntityName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const ta = tokensOf(a);
  const tb = tokensOf(b);
  const [shortT, longT] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (shortT.length === 0 || shortT.length === longT.length) return false;
  // The shorter name must appear in order at the head of the longer one.
  for (let i = 0; i < shortT.length; i++) {
    if (longT[i] !== shortT[i]) return false;
  }
  const extra = longT.slice(shortT.length);
  return extra.every((t) => GENERIC_DESCRIPTORS.has(t));
}

/**
 * An incremental duplicate filter. Feed it the names already known, then test
 * each candidate; accepted names are remembered so a batch can't repeat itself.
 */
export class EntityDedupe {
  private readonly exact = new Set<string>();
  private readonly names: string[] = [];

  constructor(seed: Iterable<string> = []) {
    for (const n of seed) this.add(n);
  }

  /** True when this name matches something already seen. */
  has(name: unknown): boolean {
    const key = normalizeEntityName(name);
    if (!key) return false;
    if (this.exact.has(key)) return true;
    return this.names.some((known) => isSameEntity(known, name));
  }

  /** Remember a name. Returns false when it was already known. */
  add(name: unknown): boolean {
    const key = normalizeEntityName(name);
    if (!key || this.has(name)) return false;
    this.exact.add(key);
    this.names.push(String(name));
    return true;
  }

  get size(): number {
    return this.exact.size;
  }
}

// ---------------------------------------------------------------------------
// Contact hygiene
// ---------------------------------------------------------------------------

// Domains that only ever appear in documentation and filler output.
const PLACEHOLDER_DOMAINS = new Set([
  "example.com", "example.org", "example.net", "example.co", "test.com",
  "domain.com", "yourdomain.com", "company.com", "yourcompany.com",
  "email.com", "youremail.com", "sample.com", "acme.com", "firm.com",
  "yourfirm.com", "somewhere.com", "none.com", "na.com", "unknown.com",
  "placeholder.com", "mycompany.com", "website.com", "localhost",
]);

// Local parts that are obviously a template rather than a person.
const PLACEHOLDER_LOCALS = new Set([
  "email", "youremail", "your", "yourname", "name", "firstname", "lastname",
  "firstname.lastname", "first.last", "john.doe", "jane.doe", "johndoe",
  "janedoe", "someone", "user", "username", "test", "example", "unknown",
  "notavailable", "n.a", "na", "none", "tbd", "xxx", "placeholder",
]);

/**
 * Validate an email's shape and reject documentation placeholders. Returns the
 * lowercased address, or undefined when it can't be trusted.
 */
export function cleanEmail(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase();
  if (!s || s.length > 254) return undefined;
  // One @, a local part, and a dotted domain with a real TLD.
  if (!/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(s)) {
    return undefined;
  }
  const [local, domain] = s.split("@");
  if (local.length > 64) return undefined;
  if (PLACEHOLDER_LOCALS.has(local)) return undefined;
  if (PLACEHOLDER_DOMAINS.has(domain)) return undefined;
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (tld.length < 2 || /^\d+$/.test(tld)) return undefined;
  return s;
}

/**
 * Validate a phone number by digit count and reject known filler patterns
 * (repeated digits, 1234567890, the 555-01xx fictional range). Returns the
 * original formatting so the operator sees it the way it was given.
 */
export function cleanPhone(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s || s.length > 40) return undefined;
  if (/[a-z]/i.test(s.replace(/\s*(ext|x|extension)\.?\s*\d+$/i, ""))) return undefined;
  const digits = s.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return undefined;
  if (/^(\d)\1+$/.test(digits)) return undefined; // 5555555555
  if (digits.includes("1234567890") || digits.includes("0123456789")) return undefined;
  // North American fictional range: 555-0100 … 555-0199.
  const nanp = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (nanp.length === 10 && nanp.slice(3, 6) === "555" && nanp.slice(6, 8) === "01") return undefined;
  return s;
}

/** A well-formed http(s) URL that isn't a documentation placeholder. */
export function cleanWebUrl(v: unknown, maxLength = 500): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s || !/^https?:\/\/\S+$/i.test(s)) return undefined;
  let host: string;
  try {
    host = new URL(s).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
  if (!host || !host.includes(".") || PLACEHOLDER_DOMAINS.has(host)) return undefined;
  return s.slice(0, maxLength);
}

/** A LinkedIn profile or company URL — anything else is not a LinkedIn link. */
export function cleanLinkedIn(v: unknown): string | undefined {
  const url = cleanWebUrl(v, 300);
  if (!url) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const host = parsed.hostname.toLowerCase().replace(/^([a-z]{2}\.)?www\./, "").replace(/^[a-z]{2}\./, "");
  if (host !== "linkedin.com") return undefined;
  if (!/^\/(in|company|school|pub)\/[^/]+/i.test(parsed.pathname)) return undefined;
  return url;
}

// ---------------------------------------------------------------------------
// Category matching
// ---------------------------------------------------------------------------

/** Compare enum-ish labels ignoring case and separator style. */
function categoryKey(v: string): string {
  return v.toLowerCase().replace(/[_\-\s]+/g, " ").trim();
}

/**
 * Map a free-form category onto one of a module's allowed values.
 *
 * Returns null when nothing matches, so the caller can fall back deliberately
 * instead of the value silently becoming the first enum member — which used to
 * file every unrecognized allocator as a family office.
 */
export function matchCategory(value: unknown, options: string[]): string | null {
  if (typeof value !== "string" || !options.length) return null;
  const want = categoryKey(value);
  if (!want) return null;

  const exact = options.find((o) => categoryKey(o) === want);
  if (exact) return exact;

  // Singular/plural tolerance ("institutions" → "institution").
  const depluralize = (s: string) => s.replace(/(?:ies)$/, "y").replace(/(?:es|s)$/, "");
  const wantSing = depluralize(want);
  const plural = options.find((o) => depluralize(categoryKey(o)) === wantSing);
  if (plural) return plural;

  // Token containment: "family office (single)" → "family_office".
  const wantTokens = new Set(want.split(" ").filter(Boolean));
  let best: { option: string; score: number } | null = null;
  for (const o of options) {
    const optTokens = categoryKey(o).split(" ").filter(Boolean);
    if (!optTokens.length) continue;
    const hits = optTokens.filter((t) => wantTokens.has(t)).length;
    if (hits === optTokens.length && (!best || optTokens.length > best.score)) {
      best = { option: o, score: optTokens.length };
    }
  }
  return best?.option ?? null;
}

export const __test = {
  LEGAL_SUFFIXES,
  GENERIC_DESCRIPTORS,
  PLACEHOLDER_DOMAINS,
  categoryKey,
};
