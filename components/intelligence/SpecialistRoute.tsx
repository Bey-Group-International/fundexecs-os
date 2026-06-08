import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { TeamAvatar, getMemberByFirstName } from '@/lib/team';
import { cn } from '@/lib/utils';

/* ----------------------------------------------------------------------------
 * SpecialistRoute — who owns this signal, and the one move to make next.
 *
 * Resolves the routed first name against the 15-strong roster and renders the
 * specialist's avatar + role, optionally paired with a single next-best-action
 * the operator can take into the workflow (brief, intro, open). Reinforces the
 * team-of-15 narrative: every signal has an owner and a next step.
 * -------------------------------------------------------------------------- */

export interface SpecialistNextAction {
  label: string;
  href: string;
}

export interface SpecialistRouteProps {
  name: string | null;
  nextAction?: SpecialistNextAction;
  className?: string;
}

export function SpecialistRoute({ name, nextAction, className }: SpecialistRouteProps) {
  const member = getMemberByFirstName(name);
  if (!member) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-bg-1 py-0.5 pl-0.5 pr-2.5">
        <TeamAvatar member={member} size={18} />
        <span className="text-[11px] font-medium text-fg-3">
          Routed to <span className="text-fg-2">{member.name}</span>
          <span className="hidden text-fg-5 sm:inline"> · {member.position}</span>
        </span>
      </span>
      {nextAction ? (
        <Link
          href={nextAction.href}
          className="inline-flex items-center gap-1 rounded-full border border-[var(--gold-line)] bg-[var(--gold-soft)] px-2.5 py-0.5 text-[11px] font-medium text-gold-1 transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
        >
          {nextAction.label}
          <ArrowRight size={11} strokeWidth={2.2} aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}
