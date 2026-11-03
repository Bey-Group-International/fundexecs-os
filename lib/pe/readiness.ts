// lib/pe/readiness.ts
// A shared readiness-checklist engine for exit and IPO readiness. Pure.
//   * "met" counts only with evidence — a met claim with none is "unverified";
//   * a gap or partial must carry an owner and a date, or it is flagged;
//   * critical-path time is reported BOTH ways (if closed in parallel, if in
//     series) — the engine does not pick the optimistic one for you;
//   * "unknown" is never read as "met".

export type ReadinessStatus = "met" | "partial" | "gap" | "unknown";

export interface ReadinessItemIn {
  id: string;
  area: string;
  requirement: string;
  status: ReadinessStatus;
  /** Document / data that proves a "met" status. */
  evidence?: string;
  /** The rule or standard the requirement comes from (required for listing requirements). */
  sourceRule?: string;
  owner?: string;
  dueDate?: string;
  /** Estimated weeks to close a gap or partial. */
  weeksToClose?: number;
  costToClose?: number;
  /** A launch blocker if not met. Default true. */
  critical?: boolean;
}

export interface ReadinessItemOut extends ReadinessItemIn {
  effectiveStatus: ReadinessStatus | "unverified";
  flags: string[];
}

export interface ReadinessResult {
  items: ReadinessItemOut[];
  counts: Record<"met" | "partial" | "gap" | "unknown" | "unverified", number>;
  ready: boolean;
  blockers: string[];
  weeksIfParallel: number | null;
  weeksIfSerial: number | null;
  totalCostToClose: number | null;
  /** Items whose weeksToClose is missing, so the timing is incomplete. */
  untimed: string[];
}

export function assessReadiness(items: ReadinessItemIn[], opts: { requireSourceRule?: boolean } = {}): ReadinessResult {
  const out: ReadinessItemOut[] = items.map((it) => {
    const flags: string[] = [];
    let effective: ReadinessItemOut["effectiveStatus"] = it.status;
    if (it.status === "met" && !it.evidence?.trim()) {
      effective = "unverified";
      flags.push("Marked met but no evidence cited — treated as unverified.");
    }
    if ((it.status === "gap" || it.status === "partial") && (!it.owner?.trim() || !it.dueDate?.trim())) {
      flags.push("Open item without " + [!it.owner?.trim() ? "an owner" : "", !it.dueDate?.trim() ? "a date" : ""].filter(Boolean).join(" or ") + ".");
    }
    if ((it.status === "gap" || it.status === "partial") && it.weeksToClose === undefined) flags.push("No time-to-close estimate.");
    if (opts.requireSourceRule && !it.sourceRule?.trim()) flags.push("Requirement cites no source rule.");
    return { ...it, effectiveStatus: effective, flags };
  });

  const counts = { met: 0, partial: 0, gap: 0, unknown: 0, unverified: 0 };
  for (const o of out) counts[o.effectiveStatus]++;

  const critical = (o: ReadinessItemOut) => o.critical !== false;
  const blockers = out.filter((o) => critical(o) && o.effectiveStatus !== "met").map((o) => `${o.area}: ${o.requirement} (${o.effectiveStatus})`);

  const open = out.filter((o) => o.status === "gap" || o.status === "partial");
  const timed = open.filter((o) => typeof o.weeksToClose === "number");
  const weeksIfParallel = timed.length ? Math.max(...timed.map((o) => o.weeksToClose as number)) : open.length ? null : 0;
  const weeksIfSerial = timed.length ? timed.reduce((s, o) => s + (o.weeksToClose as number), 0) : open.length ? null : 0;
  const costed = open.filter((o) => typeof o.costToClose === "number");
  const totalCostToClose = costed.length ? costed.reduce((s, o) => s + (o.costToClose as number), 0) : open.length ? null : 0;

  return {
    items: out,
    counts,
    ready: blockers.length === 0 && out.length > 0,
    blockers,
    weeksIfParallel,
    weeksIfSerial,
    totalCostToClose,
    untimed: open.filter((o) => typeof o.weeksToClose !== "number").map((o) => o.id),
  };
}
