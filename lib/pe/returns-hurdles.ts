// lib/pe/returns-hurdles.ts
// The firm's return hurdles (root-returns) as numbers, plus the standing defaults
// used when an org has not set its own. Pure. IRR is a decimal (0.2 = 20%).

export interface Hurdle {
  irr?: number;
  moic?: number;
}

export interface ReturnsHurdles {
  base: Hurdle;
  /** Absent = the firm sets no downside hurdle; downside is then reported, not tested. */
  downside?: Hurdle;
  holdYears: number;
}

/** Standing settings for a generic mid-market buyout fund. NOT any firm's numbers. */
export const DEFAULT_RETURNS: ReturnsHurdles = { base: { irr: 0.2, moic: 2.5 }, holdYears: 5 };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);

function parseHurdle(v: unknown): Hurdle | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const h: Hurdle = {};
  const irr = num(o.irr);
  const moic = num(o.moic);
  if (irr !== undefined) h.irr = irr;
  if (moic !== undefined) h.moic = moic;
  return h.irr !== undefined || h.moic !== undefined ? h : undefined;
}

/** Defensive parse of stored jsonb. Returns null when no usable base hurdle survives. Never throws. */
export function parseReturnsHurdles(raw: unknown): ReturnsHurdles | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const base = parseHurdle(o.base);
  if (!base) return null;
  return { base, downside: parseHurdle(o.downside), holdYears: num(o.holdYears) ?? DEFAULT_RETURNS.holdYears };
}

export type HurdleVerdict = "clears" | "misses" | "not-tested";

/** Compare computed returns to a hurdle. Every stated threshold must be met. */
export function testHurdle(h: Hurdle | undefined, irr: number | null, moic: number | null): HurdleVerdict {
  if (!h) return "not-tested";
  const checks: boolean[] = [];
  if (h.irr !== undefined) {
    if (irr === null) return "not-tested";
    checks.push(irr >= h.irr);
  }
  if (h.moic !== undefined) {
    if (moic === null) return "not-tested";
    checks.push(moic >= h.moic);
  }
  return checks.length === 0 ? "not-tested" : checks.every(Boolean) ? "clears" : "misses";
}
