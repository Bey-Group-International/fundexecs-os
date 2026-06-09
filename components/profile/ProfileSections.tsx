'use client';

import Link from 'next/link';
import { ExternalLink, Plus } from 'lucide-react';
import { Badge, Card } from '@/components/ui';
import { cn } from '@/lib/utils';
import { RevealGroup, RevealItem } from '@/components/dashboard/command';
import type { FundProfile, ProfileSection } from '@/lib/queries/fund-profile';

/**
 * On-record / add status chip shared by every section card. Green dot = on the
 * record; warning = a counterparty would press on it. No gold (reserved for Earn).
 */
function StatusChip({ present }: { present: boolean }) {
  return present ? (
    <Badge tone="success" dot className="flex-none text-[9.5px] uppercase tracking-[0.1em]">
      On record
    </Badge>
  ) : (
    <Badge tone="warning" className="flex-none text-[9.5px] uppercase tracking-[0.1em]">
      Add
    </Badge>
  );
}

export interface ProfileSectionsProps {
  profile: FundProfile;
  className?: string;
}

/**
 * ProfileSections — the member's Profile rendered as compact, data-driven cards,
 * one per question in their member-type schema. Required-but-empty sections are
 * live invitations (the whole card links into onboarding); optional empties are
 * hidden to keep the surface calm. Cards rise in on load (staggered) and lift on
 * hover; reduced-motion is honored by the shared MotionConfig at the app root.
 */
export function ProfileSections({ profile, className }: ProfileSectionsProps) {
  // Show every required section; show optional sections only once filled.
  const visible = profile.sections.filter((s) => !s.optional || s.present);

  return (
    <RevealGroup
      className={cn('grid gap-[18px] lg:grid-cols-2', className)}
      data-testid="profile-sections"
    >
      {visible.map((section) => (
        <RevealItem key={section.id}>
          <SectionCard section={section} />
        </RevealItem>
      ))}
    </RevealGroup>
  );
}

function SectionBody({ section }: { section: ProfileSection }) {
  if (!section.present) {
    return (
      <p className="mt-3 max-w-[60ch] text-[12.5px] leading-relaxed text-fg-4">
        {section.why ?? "Put this on the record so a counterparty can't press on it."}
      </p>
    );
  }

  if (section.kind === 'tags') {
    return (
      <div className="mt-3 flex flex-wrap gap-1.5">
        {section.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full border border-hairline bg-surface-1 px-2.5 py-0.5 text-[11.5px] text-fg-2"
          >
            {tag}
          </span>
        ))}
      </div>
    );
  }

  if (section.kind === 'url' && section.href) {
    return (
      <a
        href={section.href}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-azure-1 hover:underline"
      >
        <span className="truncate">{section.text}</span>
        <ExternalLink size={12} strokeWidth={2} aria-hidden />
      </a>
    );
  }

  return (
    <p className="mt-3 max-w-[60ch] text-[12.5px] leading-relaxed text-fg-2">{section.text}</p>
  );
}

function SectionCard({ section }: { section: ProfileSection }) {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-4">
          {section.label}
        </p>
        <StatusChip present={section.present} />
      </div>
      <SectionBody section={section} />
      {!section.present ? (
        <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-accent">
          Add {section.label.toLowerCase()}
          <Plus size={12} strokeWidth={2.2} aria-hidden />
        </span>
      ) : null}
    </>
  );

  if (section.present) {
    return (
      <Card
        data-testid={`profile-section-${section.id}`}
        className="h-full p-5 transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[var(--shadow-sm)]"
      >
        {inner}
      </Card>
    );
  }

  return (
    <Link
      href={`/onboarding?focus=${encodeURIComponent(section.id)}`}
      data-testid={`profile-section-${section.id}`}
      className="group block h-full rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-0"
    >
      <Card className="h-full p-5 transition-[transform,box-shadow] group-hover:-translate-y-0.5 group-hover:shadow-[var(--shadow-sm)]">
        {inner}
      </Card>
    </Link>
  );
}
