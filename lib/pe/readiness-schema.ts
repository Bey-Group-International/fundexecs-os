// lib/pe/readiness-schema.ts — JSON-Schema fragments shared by the exit- and IPO-readiness skills.
import type { JsonSchema } from "@/lib/skills/types";

export const readinessItemSchema: JsonSchema = {
  type: "object",
  required: ["id", "area", "requirement", "status"],
  properties: {
    id: { type: "string", minLength: 1 },
    area: { type: "string", minLength: 1 },
    requirement: { type: "string", minLength: 1 },
    status: { type: "string", enum: ["met", "partial", "gap", "unknown"] },
    evidence: { type: "string" },
    sourceRule: { type: "string" },
    owner: { type: "string" },
    dueDate: { type: "string" },
    weeksToClose: { type: "number", minimum: 0 },
    costToClose: { type: "number", minimum: 0 },
    critical: { type: "boolean" },
  },
};

export const readinessResultSchema: JsonSchema = {
  type: "object",
  required: ["items", "counts", "ready", "blockers"],
  properties: {
    items: { type: "array", items: { type: "object", required: ["id", "area", "requirement", "status", "effectiveStatus", "flags"] } },
    counts: { type: "object" },
    ready: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    weeksIfParallel: { type: "number" },
    weeksIfSerial: { type: "number" },
    totalCostToClose: { type: "number" },
    untimed: { type: "array", items: { type: "string" } },
  },
};
