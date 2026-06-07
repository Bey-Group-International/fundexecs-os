'use client';

import {
  Check,
  type LucideIcon,
  IdCard,
  Sparkles,
  ClipboardCheck,
  PartyPopper
} from 'lucide-react';
import { cn } from '@/lib/utils';

/* ----------------------------------------------------------------------------
 * OnboardingStepper — the persistent "you are here" rail shown across the whole
 * first-run journey (Identity → Profile → Review → Done). Rendered by both the
 * identity step (`OnboardingView`) and the Proof-of-Truth flow so the progress
 * state is continuous. Gold = active/done (onboarding is Earn-led, so the
 * Earn-gold accent is on-brand here). Tokens only; reduced-motion safe.
 * --------------------------------------------------------------------------*/

export type OnboardingStep = 'identity' | 'profile' | 'review' | 'done';

const STEPS: { id: OnboardingStep; label: string; icon: LucideIcon }[] = [
  { id: 'identity', label: 'Identity', icon: IdCard },
  { id: 'profile', label: 'Profile', icon: Sparkles },
  { id: 'review', label: 'Review', icon: ClipboardCheck },
  { id: 'done', label: 'Done', icon: PartyPopper }
];

export interface OnboardingStepperProps {
  /** The step the user is currently on. */
  current: OnboardingStep;
  /** Optional 0–100 completion for the active (Profile) step. */
  pct?: number;
  className?: string;
}

export function OnboardingStepper({ current, pct, className }: OnboardingStepperProps) {
  const currentIndex = STEPS.findIndex((s) => s.id === current);

  return (
    <ol
      className={cn('flex items-center gap-1.5 sm:gap-2', className)}
      aria-label="Onboarding progress"
    >
      {STEPS.map((step, i) => {
        const state = i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'upcoming';
        const Icon = step.icon;
        return (
          <li key={step.id} className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
            <div
              className="flex min-w-0 items-center gap-2"
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <span
                className={cn(
                  'flex h-7 w-7 flex-none items-center justify-center rounded-full border text-[12px] font-semibold tabular-nums transition-colors',
                  state === 'done' && 'border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1',
                  state === 'current' &&
                    'border-gold-1 bg-[var(--gold-soft)] text-gold-1 shadow-[0_0_0_3px_var(--gold-soft)]',
                  state === 'upcoming' && 'border-hairline bg-surface-1 text-fg-5'
                )}
              >
                {state === 'done' ? (
                  <Check size={14} strokeWidth={2.4} aria-hidden />
                ) : (
                  <Icon size={14} strokeWidth={2} aria-hidden />
                )}
              </span>
              <span
                className={cn(
                  'hidden truncate text-[12px] font-medium sm:inline',
                  state === 'upcoming' ? 'text-fg-5' : 'text-fg-1'
                )}
              >
                {step.label}
                {state === 'current' && step.id === 'profile' && typeof pct === 'number' ? (
                  <span className="ml-1 tabular-nums text-fg-4">· {pct}%</span>
                ) : null}
              </span>
            </div>
            {i < STEPS.length - 1 ? (
              <span
                aria-hidden
                className={cn(
                  'h-px flex-1 rounded-full transition-colors',
                  i < currentIndex ? 'bg-[var(--gold-line)]' : 'bg-hairline'
                )}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export default OnboardingStepper;
