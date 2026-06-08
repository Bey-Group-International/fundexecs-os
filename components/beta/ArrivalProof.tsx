'use client';

import { Users, Ticket, Coins } from 'lucide-react';
import type { BetaMomentum } from '@/lib/queries/beta-momentum';

/**
 * "Proof + momentum" strip for the invite-arrival surfaces: the seat reserved
 * for this invitee, how many members are already inside, and the credits waiting
 * on day one. Pure presentation — momentum is resolved server-side and passed
 * in; renders nothing when it's unavailable so the page never shows a hole.
 */
export function ArrivalProof({
  momentum,
  className = ''
}: {
  momentum: BetaMomentum | null;
  className?: string;
}) {
  if (!momentum) return null;
  const { memberCount, seatNumber, startingCredits } = momentum;

  const pills = [
    { icon: Ticket, label: `Seat #${seatNumber.toLocaleString()} reserved` },
    {
      icon: Users,
      label: `${memberCount.toLocaleString()} ${memberCount === 1 ? 'member' : 'members'} inside`
    },
    { icon: Coins, label: `${startingCredits.toLocaleString()} credits waiting` }
  ];

  return (
    <div
      className={`flex flex-wrap items-center justify-center gap-2 ${className}`}
      aria-label="Private beta status"
    >
      {pills.map(({ icon: Icon, label }) => (
        <span
          key={label}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--gold-line)] bg-[var(--gold-soft)] px-2.5 py-1 text-[11px] font-medium text-fg-2"
        >
          <Icon size={12.5} strokeWidth={2} aria-hidden className="text-gold-1" />
          {label}
        </span>
      ))}
    </div>
  );
}

export default ArrivalProof;
