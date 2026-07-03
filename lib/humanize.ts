// lib/humanize.ts
// One display-label rule for raw snake_case identifiers, shared by every
// surface that renders DB enums or column keys (AddRowForm select options,
// ModuleTable cells and detail labels). The audit found the same value
// rendering three different ways across surfaces — `fund_of_funds`,
// `ic_review`, `co_gp` shown verbatim to operators. Pure string work, no I/O.

// Domain initialisms that should render uppercase rather than title-case.
const ACRONYMS = new Set([
  "ai",
  "ic",
  "lp",
  "gp",
  "irr",
  "moic",
  "tvpi",
  "dpi",
  "rvpi",
  "nav",
  "aum",
  "ebitda",
  "esg",
  "api",
  "url",
  "id",
  "nda",
  "loi",
  "spv",
]);

// Connectives stay lowercase mid-phrase: "fund_of_funds" → "Fund of Funds".
const SMALL_WORDS = new Set(["of", "and", "or", "the", "to", "in", "for", "a", "an"]);

/**
 * "ic_review" → "IC Review", "fund_of_funds" → "Fund of Funds",
 * "co_gp" → "Co GP", "real_estate" → "Real Estate". Idempotent on values that
 * are already human ("Fund of Funds" passes through via humanizeEnumValue's
 * guard; this function itself just title-cases word by word).
 */
export function humanize(raw: string): string {
  return raw
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      if (index > 0 && SMALL_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

// A value is enum-shaped when it reads as lowercase snake_case (or one bare
// lowercase token): no spaces, no capitals, no punctuation beyond underscores.
// Emails (@, .), URLs (://), free text (spaces), and numbers-with-symbols all
// fail this and render verbatim.
const ENUM_SHAPE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

/**
 * Humanize a cell/option value only when it is enum-shaped; anything that
 * looks like real content (names with capitals, emails, URLs, sentences)
 * passes through untouched.
 */
export function humanizeEnumValue(value: string): string {
  return ENUM_SHAPE.test(value) ? humanize(value) : value;
}
