'use client';

import { Sparkles, Check } from 'lucide-react';
import { FIRST_MOVES } from '@/lib/beta/value-preview';
import { MEMBER_TYPE_LABELS, type MemberType } from '@/lib/member-types';

/**
 * "Live value preview" — the concrete first moves Earn lines up for the
 * invitee's member type, shown on arrival so the payoff is visible before they
 * finish signing in. Content-only (no fetch). Renders nothing for an unknown type.
 */
export function ValuePreview({
  memberType,
  className = ''
}: {
  memberType: MemberType | null | undefined;
  className?: string;
}) {
  if (!memberType) return null;
  const preview = FIRST_MOVES[memberType];
  if (!preview) return null;

  return (
    <div
      className={`rounded-2xl border border-hairline bg-surface-1/70 p-4 text-left ${className}`}
    >
      <div className="flex items-center gap-2 text-[12.5px] font-semibold text-fg-1">
        <Sparkles size={15} strokeWidth={2} aria-hidden className="text-gold-1" />
        What I’ll line up for you
      </div>
      <p className="mt-1 text-[11.5px] text-fg-4">
        {MEMBER_TYPE_LABELS[memberType]} · {preview.headline}
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {preview.moves.map((move) => (
          <li key={move} className="flex items-start gap-2.5 text-[12.5px] leading-snug text-fg-2">
            <span className="mt-0.5 flex-none text-gold-1">
              <Check size={14} strokeWidth={2.4} aria-hidden />
            </span>
            {move}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default ValuePreview;
