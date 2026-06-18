// A tiny, dependency-free cron evaluator for schedule triggers.
//
// We deliberately don't pull an npm cron library: the core system runs natively
// (per AGENT.md), and "when does this 5-field expression next fire" is a small,
// well-bounded utility. Expressions are evaluated in UTC.
//
// Supported per field: `*`, `*/n`, `a-b` ranges, `a,b,c` lists, and integers.
// Fields: minute hour day-of-month month day-of-week (0=Sunday..6=Saturday).

const FIELD_BOUNDS: [min: number, max: number][] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week
];

// Expand one cron field into the set of values it matches.
function parseField(field: string, idx: number): Set<number> | "error" {
  const [lo, hi] = FIELD_BOUNDS[idx];
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) return "error";

    let start = lo;
    let end = hi;
    if (rangePart !== "*") {
      const bounds = rangePart.split("-");
      start = Number(bounds[0]);
      end = bounds.length > 1 ? Number(bounds[1]) : start;
      if (!Number.isInteger(start) || !Number.isInteger(end)) return "error";
      if (start < lo || end > hi || start > end) return "error";
    }
    for (let v = start; v <= end; v += step) values.add(v);
  }
  return values.size ? values : "error";
}

interface ParsedCron {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
}

export function parseCron(expr: string): ParsedCron | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const sets = fields.map((f, i) => parseField(f, i));
  if (sets.some((s) => s === "error")) return null;
  const [minute, hour, dom, month, dow] = sets as Set<number>[];
  return { minute, hour, dom, month, dow };
}

export function isValidCron(expr: string): boolean {
  return parseCron(expr) !== null;
}

/**
 * The next UTC instant at or after `after` (exclusive) that matches `expr`.
 * Returns null for an invalid expression or if nothing matches within a year
 * (a guard against impossible day/month combinations).
 */
export function nextRun(expr: string, after: Date = new Date()): Date | null {
  const cron = parseCron(expr);
  if (!cron) return null;

  // Start at the next whole minute; cron granularity is one minute.
  const d = new Date(after);
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(d.getUTCMinutes() + 1);

  const limit = new Date(d);
  limit.setUTCFullYear(limit.getUTCFullYear() + 1);

  while (d <= limit) {
    const monthOk = cron.month.has(d.getUTCMonth() + 1);
    const domOk = cron.dom.has(d.getUTCDate());
    const dowOk = cron.dow.has(d.getUTCDay());
    const hourOk = cron.hour.has(d.getUTCHours());
    const minuteOk = cron.minute.has(d.getUTCMinutes());
    // POSIX cron day semantics: if one of day-of-month / day-of-week is `*`, the
    // other governs; if BOTH are restricted, either match is sufficient (OR).
    const domWild = cron.dom.size === FIELD_BOUNDS[2][1] - FIELD_BOUNDS[2][0] + 1;
    const dowWild = cron.dow.size === FIELD_BOUNDS[4][1] - FIELD_BOUNDS[4][0] + 1;
    const dayOk = domWild ? dowOk : dowWild ? domOk : domOk || dowOk;
    if (monthOk && dayOk && hourOk && minuteOk) return d;
    d.setUTCMinutes(d.getUTCMinutes() + 1);
  }
  return null;
}

// User-facing schedule presets, so the UI never asks an operator to hand-write
// cron. Times are UTC. The schema still stores a raw cron string, so custom
// expressions remain possible later.
export interface SchedulePreset {
  value: string; // cron expression
  label: string;
}

export const SCHEDULE_PRESETS: SchedulePreset[] = [
  { value: "0 * * * *", label: "Hourly" },
  { value: "0 13 * * *", label: "Daily · 9am ET (13:00 UTC)" },
  { value: "0 13 * * 1", label: "Weekly · Mon 9am ET" },
  { value: "0 13 * * 5", label: "Weekly · Fri 9am ET" },
  { value: "0 13 1 * *", label: "Monthly · 1st 9am ET" },
];

const PRESET_LABELS = new Map(SCHEDULE_PRESETS.map((p) => [p.value, p.label]));

export function describeSchedule(expr: string | null): string {
  if (!expr) return "—";
  return PRESET_LABELS.get(expr) ?? expr;
}
