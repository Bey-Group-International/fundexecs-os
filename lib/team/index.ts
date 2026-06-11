/**
 * `lib/team` — single source of truth for The Team identity (roster, avatar
 * palette helpers, and agent capabilities) used across the platform.
 *
 * Backend-safe re-exports only. The visual `<TeamAvatar />` renderer lived here
 * previously; it moves with the frontend layer. Slugs are 1:1 with
 * `ai_brains.slug` in the live DB — do not rename them.
 */

export {
  TEAM_ROSTER,
  getCOO,
  getSpecialists,
  getMember,
  getMemberOrCOO,
  getMemberByFirstName
} from './roster';
export type { TeamMember, TeamGroup, TeamDiscColor } from './roster';
export {
  gradientForSlug,
  avatarSvgForSlug,
  initialsForName,
  discColorsFor,
  DISC_PALETTE
} from './avatar';
export type { GradientStops, DiscPaletteKey } from './avatar';
export { AGENT_CAPABILITIES, proposalForTask } from './capabilities';
export type { AgentCapability, TaskProposal } from './capabilities';
