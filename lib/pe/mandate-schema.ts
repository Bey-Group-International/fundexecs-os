// lib/pe/mandate-schema.ts
// JSON-Schema fragments for the mandate tests and the deal facts, shared by the
// three sourcing skills so their input contracts cannot drift apart.

import type { JsonSchema } from "@/lib/skills/types";
import { NUMERIC_METRICS, TEXT_METRICS } from "./mandate-tests";

const METRICS = [...NUMERIC_METRICS, ...TEXT_METRICS];
const strList: JsonSchema = { type: "array", items: { type: "string" } };
const band: JsonSchema = { type: "object", properties: { min: { type: "number" }, max: { type: "number" } } };

export const mandateTestsSchema: JsonSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["approved", "draft"] },
    approvedBy: { type: "string" },
    hardLimits: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "label", "metric"],
        properties: {
          id: { type: "string", minLength: 1 },
          label: { type: "string", minLength: 1 },
          metric: { type: "string", enum: METRICS },
          band,
          allow: strList,
          deny: strList,
          source: { type: "string" },
        },
      },
    },
    preferences: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "label", "metric", "weight"],
        properties: {
          id: { type: "string", minLength: 1 },
          label: { type: "string", minLength: 1 },
          metric: { type: "string", enum: METRICS },
          strong: band,
          acceptable: band,
          strongValues: strList,
          acceptableValues: strList,
          weight: { type: "number", minimum: 0 },
        },
      },
    },
    killFacts: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "label"],
        properties: {
          id: { type: "string", minLength: 1 },
          label: { type: "string", minLength: 1 },
          metric: { type: "string", enum: [...NUMERIC_METRICS] },
          above: { type: "number" },
          below: { type: "number" },
          flag: { type: "boolean" },
        },
      },
    },
  },
};

/** The deal facts a criterion may test (all optional — absence means needs-data). */
export const dealFactsProperties: Record<string, JsonSchema> = {
  ebitda: { type: "number" },
  revenue: { type: "number" },
  revenueCagr3y: { type: "number" },
  ebitdaMargin: { type: "number" },
  recurringRevenuePct: { type: "number", minimum: 0, maximum: 100 },
  topCustomerPct: { type: "number", minimum: 0, maximum: 100 },
  equityChequePct: { type: "number", minimum: 0, maximum: 100 },
  ownershipPct: { type: "number", minimum: 0, maximum: 100 },
  sector: { type: "string" },
  geography: { type: "string" },
  dealType: { type: "string" },
  killFlags: strList,
};
