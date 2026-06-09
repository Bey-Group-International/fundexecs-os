/**
 * `lib/team` — single source of truth for The Team identity used across every
 * authenticated FundExecs OS surface AND the public landing. Re-exports:
 *
 *   - `TEAM_ROSTER`, `getCOO`, `getSpecialists`, `getMember`, `getMemberOrCOO`
 *     and the `TeamMember` / `TeamGroup` / `TeamDiscColor` types
 *     (see `./roster`).
 *   - `gradientForSlug`, `avatarSvgForSlug`, `initialsForName`,
 *     `discColorsFor`, `DISC_PALETTE` (see `./avatar`).
 *   - `<TeamAvatar />` — server-safe React renderer. Two variants:
 *       • `tile`  — square gradient with two-letter initials (used by the
 *                   authenticated EarnDock / AskEarnView / AdminView).
 *       • `disc`  — round 48 px disc with a Lucide icon on an authored
 *                   radial-gradient palette (used by the public landing).
 *     The COO ignores the variant and always renders the established
 *     `EarnCoin` raster mark, so Earn's brand identity is preserved.
 *
 * Slugs are 1:1 with `ai_brains.slug` in the live DB — do not rename them.
 */

import { EarnCoin } from '@/components/screens/EarnCoin';
import { cn } from '@/lib/utils';
import { getMemberOrCOO, type TeamMember } from './roster';
import { discColorsFor, gradientForSlug, initialsForName } from './avatar';

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

export type TeamAvatarVariant = 'tile' | 'disc';

export interface TeamAvatarProps {
  /** Either the canonical brain slug or the resolved team member. */
  member: TeamMember | string;
  /** Square size in pixels. */
  size?: number;
  /** Visual style. Defaults to `'tile'` (used by every authenticated surface). */
  variant?: TeamAvatarVariant;
  /** Show a pulsing presence dot at the bottom-right. */
  online?: boolean;
  /** Show the soft radial glow halo behind the avatar. Gold for COO, blue otherwise. */
  glow?: boolean;
  className?: string;
}

/**
 * `<TeamAvatar />` — the visual identity for any team member.
 *
 * - The COO (Earn) always delegates to the established `EarnCoin` raster mark.
 * - `variant='tile'` (default) renders a square gradient with the member's
 *   two-letter initials. Deterministic from slug. Used by the dock, Ask Earn
 *   sidebar, and admin team grid.
 * - `variant='disc'` renders a round 48 px disc with the member's Lucide
 *   icon on an authored `radial-gradient` derived from `discColor`. Mirrors
 *   the live www.fundexecs.com landing tiles. If the member has no
 *   `discColor` (shouldn't happen for specialists), the tile variant is used
 *   as a graceful fallback.
 *
 * Accessibility: `role="img"` + `aria-label="{name}, {position}"` always set
 * (the COO branch sets the label inside `EarnCoin`).
 */
export function TeamAvatar({
  member,
  size = 36,
  variant = 'tile',
  online = false,
  glow = false,
  className
}: TeamAvatarProps) {
  const resolved = typeof member === 'string' ? getMemberOrCOO(member) : member;
  const ariaLabel = `${resolved.name}, ${resolved.position}`;

  // The COO keeps the established Earn coin mark, regardless of variant.
  if (resolved.chief) {
    return <EarnCoin size={size} online={online} glow={glow} className={className} />;
  }

  if (variant === 'disc' && resolved.discColor) {
    const Icon = resolved.icon;
    const { from, to } = discColorsFor(resolved.discColor);
    const iconSize = Math.round(size * (20 / 48));
    const shineSize = Math.round(size * (32 / 48));
    const shineOffset = Math.round(size * (-8 / 48));

    const disc = (
      <span
        role="img"
        aria-label={ariaLabel}
        className={cn(
          'relative inline-flex flex-none items-center justify-center overflow-hidden rounded-full shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_2px_8px_-2px_rgba(0,0,0,0.5)] ring-1 ring-white/10',
          className
        )}
        style={{
          width: size,
          height: size,
          background: `radial-gradient(125% 125% at 28% 22%, ${from}, ${to})`
        }}
      >
        {/* Soft top-right "shine" rectangle for material feel. */}
        <span
          className="pointer-events-none absolute rotate-45 rounded-md bg-white/10"
          style={{ width: shineSize, height: shineSize, top: shineOffset, right: shineOffset }}
          aria-hidden
        />
        <Icon size={iconSize} strokeWidth={1.7} className="relative text-white/90" aria-hidden />
      </span>
    );

    if (!glow) return disc;
    return (
      <span className="relative inline-flex flex-none">
        <span
          className="pointer-events-none absolute -inset-1.5 rounded-full blur-[4px]"
          style={{ background: 'radial-gradient(circle, rgba(91,141,239,0.28), transparent 70%)' }}
          aria-hidden
        />
        <span className="relative">{disc}</span>
      </span>
    );
  }

  // ── Default: square initials tile ────────────────────────────────────────
  const { from, to, angle } = gradientForSlug(resolved.slug);
  const initials = initialsForName(resolved.name);
  const radius = Math.round(size * 0.32);
  const fontSize = Math.round(size * 0.42);
  const dotSize = Math.max(8, Math.round(size * 0.28));

  const tile = (
    <span
      role="img"
      aria-label={ariaLabel}
      className={cn(
        'relative inline-flex flex-none items-center justify-center overflow-hidden font-semibold leading-none text-white/95',
        className
      )}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize,
        letterSpacing: '-0.02em',
        background: `linear-gradient(${angle}deg, ${from}, ${to})`,
        boxShadow: '0 1px 2px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.16)'
      }}
    >
      <span aria-hidden style={{ transform: 'translateY(0.5px)' }}>
        {initials}
      </span>
      {online ? (
        <span
          className="absolute -bottom-0.5 -right-0.5 z-10 animate-pulse rounded-full border-2 border-bg-1 bg-success"
          style={{ width: dotSize, height: dotSize }}
          aria-hidden
        />
      ) : null}
    </span>
  );

  if (!glow) return tile;

  // Specialist glow uses the institutional azure family, never gold.
  return (
    <span className="relative inline-flex flex-none">
      <span
        className="pointer-events-none absolute -inset-1.5 rounded-2xl blur-[4px]"
        style={{
          background: 'radial-gradient(circle, rgba(91,141,239,0.28), transparent 70%)'
        }}
        aria-hidden
      />
      <span className="relative">{tile}</span>
    </span>
  );
}
