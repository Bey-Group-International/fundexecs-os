'use client';

import {
  Building2,
  Briefcase,
  Rocket,
  GraduationCap,
  UserRound,
  type LucideIcon
} from 'lucide-react';
import { Card } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import {
  MEMBER_TYPES,
  MEMBER_TYPE_LABELS,
  MEMBER_TYPE_BLURBS,
  type MemberType
} from '@/lib/member-types';

const TYPE_ICONS: Record<MemberType, LucideIcon> = {
  investment_firm: Building2,
  service_provider: Briefcase,
  startup: Rocket,
  student: GraduationCap,
  individual_investor: UserRound
};

interface MemberTypePickerProps {
  /** Currently-selected type (when editing), or null. */
  selected: MemberType | null;
  /** Disabled while the selection is being persisted. */
  busy?: boolean;
  onSelect: (type: MemberType) => void;
}

/**
 * MemberTypePicker — the first step: five selectable cards (label + blurb). Earn
 * introduces the choice; picking one hands off to the Q&A.
 */
export function MemberTypePicker({ selected, busy, onSelect }: MemberTypePickerProps) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <EarnCoin size={40} glow online className="flex-none" />
        <div className="min-w-0">
          <div className="text-[14px] font-semibold tracking-[-0.015em] text-fg-1">
            First — which best describes you?
          </div>
          <p className="text-[12px] text-fg-4">
            I&apos;ll tailor every question to build your verified, member-type-specific profile.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {MEMBER_TYPES.map((type) => {
          const Icon = TYPE_ICONS[type];
          const active = selected === type;
          return (
            <Card
              key={type}
              clickable={!busy}
              role="button"
              tabIndex={busy ? -1 : 0}
              aria-pressed={active}
              onClick={() => !busy && onSelect(type)}
              onKeyDown={(e) => {
                if (busy) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(type);
                }
              }}
              className={
                active
                  ? 'flex items-start gap-3 border-[var(--accent-line)] bg-surface-2 p-4'
                  : 'flex items-start gap-3 p-4'
              }
            >
              <span
                className={
                  active
                    ? 'inline-flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-[var(--accent-line)] bg-[var(--accent-soft)] text-accent'
                    : 'inline-flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-hairline bg-surface-1 text-fg-3'
                }
              >
                <Icon size={17} strokeWidth={1.9} aria-hidden />
              </span>
              <div className="min-w-0">
                <div className="text-[13.5px] font-semibold text-fg-1">
                  {MEMBER_TYPE_LABELS[type]}
                </div>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-fg-4">
                  {MEMBER_TYPE_BLURBS[type]}
                </p>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
