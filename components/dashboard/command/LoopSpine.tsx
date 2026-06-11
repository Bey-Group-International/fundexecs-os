import { Target, Sparkles, ShieldCheck, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ============================================================================
 * LoopSpine — the operating model, made legible on the daily surface.
 *
 * "You set the mandate → The team works → You approve · it executes". Ported
 * from the onboarding prototype's Command Center so the loop the operator just
 * learned in onboarding is reinforced every time they land on the home.
 * ========================================================================= */

const STEPS = [
  { icon: Target, label: 'You set the mandate', tone: 'text-fg-4' },
  { icon: Sparkles, label: 'The team works', tone: 'text-gold-1' },
  { icon: ShieldCheck, label: 'You approve · it executes', tone: 'text-success' }
] as const;

export function LoopSpine({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-2.5 gap-y-1', className)}>
      {STEPS.map((s, i) => (
        <span key={s.label} className="inline-flex items-center gap-2.5">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 text-[11.5px]',
              i === 2 ? 'text-fg-2' : 'text-fg-4'
            )}
          >
            <s.icon size={13} strokeWidth={1.9} className={s.tone} aria-hidden />
            {s.label}
          </span>
          {i < STEPS.length - 1 && <ChevronRight size={13} className="text-fg-5" aria-hidden />}
        </span>
      ))}
    </div>
  );
}
