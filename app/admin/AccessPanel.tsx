'use client';

/* ============================================================================
 * AccessPanel — the Admin portal's unified access pipeline.
 *
 * One tab for the whole "getting people in the door" job, which used to be
 * split across three: email invites, shareable beta links, and the
 * application-review inbox. A funnel strip across the top shows where every
 * prospect is (invited → claimed → in review → activated), and the detail
 * surfaces below are the existing battle-tested panels, switched by a local
 * segmented control. Org scope sees only its own email invites — share links
 * and the application inbox stay platform-only.
 * ========================================================================= */

import { useState } from 'react';
import { ArrowRight, Inbox, Link2, Mail } from 'lucide-react';
import { Card, SegTabs, type BadgeTone } from '@/components/ui';
import type { BetaInvite } from '@/lib/queries/beta-invites';
import type { BetaLinkWithStatus } from '@/lib/queries/beta-links';
import type { BetaApplication } from '@/lib/queries/beta-applications';
import { BetaInvitesPanel } from './BetaInvitesPanel';
import { BetaLinksPanel } from './BetaLinksPanel';
import { ApplicationsPanel } from './ApplicationsPanel';

type Section = 'invites' | 'links' | 'applications';

const TONE_VAR: Record<BadgeTone, string> = {
  neutral: 'var(--fg-4)',
  info: 'var(--info)',
  azure: 'var(--azure-1)',
  success: 'var(--success)',
  gold: 'var(--gold-1)',
  warning: 'var(--warning)',
  danger: 'var(--danger)'
};

interface Stage {
  label: string;
  value: number;
  sub: string;
  tone: BadgeTone;
}

function StageStrip({ stages }: { stages: Stage[] }) {
  return (
    <Card>
      <div className="flex items-stretch gap-1.5">
        {stages.map((st, i) => (
          <div key={st.label} className="flex flex-1 items-stretch gap-1.5">
            <div className="relative flex-1 overflow-hidden rounded-xl border border-hairline bg-surface-1 p-3">
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 h-0.5"
                style={{ backgroundColor: TONE_VAR[st.tone] }}
              />
              <div className="text-[22px] font-semibold tabular-nums tracking-[-0.02em] text-fg-1">
                {st.value}
              </div>
              <div className="mt-0.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-4">
                {st.label}
              </div>
              <div className="mt-1 truncate text-[10.5px] text-fg-5">{st.sub}</div>
            </div>
            {i < stages.length - 1 ? (
              <ArrowRight
                size={14}
                strokeWidth={2}
                className="mt-3 flex-none self-start text-fg-5"
                aria-hidden
              />
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}

export function AccessPanel({
  invites,
  links,
  applications,
  earnings,
  scope
}: {
  invites: BetaInvite[];
  links: BetaLinkWithStatus[];
  applications: BetaApplication[];
  /** Referral credits earned per invite/link source id (badges on rows). */
  earnings: Record<string, number>;
  /** 'org' hides the platform-only surfaces (share links + application inbox). */
  scope: 'platform' | 'org';
}) {
  const isOrg = scope === 'org';
  const [section, setSection] = useState<Section>('invites');

  const openInvites = invites.filter((i) => i.status === 'pending').length;
  const acceptedInvites = invites.filter((i) => i.status === 'accepted').length;
  const pendingReview = applications.filter((a) => a.review === 'pending').length;
  const approved = applications.filter((a) => a.review === 'approved').length;

  const stages: Stage[] = isOrg
    ? [
        {
          label: 'Invited',
          value: invites.length,
          sub: 'Email invites sent',
          tone: 'azure'
        },
        {
          label: 'Awaiting',
          value: openInvites,
          sub: openInvites ? 'Not yet accepted' : 'All accepted',
          tone: openInvites ? 'warning' : 'success'
        },
        {
          label: 'Joined',
          value: acceptedInvites,
          sub: 'Active on the workspace',
          tone: 'success'
        }
      ]
    : [
        {
          label: 'Invited',
          value: invites.length,
          sub: `${openInvites} awaiting acceptance`,
          tone: 'azure'
        },
        {
          label: 'Claimed',
          value: applications.length,
          sub: `via ${links.filter((l) => l.status === 'active').length} active link${
            links.filter((l) => l.status === 'active').length === 1 ? '' : 's'
          }`,
          tone: 'azure'
        },
        {
          label: 'In review',
          value: pendingReview,
          sub: pendingReview ? 'Needs a decision' : 'Inbox clear',
          tone: pendingReview ? 'warning' : 'success'
        },
        {
          label: 'Activated',
          value: acceptedInvites + approved,
          sub: `${acceptedInvites} invited · ${approved} approved`,
          tone: 'success'
        }
      ];

  const sections = [
    { id: 'invites' as const, label: 'Email invites', icon: Mail, count: openInvites || undefined },
    { id: 'links' as const, label: 'Share links', icon: Link2 },
    {
      id: 'applications' as const,
      label: 'Applications',
      icon: Inbox,
      count: pendingReview || undefined
    }
  ];

  return (
    <div className="flex flex-col gap-[18px]">
      <StageStrip stages={stages} />
      {isOrg ? (
        <BetaInvitesPanel invites={invites} earnings={earnings} />
      ) : (
        <>
          <SegTabs active={section} onChange={(id) => setSection(id as Section)} tabs={sections} />
          {section === 'invites' && <BetaInvitesPanel invites={invites} earnings={earnings} />}
          {section === 'links' && <BetaLinksPanel links={links} earnings={earnings} />}
          {section === 'applications' && <ApplicationsPanel applications={applications} />}
        </>
      )}
    </div>
  );
}
