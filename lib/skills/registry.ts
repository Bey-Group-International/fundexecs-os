// lib/skills/registry.ts
// The native skill registry — the pluggable seam (mirrors lib/agents.ts and the
// intelligence provider registry). A new skill is added by implementing a
// SkillDefinition and registering it here. The registry is a TypeScript catalog
// (dependency-free, statically typed); the authoring spec for each skill lives
// under /skills/<id>/ (SKILL.md, skill.yaml, *.schema.json) and a test asserts
// the two stay consistent.

import type { SkillDefinition, SkillManifest } from "./types";
import { screenDeal } from "./catalog/screen-deal";

const SKILLS: Record<string, SkillDefinition> = {
  [screenDeal.manifest.id]: screenDeal as SkillDefinition,
};

export function getSkill(id: string): SkillDefinition | null {
  return SKILLS[id] ?? null;
}

export function listSkills(): SkillDefinition[] {
  return Object.values(SKILLS);
}

export function listSkillManifests(): SkillManifest[] {
  return Object.values(SKILLS).map((s) => s.manifest);
}
