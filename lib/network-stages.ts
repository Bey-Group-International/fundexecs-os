// lib/network-stages.ts
//
// The capital-formation stage vocabulary, and nothing else.
//
// This lives apart from lib/network-active.ts on purpose. Client components
// need these values, and network-active reaches into the capital map and the
// sourcing-signals module, which pulls the Anthropic SDK — and therefore
// node:path — into any bundle that imports it. A value import of a stage
// constant should not drag the server engine into the browser.

export const CONTACT_STAGES = [
  "prospect",
  "engaged",
  "diligence",
  "committed",
  "dormant",
  "passed",
] as const;

export type ContactStage = (typeof CONTACT_STAGES)[number];

export const STAGE_LABEL: Record<ContactStage, string> = {
  prospect: "Prospect",
  engaged: "Engaged",
  diligence: "Diligence",
  committed: "Committed",
  dormant: "Dormant",
  passed: "Passed",
};

export function isContactStage(v: unknown): v is ContactStage {
  return typeof v === "string" && (CONTACT_STAGES as readonly string[]).includes(v);
}
