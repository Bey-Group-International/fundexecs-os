// Country → flag emoji + display label. The marketplace stores `country` as
// free text or a slug (e.g. "united-states", "United States", "US"); this
// resolves any of those to a canonical label and an emoji flag so cards stay
// self-contained (no image assets, works in light/dark, RTL-safe).

export type ResolvedCountry = {
  label: string;
  flag: string;
  /** ISO-3166 alpha-2, when known — used for grouping/facets. */
  code: string | null;
};

// Curated set covering the countries that actually appear in private-market
// deal flow. Keyed by ISO-2; aliases (slugs, names) resolve into it below.
const BY_CODE: Record<string, { label: string; flag: string }> = {
  US: { label: "United States", flag: "🇺🇸" },
  GB: { label: "United Kingdom", flag: "🇬🇧" },
  CA: { label: "Canada", flag: "🇨🇦" },
  DE: { label: "Germany", flag: "🇩🇪" },
  FR: { label: "France", flag: "🇫🇷" },
  IT: { label: "Italy", flag: "🇮🇹" },
  ES: { label: "Spain", flag: "🇪🇸" },
  PT: { label: "Portugal", flag: "🇵🇹" },
  CH: { label: "Switzerland", flag: "🇨🇭" },
  AT: { label: "Austria", flag: "🇦🇹" },
  NL: { label: "Netherlands", flag: "🇳🇱" },
  BE: { label: "Belgium", flag: "🇧🇪" },
  IE: { label: "Ireland", flag: "🇮🇪" },
  SE: { label: "Sweden", flag: "🇸🇪" },
  NO: { label: "Norway", flag: "🇳🇴" },
  DK: { label: "Denmark", flag: "🇩🇰" },
  FI: { label: "Finland", flag: "🇫🇮" },
  PL: { label: "Poland", flag: "🇵🇱" },
  RO: { label: "Romania", flag: "🇷🇴" },
  BG: { label: "Bulgaria", flag: "🇧🇬" },
  GR: { label: "Greece", flag: "🇬🇷" },
  HR: { label: "Croatia", flag: "🇭🇷" },
  CY: { label: "Cyprus", flag: "🇨🇾" },
  LU: { label: "Luxembourg", flag: "🇱🇺" },
  LI: { label: "Liechtenstein", flag: "🇱🇮" },
  MC: { label: "Monaco", flag: "🇲🇨" },
  MT: { label: "Malta", flag: "🇲🇹" },
  RU: { label: "Russia", flag: "🇷🇺" },
  UA: { label: "Ukraine", flag: "🇺🇦" },
  TR: { label: "Turkey", flag: "🇹🇷" },
  IL: { label: "Israel", flag: "🇮🇱" },
  AE: { label: "United Arab Emirates", flag: "🇦🇪" },
  SA: { label: "Saudi Arabia", flag: "🇸🇦" },
  QA: { label: "Qatar", flag: "🇶🇦" },
  JO: { label: "Jordan", flag: "🇯🇴" },
  OM: { label: "Oman", flag: "🇴🇲" },
  EG: { label: "Egypt", flag: "🇪🇬" },
  MA: { label: "Morocco", flag: "🇲🇦" },
  ZA: { label: "South Africa", flag: "🇿🇦" },
  GH: { label: "Ghana", flag: "🇬🇭" },
  NG: { label: "Nigeria", flag: "🇳🇬" },
  KE: { label: "Kenya", flag: "🇰🇪" },
  IN: { label: "India", flag: "🇮🇳" },
  CN: { label: "China", flag: "🇨🇳" },
  HK: { label: "Hong Kong", flag: "🇭🇰" },
  SG: { label: "Singapore", flag: "🇸🇬" },
  JP: { label: "Japan", flag: "🇯🇵" },
  KR: { label: "South Korea", flag: "🇰🇷" },
  TW: { label: "Taiwan", flag: "🇹🇼" },
  MY: { label: "Malaysia", flag: "🇲🇾" },
  TH: { label: "Thailand", flag: "🇹🇭" },
  VN: { label: "Vietnam", flag: "🇻🇳" },
  ID: { label: "Indonesia", flag: "🇮🇩" },
  PH: { label: "Philippines", flag: "🇵🇭" },
  PK: { label: "Pakistan", flag: "🇵🇰" },
  BD: { label: "Bangladesh", flag: "🇧🇩" },
  NP: { label: "Nepal", flag: "🇳🇵" },
  KZ: { label: "Kazakhstan", flag: "🇰🇿" },
  AZ: { label: "Azerbaijan", flag: "🇦🇿" },
  AU: { label: "Australia", flag: "🇦🇺" },
  NZ: { label: "New Zealand", flag: "🇳🇿" },
  BR: { label: "Brazil", flag: "🇧🇷" },
  MX: { label: "Mexico", flag: "🇲🇽" },
  AR: { label: "Argentina", flag: "🇦🇷" },
  CL: { label: "Chile", flag: "🇨🇱" },
  CO: { label: "Colombia", flag: "🇨🇴" },
  PE: { label: "Peru", flag: "🇵🇪" },
  UY: { label: "Uruguay", flag: "🇺🇾" },
  PA: { label: "Panama", flag: "🇵🇦" },
  AL: { label: "Albania", flag: "🇦🇱" },
  RS: { label: "Serbia", flag: "🇷🇸" },
  ME: { label: "Montenegro", flag: "🇲🇪" },
  MK: { label: "North Macedonia", flag: "🇲🇰" },
  MU: { label: "Mauritius", flag: "🇲🇺" },
};

// Extra alias spellings that don't fall out of the label slugging below.
const ALIASES: Record<string, string> = {
  usa: "US",
  "u-s": "US",
  "u-s-a": "US",
  america: "US",
  "united-states-of-america": "US",
  uk: "GB",
  "u-k": "GB",
  britain: "GB",
  "great-britain": "GB",
  england: "GB",
  uae: "AE",
  "u-a-e": "AE",
  emirates: "AE",
  dubai: "AE",
  "abu-dhabi": "AE",
  "hong-kong": "HK",
  "south-korea": "KR",
  korea: "KR",
  "czech-republic": "CZ",
  "the-netherlands": "NL",
  holland: "NL",
};

const GLOBE = "🌐";

function slug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Reverse index: label-slug → code, built once.
const BY_LABEL_SLUG: Record<string, string> = {};
for (const [code, meta] of Object.entries(BY_CODE)) {
  BY_LABEL_SLUG[slug(meta.label)] = code;
}

/**
 * Resolve any country input (ISO-2, slug, or full name) to a display label,
 * emoji flag, and code. Unknown input still renders sensibly: it echoes the
 * cleaned label with a globe.
 */
export function resolveCountry(input: string | null | undefined): ResolvedCountry | null {
  if (!input) return null;
  const raw = input.trim();
  if (!raw) return null;

  const upper = raw.toUpperCase();
  if (BY_CODE[upper]) return { ...BY_CODE[upper], code: upper };

  const s = slug(raw);
  const viaAlias = ALIASES[s];
  if (viaAlias && BY_CODE[viaAlias]) return { ...BY_CODE[viaAlias], code: viaAlias };

  const viaLabel = BY_LABEL_SLUG[s];
  if (viaLabel && BY_CODE[viaLabel]) return { ...BY_CODE[viaLabel], code: viaLabel };

  // Unknown — present the input as a Title-Cased label with a neutral globe.
  const label = raw
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return { label, flag: GLOBE, code: null };
}

export function countryFlag(input: string | null | undefined): string {
  return resolveCountry(input)?.flag ?? GLOBE;
}
