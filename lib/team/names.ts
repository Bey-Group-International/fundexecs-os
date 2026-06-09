/* ============================================================================
 * team/names — pure slug → display-name map.
 *
 * Lives alongside the frozen `roster.ts` so consumers that only need names
 * (operator-voice copy, slug-to-string rendering, etc.) can avoid the
 * transitive `lucide-react` import that the full roster brings in for
 * avatar icons. The data here MUST mirror `roster.ts`; the unit test for
 * `cognition-copy` exercises the well-known slugs and will trip if the two
 * fall out of sync.
 *
 * Adding a new specialist (phase 5+):
 *   1. Add the slug + display name to `roster.ts` (the source of truth).
 *   2. Mirror the slug + name to TEAM_NAMES below.
 *   3. The test in `lib/motion/cognition-lifecycle.test.ts` should still pass.
 * ========================================================================= */

/** The 15-strong desk, slug → display name. Mirrors `roster.ts`. */
export const TEAM_NAMES: Record<string, string> = {
  // Leadership
  'earnest-fundmaker': 'Earnest Fundmaker',
  'master-workflow': 'Sterling Holt',
  automater: 'Dalia Vance',
  'executive-advisor': 'Theodore Pace',
  // Capital
  rainmaker: 'Vivian Cross',
  'deal-sourcer': 'Marcus Whitlock',
  'capital-connector': 'Priya Daksh',
  // Narrative
  'legal-admin': 'Adrian Knox',
  'pr-director': 'Sienna Wells',
  'seo-disruptor': 'Noah Reyes',
  // Sourcing
  'lead-generator': 'Camille Roux',
  'event-curator': 'Jasper Lane',
  // Capital (continued)
  'investor-relations': 'Eleanor Marsh',
  'capital-raiser': 'Sloane Hartley',
  // Enablement
  'workflow-instructor': 'Felix Aurelio'
};

/** The COO's display name. Used as the fallback voice when no specialist is
 *  named (e.g. an unknown slug). */
export const COO_NAME = TEAM_NAMES['earnest-fundmaker'];
