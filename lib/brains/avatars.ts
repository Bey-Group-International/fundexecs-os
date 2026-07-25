// lib/brains/avatars.ts
// Presentation mapping: each FundExecs virtual-office avatar (a persona sprite in
// public/office/map.html) → the Brain that powers it. This is a VIEW over the
// existing Brain stack (lib/brains/catalog.ts), NOT a new taxonomy — every
// non-null brainKey here must resolve in BRAINS. It exists so the office avatars
// can be wired to their brains (e.g. the LIVING-EXECS `attachBrain` slow-loop;
// see docs/avatars/AVATAR_SYSTEM_SPEC.md).
//
// Roster ids and statuses mirror public/office/map.html `PEOPLE`. Two avatars
// have no per-Brain corpus: the Office Manager (front-of-house host) and the
// Workflow Instructor (which fronts the OS orchestration layer in
// lib/brains/workflow/, not a single Brain).

import type { BrainKey } from "@/lib/brains/types";

export type AvatarStatus = "available" | "busy" | "away" | "dnd";

export interface AvatarBrainLink {
  /** Office roster id (map.html `PEOPLE[].id`). */
  id: string;
  /** Sprite atlas key: `public/assets/fundexecs/characters/<sprite>/walk.png`. */
  sprite: string;
  /** Display role label shown in the office. */
  role: string;
  /** The Brain powering this avatar, or `null` if it has no dedicated Brain. */
  brainKey: BrainKey | null;
  /** Presence status seeded in the office roster. */
  status: AvatarStatus;
  /** Optional note (e.g. orchestration-layer or mascot avatars). */
  note?: string;
}

export const AVATAR_BRAINS: AvatarBrainLink[] = [
  { id: "om",  sprite: "office-manager",      role: "Office Manager",      brainKey: null,                 status: "available", note: "Front-of-house host; no dedicated Brain corpus." },
  { id: "ea",  sprite: "executive-advisor",   role: "Executive Advisor",   brainKey: "executive_advisor",  status: "busy" },
  { id: "ds",  sprite: "deal-sourcer",        role: "Deal Sourcer",        brainKey: "deal_sourcer",       status: "available" },
  { id: "lg",  sprite: "lead-generator",      role: "Lead Generator",      brainKey: "funnel_lead_gen",    status: "available" },
  { id: "seo", sprite: "seo-disruptor",       role: "SEO Disruptor",       brainKey: "seo_disrupter",      status: "busy" },
  { id: "au",  sprite: "automater",           role: "Automater",           brainKey: "automater_scrubber", status: "available" },
  { id: "wf",  sprite: "workflow-instructor", role: "Workflow Instructor", brainKey: null,                 status: "away",      note: "Fronts the OS orchestration layer (lib/brains/workflow/workflow_instructor.md), not a single Brain." },
  { id: "la",  sprite: "legal-admin",         role: "Legal Admin",         brainKey: "legal_admin",        status: "available" },
  { id: "cu",  sprite: "curator",             role: "Curator",             brainKey: "event_curator",      status: "available" },
  { id: "pr",  sprite: "pr-director",         role: "PR Director",         brainKey: "marketing_pr",       status: "busy" },
  { id: "ir",  sprite: "investor-relations",  role: "Investor Relations",  brainKey: "investor_relations", status: "available" },
  { id: "cc",  sprite: "capital-connector",   role: "Capital Connector",   brainKey: "capital_connector",  status: "available" },
  { id: "rm",  sprite: "rainmaker",           role: "Rainmaker",           brainKey: "rainmaker",          status: "available" },
  { id: "cr",  sprite: "capital-raiser",      role: "Capital Raiser",      brainKey: "capital_raiser",     status: "available" },
  { id: "er",  sprite: "earn",                role: "Earn",                brainKey: "earnest_fundmaker",  status: "available", note: "The Earn coin mascot is fronted by the Earnest Fundmaker Brain." },
];

export const AVATAR_BRAIN_BY_ID: Record<string, AvatarBrainLink> = Object.fromEntries(
  AVATAR_BRAINS.map((a) => [a.id, a]),
);

export const AVATAR_BRAIN_BY_SPRITE: Record<string, AvatarBrainLink> = Object.fromEntries(
  AVATAR_BRAINS.map((a) => [a.sprite, a]),
);

/** The BrainKey powering an avatar (by roster id or sprite key), or null. */
export function brainForAvatar(idOrSprite: string): BrainKey | null {
  return (AVATAR_BRAIN_BY_ID[idOrSprite] ?? AVATAR_BRAIN_BY_SPRITE[idOrSprite])?.brainKey ?? null;
}
