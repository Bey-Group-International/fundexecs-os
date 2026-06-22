// lib/sla-cron.test.ts — unit tests for the PURE selectEscalations selector
// (no DB). Mirrors the deterministic-`now` style of engine-sla.test.ts.
import { selectEscalations, DEFAULT_ESCALATION_CAP } from "./sla-cron";
import { DEFAULT_SLA_HOURS } from "./engine-sla";
import type { GridWorkflow } from "./execution-grid";

// Fixed reference point so all age math is deterministic.
const NOW = new Date("2026-06-22T12:00:00Z");

function wf(partial: Partial<GridWorkflow> & { id: string } & ({ hoursAgo: number } | { created_at: string })): GridWorkflow {
  const created_at =
    "created_at" in partial && partial.created_at !== undefined
      ? partial.created_at
      : new Date(NOW.getTime() - (partial as { hoursAgo: number }).hoursAgo * 3600_000).toISOString();
  return {
    id: partial.id,
    title: partial.title ?? partial.id,
    status: partial.status ?? "in_progress",
    session_id: partial.session_id ?? null,
    created_at,
    hub: partial.hub ?? ("source" as GridWorkflow["hub"]),
    description: partial.description ?? null,
    lifecycle_stage: partial.lifecycle_stage ?? null,
    target_engine: partial.target_engine ?? null,
  };
}

const NONE = new Set<string>();

describe("selectEscalations", () => {
  it("excludes workflows under the SLA threshold", () => {
    const list = [wf({ id: "fresh", status: "in_progress", hoursAgo: 10 })];
    expect(selectEscalations(list, NONE, NOW)).toEqual([]);
  });

  it("selects active workflows over the SLA threshold", () => {
    const list = [wf({ id: "stuck", status: "in_progress", hoursAgo: DEFAULT_SLA_HOURS + 1 })];
    expect(selectEscalations(list, NONE, NOW)).toEqual(["stuck"]);
  });

  it("excludes workflows already escalated", () => {
    const list = [
      wf({ id: "a", status: "awaiting_approval", hoursAgo: 200 }),
      wf({ id: "b", status: "in_progress", hoursAgo: 200 }),
    ];
    expect(selectEscalations(list, new Set(["a"]), NOW)).toEqual(["b"]);
  });

  it("excludes terminal / non-active statuses however old", () => {
    const list = [
      wf({ id: "done", status: "completed", hoursAgo: 1000 }),
      wf({ id: "failed", status: "failed", hoursAgo: 1000 }),
      wf({ id: "cancelled", status: "cancelled", hoursAgo: 1000 }),
      wf({ id: "blocked", status: "blocked", hoursAgo: 1000 }),
    ];
    expect(selectEscalations(list, NONE, NOW)).toEqual([]);
  });

  it("flags all active statuses, preserving input order", () => {
    const list = [
      wf({ id: "approval", status: "awaiting_approval", hoursAgo: 200 }),
      wf({ id: "progress", status: "in_progress", hoursAgo: 200 }),
      wf({ id: "pending", status: "pending", hoursAgo: 200 }),
    ];
    expect(selectEscalations(list, NONE, NOW)).toEqual(["approval", "progress", "pending"]);
  });

  it("honours a custom threshold", () => {
    const list = [wf({ id: "c", status: "pending", hoursAgo: 5 })];
    expect(selectEscalations(list, NONE, NOW, { thresholdHours: 4 })).toEqual(["c"]);
    expect(selectEscalations(list, NONE, NOW, { thresholdHours: 6 })).toEqual([]);
  });

  it("caps the number of escalations (custom cap)", () => {
    const list = Array.from({ length: 5 }, (_, i) =>
      wf({ id: `w${i}`, status: "in_progress", hoursAgo: 200 }),
    );
    expect(selectEscalations(list, NONE, NOW, { cap: 2 })).toEqual(["w0", "w1"]);
  });

  it("applies the default cap", () => {
    const list = Array.from({ length: DEFAULT_ESCALATION_CAP + 5 }, (_, i) =>
      wf({ id: `w${i}`, status: "in_progress", hoursAgo: 200 }),
    );
    const selected = selectEscalations(list, NONE, NOW);
    expect(selected).toHaveLength(DEFAULT_ESCALATION_CAP);
    expect(selected[0]).toBe("w0");
  });

  it("is null-safe on bad timestamps", () => {
    const list = [wf({ id: "bad", status: "in_progress", created_at: "not-a-date" })];
    expect(selectEscalations(list, NONE, NOW)).toEqual([]);
  });
});
