import { TEAM_NAMES, COO_NAME } from './names';

/* ============================================================================
 * cognition-copy — operator-voice copy for the Cognition `handing_off` phase.
 *
 * Phase 5 will wire the actual `route_to_specialist` tool. This module
 * already supplies the human-readable line that appears in EarnCognition
 * when the lifecycle is in `handing_off`, so the phase 5 work has nothing
 * to do here except call the existing helper.
 *
 * Voice rule: operator-grade, sentence case, no hype. One verb across all
 * slugs ("is reviewing this.") for v1 so the bar stays clean. Phase 5 can
 * refine the verb pool if hand-off semantics warrant it.
 *
 * This file READS from the (pure) `names.ts` mirror of the frozen roster —
 * it does NOT modify the roster itself.
 * ========================================================================= */

/** Pull the first name from a roster display name. Falls back to the full
 *  display if the name does not split cleanly (e.g. "Earnest Fundmaker"
 *  becomes "Earnest"). */
function firstName(displayName: string): string {
  return displayName.split(/\s+/)[0] || displayName;
}

/**
 * Operator-voice copy for the `handing_off` Cognition phase.
 *
 * Examples:
 *   handOffLine('master-workflow')   → "Sterling is reviewing this."
 *   handOffLine('executive-advisor') → "Theodore is reviewing this."
 *   handOffLine('unknown-slug')      → "Earnest is routing this." (safe fallback)
 *
 * Phase 5 may swap the verb depending on `kind` (review vs check vs pull).
 * Keeping a single verb in v1 minimizes copywriting decisions and matches
 * the institutional bar.
 */
export function handOffLine(slug: string | null | undefined): string {
  if (!slug) return `${firstName(COO_NAME)} is routing this.`;
  const displayName = TEAM_NAMES[slug];
  if (!displayName) return `${firstName(COO_NAME)} is routing this.`;
  return `${firstName(displayName)} is reviewing this.`;
}

/**
 * Resolve a slug to a TeamMember for renderer-side avatar lookup. Imported
 * lazily by EarnCognition (client-only), NOT by the test, so the test stays
 * free of the lucide-react transitive import that roster.ts pulls in.
 */
export async function loadResolveSpecialist() {
  const mod = await import('./roster');
  return mod.getMember;
}
