// lib/skills/labels.ts
// Display labels for skills, derived from the registry so they never drift from
// the manifests. Safe to import from client components (no server-only deps).
import { listSkillManifests } from "./registry";

export const SKILL_LABELS: Record<string, string> = Object.fromEntries(
  listSkillManifests().map((m) => [m.id, m.name]),
);
