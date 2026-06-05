/**
 * `lib/team` — single source of truth for The Team identity used across every
 * authenticated FundExecs OS surface. Re-exports:
 *
 *   - `TEAM_ROSTER`, `getCOO`, `getSpecialists`, `getMember`, `getMemberOrCOO`
 *     and the `TeamMember` / `TeamGroup` types (see `./roster`).
 *   - `gradientForSlug`, `avatarSvgForSlug`, `initialsForName` and the
 *     `GradientStops` type (see `./avatar`).
 *   - `<TeamAvatar />` — server-safe React renderer that draws either the Earn
 *     coin (for the COO) or a deterministic gradient tile (for specialists).
 *
 * Slugs are 1:1 with `ai_brains.slug` in the live DB — do not rename them.
 */

import { EarnCoin } from '@/components/screens/EarnCoin';
import { cn } from '@/lib/utils';
import { getMemberOrCOO, type TeamMember } from './roster';
import { gradientForSlug, initialsForName } from './avatar';

export { TEAM_ROSTER, getCOO, getSpecialists, getMember, getMemberOrCOO } from './roster';
export type { TeamMember, TeamGroup } from './roster';
export { gradientForSlug, avatarSvgForSlug, initialsForName } from './avatar';
export type { GradientStops } from './avatar';

export interface TeamAvatarProps {
  /** Either the canonical brain slug or the resolved team member. */
  member: TeamMember | string;
  /** Square size in pixels. */
  size?: number;
  /** Show a pulsing presence dot at the bottom-right (defaults to true for the COO when explicit). */
  online?: boolean;
  /** Show the soft radial glow halo behind the avatar. Gold for the COO, blue for specialists. */
  glow?: boolean;
  className?: string;
}

/**
 * `<TeamAvatar />` — the visual identity for any team member.
 *
 * - For Earn (COO) it delegates to the existing `EarnCoin` raster mark so the
 *   established brand identity is preserved.
 * - For every specialist it renders a rounded-square tile with the
 *   deterministic gradient from `gradientForSlug` and the member's two-letter
 *   initials. The DOM is plain HTML (no `Math.random`, no client-only APIs)
 *   so it is safe to render on the server.
 *
 * Accessibility: `role="img"` + `aria-label="{name}, {position}"` always set.
 */
export function TeamAvatar({
  member,
  size = 36,
  online = false,
  glow = false,
  className
}: TeamAvatarProps) {
  const resolved = typeof member === 'string' ? getMemberOrCOO(member) : member;
  const ariaLabel = `${resolved.name}, ${resolved.position}`;

  if (resolved.chief) {
    // The COO keeps the established Earn coin mark.
    return <EarnCoin size={size} online={online} glow={glow} className={className} />;
  }

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
