// lib/pe/reporting-style.ts
// The firm's reporting style (root-reporting) for the quarterly LP update: the
// currency and units NAV is stated in, how many decimals the figures carry, and the
// firm's own labels for the four metrics. Pure.
//
// This is presentation only. It never converts, rescales or rounds a figure into a
// different value than the one supplied: "units" is a label that says what the
// supplied number is in, and "decimals" only controls how many decimals are shown.

export const REPORT_METRICS = ["nav", "dpi", "tvpi", "netIrr"] as const;
export type ReportMetric = (typeof REPORT_METRICS)[number];

export const MAX_STYLE_WORD_CHARS = 12;
export const MAX_LABEL_CHARS = 40;
export const MAX_DECIMALS = 4;

export interface ReportingStyle {
  /** Shown before NAV, e.g. "USD". */
  currency?: string;
  /** What the NAV figure is in, e.g. "m" or "million". A single character attaches ("12.3m"); a word is spaced ("12.3 million"). */
  units?: string;
  /** Decimal places for every metric. Unset = the figure as supplied. */
  decimals?: number;
  labels?: Partial<Record<ReportMetric, string>>;
}

export interface ReportingStyleParse {
  style: ReportingStyle | null;
  /** One line per value that was dropped, with the reason. */
  dropped: string[];
}

function word(v: unknown, name: string, dropped: string[]): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") {
    dropped.push(`${name}: must be text.`);
    return undefined;
  }
  const t = v.trim();
  if (!t) return undefined;
  if (t.length > MAX_STYLE_WORD_CHARS) {
    dropped.push(`${name}: over ${MAX_STYLE_WORD_CHARS} characters.`);
    return undefined;
  }
  return t;
}

/** Defensive parse. style is null when nothing usable survives. Never throws. */
export function parseReportingStyle(raw: unknown): ReportingStyleParse {
  const none: ReportingStyleParse = { style: null, dropped: [] };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return none;
  const o = raw as Record<string, unknown>;
  const dropped: string[] = [];
  const style: ReportingStyle = {};

  const currency = word(o.currency, "currency", dropped);
  const units = word(o.units, "units", dropped);
  if (currency) style.currency = currency;
  if (units) style.units = units;

  if (o.decimals !== undefined && o.decimals !== null) {
    const d = o.decimals;
    if (typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= MAX_DECIMALS) style.decimals = d;
    else dropped.push(`decimals: must be a whole number from 0 to ${MAX_DECIMALS}.`);
  }

  const l = o.labels;
  if (l && typeof l === "object" && !Array.isArray(l)) {
    const labels: NonNullable<ReportingStyle["labels"]> = {};
    for (const [k, v] of Object.entries(l as Record<string, unknown>)) {
      if (!(REPORT_METRICS as readonly string[]).includes(k)) {
        dropped.push(`labels.${k}: unknown metric (known: ${REPORT_METRICS.join(", ")}).`);
        continue;
      }
      if (typeof v !== "string" || !v.trim()) continue;
      if (v.trim().length > MAX_LABEL_CHARS) {
        dropped.push(`labels.${k}: over ${MAX_LABEL_CHARS} characters.`);
        continue;
      }
      labels[k as ReportMetric] = v.trim();
    }
    if (Object.keys(labels).length) style.labels = labels;
  }

  return { style: Object.keys(style).length ? style : null, dropped };
}

const fixed = (v: number, style: ReportingStyle | null | undefined): string => (style?.decimals !== undefined ? v.toFixed(style.decimals) : String(v));

/** One performance line, in the firm's style when one is set (identical to the standing format otherwise). */
export function formatMetricLine(metric: ReportMetric, value: number, style?: ReportingStyle | null): string {
  const label = style?.labels?.[metric] ?? { nav: "NAV", dpi: "DPI", tvpi: "TVPI", netIrr: "Net IRR" }[metric];
  if (metric === "nav") {
    const unit = style?.units ? (style.units.length === 1 ? style.units : ` ${style.units}`) : "";
    return `${label}: ${style?.currency ? `${style.currency} ` : ""}${fixed(value, style)}${unit}`;
  }
  if (metric === "netIrr") return `${label}: ${fixed(value, style)}%`;
  return `${label}: ${fixed(value, style)}x`;
}
